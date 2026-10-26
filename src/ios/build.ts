import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { artifact, sourceIdentity, version, writeJSON } from "../evidence.js";
import { requireIOS, requireSnapshot } from "../manifest.js";
import { run } from "../process.js";
import type { BuildReceipt, Manifest } from "../types.js";
import { appIdentity, array, buildArguments, generate, object, plist, text } from "./tools.js";
import type { JsonObject, JsonValue } from "./tools.js";

export function testTarget(config: JsonObject, name: string): JsonObject {
  const direct = config[name];
  if (direct !== undefined) return object(direct, name);
  const configurations = config["TestConfigurations"];
  const matches: JsonObject[] = [];
  for (const entry of configurations === undefined
    ? []
    : array(configurations, "TestConfigurations")) {
    const targets = object(entry, "TestConfiguration")["TestTargets"];
    for (const candidate of targets === undefined ? [] : array(targets, "TestTargets")) {
      const target = object(candidate, "TestTarget");
      if (target["BlueprintName"] === name) matches.push(target);
    }
  }
  const match = matches[0];
  if (matches.length !== 1 || !match)
    throw new Error(`Expected one xctestrun target named ${name}`);
  return match;
}
export function absoluteTestPaths(value: JsonValue, root: string): JsonValue {
  if (typeof value === "string") return value.replaceAll("__TESTROOT__", root);
  if (Array.isArray(value)) return value.map((part) => absoluteTestPaths(part, root));
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, part]) => [key, absoluteTestPaths(part, root)]),
    );
  return value;
}
const buildSettingsSchema = z.array(
  z.object({
    target: z.string(),
    buildSettings: z.object({
      TARGET_BUILD_DIR: z.string(),
      FULL_PRODUCT_NAME: z.string(),
      BUILD_DIR: z.string(),
    }),
  }),
);
export async function buildForSnapshot(
  manifest: Manifest,
  directory: string,
  device: string,
): Promise<BuildReceipt> {
  const ios = requireIOS(manifest);
  const snapshot = requireSnapshot(manifest);
  await generate(manifest);
  const source = await sourceIdentity(manifest.root);
  const args = [
    ...buildArguments(manifest, snapshot.configuration, `platform=iOS Simulator,id=${device}`),
    ...snapshot.buildSettings,
  ];
  await run(["xcodebuild", ...args, "build-for-testing"], {
    cwd: ios.cwd,
    log: join(directory, "build.log"),
  });
  const rawSettings: unknown = JSON.parse(
    await run(["xcodebuild", ...args, "-showBuildSettings", "-json"], {
      cwd: ios.cwd,
      capture: true,
    }),
  );
  const settings = buildSettingsSchema.parse(rawSettings);
  const selected = settings.find(
    (item) => item.target === (ios.appTarget ?? ios.scheme),
  )?.buildSettings;
  if (!selected) throw new Error("App target is absent from Xcode build settings");
  const appPath = join(selected.TARGET_BUILD_DIR, selected.FULL_PRODUCT_NAME);
  const candidates = (await readdir(selected.BUILD_DIR)).filter(
    (name) => name.startsWith(`${ios.scheme}_`) && name.endsWith(".xctestrun"),
  );
  const candidate = candidates[0];
  if (candidates.length !== 1 || !candidate)
    throw new Error(
      `Expected one ${ios.scheme} xctestrun in ${selected.BUILD_DIR}; remove only obsolete task-owned builds explicitly`,
    );
  const xctestrunPath = join(selected.BUILD_DIR, candidate);
  const configuration = object(
    absoluteTestPaths(await plist(xctestrunPath), selected.BUILD_DIR),
    "xctestrun",
  );
  const testRunnerPath = text(
    testTarget(configuration, snapshot.target)["TestHostPath"],
    "xctestrun test runner path",
  );
  const receipt: BuildReceipt = {
    schema: 1,
    toolkit: version,
    stage: "build",
    status: "succeeded",
    app: manifest.app,
    environment: manifest.environment,
    manifestHash: manifest.hash,
    source,
    configuration: snapshot.configuration,
    identity: await appIdentity(manifest, appPath, snapshot.expectedInfo),
    appArtifact: await artifact(appPath),
    testRunner: await artifact(testRunnerPath),
    xctestrun: await artifact(xctestrunPath),
  };
  if (source.digest !== (await sourceIdentity(manifest.root)).digest)
    throw new Error("Source changed during the build; rebuild before capture");
  await writeJSON(join(directory, "build-receipt.json"), receipt);
  return receipt;
}
