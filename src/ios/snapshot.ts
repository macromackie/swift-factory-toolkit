import { join, resolve } from "node:path";
import { z } from "zod";
import {
  beginEvidence,
  finishEvidence,
  readJSON,
  requireReceipt,
  sha256,
  sourceIdentity,
  verifyArtifact,
  writeJSON,
} from "../evidence.js";
import { buildReceiptSchema } from "../schemas.js";
import { requireIOS, requireSnapshot } from "../manifest.js";
import { run } from "../process.js";
import { acquireLease, readiness } from "../stack.js";
import type { BuildReceipt, Manifest } from "../types.js";
import { absoluteTestPaths, buildForSnapshot, testTarget } from "./build.js";
import { environmentEvidence, object, plist, text } from "./tools.js";
import { exportScreenshots, restoreSimulatorSettings, simulatorSettings } from "./simulator.js";
import type { SimulatorSettings } from "./simulator.js";

async function snapshotBuild(
  manifest: Manifest,
  directory: string,
  device: string,
  sourceDigest: string,
  path?: string,
): Promise<BuildReceipt> {
  if (!path) return buildForSnapshot(manifest, directory, device);
  const build = buildReceiptSchema.parse(await readJSON(resolve(path)));
  requireReceipt(manifest, build, "build");
  if (build.source.digest !== sourceDigest)
    throw new Error("Build receipt is stale for the current source");
  await verifyArtifact(build.appArtifact);
  await verifyArtifact(build.testRunner);
  await verifyArtifact(build.xctestrun);
  return build;
}
export async function snapshot(
  manifest: Manifest,
  scenario: string,
  device: string,
  buildReceiptPath?: string,
): Promise<void> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(device))
    throw new Error("Provide a simulator UUID with --device");
  const ios = requireIOS(manifest);
  const config = requireSnapshot(manifest);
  const selection = config.scenarios[scenario];
  if (!selection) throw new Error("Unknown snapshot scenario");
  const evidence = await beginEvidence(manifest, "snapshot");
  await finishEvidence(evidence, async () => {
    const simulatorLease = await acquireLease(`simulator-${device.toLowerCase()}`);
    let projectLease;
    let settings: SimulatorSettings | undefined;
    try {
      projectLease = await acquireLease(`xcode-${sha256(ios.cwd + ios.project).slice(0, 24)}`);
      const backend = await readiness(manifest, evidence.receipt.source);
      if (!backend) throw new Error("Start the local stack before capturing");
      const tools = await environmentEvidence();
      const build = await snapshotBuild(
        manifest,
        evidence.directory,
        device,
        evidence.receipt.source.digest,
        buildReceiptPath,
      );
      const configuration = object(
        absoluteTestPaths(await plist(build.xctestrun.path), resolve(build.xctestrun.path, "..")),
        "xctestrun",
      );
      const target = testTarget(configuration, config.target);
      if (
        resolve(text(target["UITargetAppPath"], "UITargetAppPath")) !==
        resolve(build.appArtifact.path)
      )
        throw new Error("xctestrun targets a different app artifact");
      const variables =
        target["EnvironmentVariables"] === undefined
          ? {}
          : object(target["EnvironmentVariables"], "EnvironmentVariables");
      target["EnvironmentVariables"] = { ...variables, ...selection.environment };
      const configured = join(evidence.directory, "capture.xctestrun");
      const temporary = join(evidence.directory, "capture.json");
      await writeJSON(temporary, configuration);
      await run(["plutil", "-convert", "xml1", "-o", configured, temporary]);
      await run(["xcrun", "simctl", "bootstatus", device, "-b"], { timeoutMs: 180_000 });
      settings = await simulatorSettings(device);
      await run(["xcrun", "simctl", "ui", device, "appearance", selection.appearance]);
      await run(["xcrun", "simctl", "ui", device, "content_size", selection.textSize]);
      const inventory: unknown = JSON.parse(
        await run(["xcrun", "simctl", "list", "devices", "available", "-j"], { capture: true }),
      );
      const simulators = z.json().parse(inventory);
      try {
        await run(
          [
            "xcodebuild",
            "test-without-building",
            "-xctestrun",
            configured,
            "-destination",
            `platform=iOS Simulator,id=${device}`,
            "-parallel-testing-enabled",
            "NO",
            "-collect-test-diagnostics",
            "never",
            `-only-testing:${config.test}`,
            "-resultBundlePath",
            join(evidence.directory, "capture.xcresult"),
          ],
          { cwd: ios.cwd, log: join(evidence.directory, "test.log"), timeoutMs: 600_000 },
        );
      } catch (error) {
        await exportScreenshots(evidence.directory, config.attachmentPrefix).catch(() => {
          /* Preserve the test failure when no attachment was produced. */
        });
        throw error;
      }
      const screenshots = await exportScreenshots(evidence.directory, config.attachmentPrefix);
      const finalBackend = await readiness(manifest, build.source);
      if (!finalBackend) throw new Error("Backend disappeared during capture");
      await verifyArtifact(build.appArtifact);
      await verifyArtifact(build.testRunner);
      await verifyArtifact(build.xctestrun);
      if (build.source.digest !== (await sourceIdentity(manifest.root)).digest)
        throw new Error("Source changed during capture");
      return { backend: finalBackend, tools, device, build, simulators, screenshots };
    } finally {
      try {
        if (settings) await restoreSimulatorSettings(device, settings);
      } finally {
        try {
          await projectLease?.release();
        } finally {
          await simulatorLease.release();
        }
      }
    }
  });
}
