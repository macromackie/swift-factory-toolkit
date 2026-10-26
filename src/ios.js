import { copyFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
  artifact,
  beginEvidence,
  readJSON,
  requireReceipt,
  sha256,
  sourceIdentity,
  verifyArtifact,
  writeJSON,
} from "./evidence.js";
import { command, requireValue } from "./manifest.js";
import { run } from "./process.js";
import { acquireLease, readiness } from "./stack.js";

export function buildArguments(manifest, configuration, destination) {
  const ios = manifest.ios;
  return [
    "-project",
    ios.project,
    "-scheme",
    ios.scheme,
    "-configuration",
    configuration,
    "-destination",
    destination,
    "-jobs",
    String(ios.jobs),
    "-skipMacroValidation",
    "-onlyUsePackageVersionsFromResolvedFile",
  ];
}

async function plist(path) {
  return JSON.parse(await run(["plutil", "-convert", "json", "-o", "-", path], { capture: true }));
}

async function appIdentity(manifest, path, expected = {}) {
  const info = await plist(join(path, "Info.plist"));
  requireValue(
    info.CFBundleIdentifier === manifest.ios.bundleID,
    "Built app bundle identity differs from the manifest",
  );
  for (const [key, value] of Object.entries(expected))
    requireValue(info[key] === value, `Built app has a different ${key}`);
  return {
    bundleID: info.CFBundleIdentifier,
    version: info.CFBundleShortVersionString,
    build: info.CFBundleVersion,
    minimumOS: info.MinimumOSVersion,
    executable: info.CFBundleExecutable,
    sdk: info.DTSDKName,
    xcodeBuild: info.DTXcodeBuild,
  };
}

async function environmentEvidence() {
  return {
    xcode: await run(["xcodebuild", "-version"], { capture: true }),
    host: await run(["sw_vers"], { capture: true }),
  };
}

async function finish(directory, receipt, operation) {
  await writeJSON(join(directory, "receipt.json"), receipt);
  try {
    await operation();
    receipt.status = "succeeded";
  } catch (error) {
    receipt.status = "failed";
    receipt.error = error.message;
    throw error;
  } finally {
    receipt.finishedAt = new Date().toISOString();
    await writeJSON(join(directory, "receipt.json"), receipt);
    console.log(`Evidence: ${join(directory, "receipt.json")}`);
  }
}

async function generate(manifest) {
  if (manifest.ios.generate) await run(manifest.ios.generate, { cwd: manifest.ios.cwd });
}

function testTarget(config, name) {
  if (config[name]) return config[name];
  const matches = (config.TestConfigurations ?? [])
    .flatMap((item) => item.TestTargets ?? [])
    .filter((target) => target.BlueprintName === name);
  requireValue(matches.length === 1, `Expected one xctestrun target named ${name}`);
  return matches[0];
}

function absoluteTestPaths(value, root) {
  if (typeof value === "string") return value.replaceAll("__TESTROOT__", root);
  if (Array.isArray(value)) return value.map((part) => absoluteTestPaths(part, root));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, part]) => [key, absoluteTestPaths(part, root)]),
    );
  return value;
}

async function buildForSnapshot(manifest, directory, device) {
  const ios = manifest.ios;
  const settings = ios.snapshot.buildSettings ?? [];
  requireValue(
    Array.isArray(settings) &&
      settings.every((value) => typeof value === "string" && /^[A-Z0-9_]+=/.test(value)),
    "Snapshot buildSettings must contain build setting assignments",
  );
  await generate(manifest);
  const source = await sourceIdentity(manifest.root);
  const args = [
    ...buildArguments(
      manifest,
      ios.snapshot.configuration ?? "Debug",
      `platform=iOS Simulator,id=${device}`,
    ),
    ...settings,
  ];
  await run(["xcodebuild", ...args, "build-for-testing"], {
    cwd: ios.cwd,
    log: join(directory, "build.log"),
  });
  const allSettings = JSON.parse(
    await run(["xcodebuild", ...args, "-showBuildSettings", "-json"], {
      cwd: ios.cwd,
      capture: true,
    }),
  );
  const selected = allSettings.find(
    (item) => item.target === (ios.appTarget ?? ios.scheme),
  )?.buildSettings;
  requireValue(selected, "App target is absent from Xcode build settings");
  const appPath = join(selected.TARGET_BUILD_DIR, selected.FULL_PRODUCT_NAME);
  const candidates = (await readdir(selected.BUILD_DIR)).filter(
    (name) => name.startsWith(`${ios.scheme}_`) && name.endsWith(".xctestrun"),
  );
  requireValue(
    candidates.length === 1,
    `Expected one ${ios.scheme} xctestrun in ${selected.BUILD_DIR}; remove only obsolete task-owned builds explicitly`,
  );
  const xctestrunPath = join(selected.BUILD_DIR, candidates[0]);
  const testConfiguration = absoluteTestPaths(await plist(xctestrunPath), selected.BUILD_DIR);
  const testRunnerPath = testTarget(testConfiguration, ios.snapshot.target).TestHostPath;
  requireValue(typeof testRunnerPath === "string", "xctestrun has no test runner path");
  const receipt = {
    schema: 1,
    toolkit: "0.1.0",
    stage: "build",
    status: "succeeded",
    app: manifest.app,
    environment: manifest.environment,
    manifestHash: manifest.hash,
    source,
    configuration: ios.snapshot.configuration ?? "Debug",
    identity: await appIdentity(manifest, appPath, ios.snapshot.expectedInfo),
    appArtifact: await artifact(appPath),
    testRunner: await artifact(testRunnerPath),
    xctestrun: await artifact(xctestrunPath),
  };
  requireValue(
    source.digest === (await sourceIdentity(manifest.root)).digest,
    "Source changed during the build; rebuild before capture",
  );
  await writeJSON(join(directory, "build-receipt.json"), receipt);
  return receipt;
}

async function exportScreenshots(directory, prefix) {
  const attachments = join(directory, "attachments");
  await run([
    "xcrun",
    "xcresulttool",
    "export",
    "attachments",
    "--path",
    join(directory, "capture.xcresult"),
    "--output-path",
    attachments,
  ]);
  const manifest = await readJSON(join(attachments, "manifest.json"));
  const images = [];
  for (const test of manifest) {
    for (const attachment of test.attachments ?? []) {
      const name = attachment.suggestedHumanReadableName;
      const exported = basename(attachment.exportedFileName);
      if (!name.startsWith(prefix) || !exported.endsWith(".png")) continue;
      const destination = `${name.split("_", 1)[0].replace(/[^a-zA-Z0-9._-]/g, "-")}.png`;
      requireValue(!images.includes(destination), "Duplicate screenshot name");
      await copyFile(join(attachments, exported), join(directory, destination));
      images.push(destination);
    }
  }
  requireValue(
    images.length > 0,
    "Test completed without a named screenshot; inspect capture.xcresult",
  );
  const figures = images
    .map(
      (name) =>
        `<figure><figcaption>${name}</figcaption><a href="${name}"><img src="${name}"></a></figure>`,
    )
    .join("");
  await writeFile(
    join(directory, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>App snapshots</title><style>body{font:16px system-ui;background:#eee;margin:24px}img{max-width:420px;width:100%}figure{display:inline-block;vertical-align:top}</style>${figures}`,
  );
  return Promise.all(images.map((name) => artifact(join(directory, name))));
}

export async function snapshot(manifest, scenario, device, buildReceiptPath) {
  requireValue(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(device),
    "Provide a simulator UUID with --device",
  );
  const selection = manifest.ios?.snapshot?.scenarios?.[scenario];
  requireValue(selection, "Unknown snapshot scenario");
  const { directory, receipt } = await beginEvidence(manifest, "snapshot");
  const simulatorLease = await acquireLease(`simulator-${device.toLowerCase()}`);
  let projectLease;
  let appearance;
  let textSize;
  try {
    projectLease = await acquireLease(
      `xcode-${sha256(manifest.ios.cwd + manifest.ios.project).slice(0, 24)}`,
    );
    await finish(directory, receipt, async () => {
      receipt.backend = await readiness(manifest, receipt.source);
      requireValue(receipt.backend, "Start the local stack before capturing");
      receipt.tools = await environmentEvidence();
      let build;
      if (buildReceiptPath) {
        build = await readJSON(resolve(buildReceiptPath));
        requireReceipt(manifest, build, "build");
        requireValue(
          build.source.digest === receipt.source.digest,
          "Build receipt is stale for the current source",
        );
        await verifyArtifact(build.appArtifact);
        await verifyArtifact(build.testRunner);
        await verifyArtifact(build.xctestrun);
      } else {
        build = await buildForSnapshot(manifest, directory, device);
      }
      receipt.build = build;
      const source = build.xctestrun.path;
      const config = absoluteTestPaths(await plist(source), resolve(source, ".."));
      const target = testTarget(config, manifest.ios.snapshot.target);
      requireValue(
        resolve(target.UITargetAppPath) === resolve(build.appArtifact.path),
        "xctestrun targets a different app artifact",
      );
      target.EnvironmentVariables = { ...target.EnvironmentVariables, ...selection.environment };
      const configured = join(directory, "capture.xctestrun");
      const temporary = join(directory, "capture.json");
      await writeJSON(temporary, config);
      await run(["plutil", "-convert", "xml1", "-o", configured, temporary]);
      await run(["xcrun", "simctl", "bootstatus", device, "-b"], { timeoutMs: 180_000 });
      appearance = await run(["xcrun", "simctl", "ui", device, "appearance"], { capture: true });
      textSize = await run(["xcrun", "simctl", "ui", device, "content_size"], { capture: true });
      await run(["xcrun", "simctl", "ui", device, "appearance", selection.appearance ?? "light"]);
      await run(["xcrun", "simctl", "ui", device, "content_size", selection.textSize ?? "large"]);
      receipt.simulators = JSON.parse(
        await run(["xcrun", "simctl", "list", "devices", "available", "-j"], { capture: true }),
      );
      receipt.device = device;
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
            `-only-testing:${manifest.ios.snapshot.test}`,
            "-resultBundlePath",
            join(directory, "capture.xcresult"),
          ],
          { cwd: manifest.ios.cwd, log: join(directory, "test.log"), timeoutMs: 600_000 },
        );
      } catch (error) {
        try {
          await exportScreenshots(directory, manifest.ios.snapshot.attachmentPrefix ?? "snapshot-");
        } catch {}
        throw error;
      }
      receipt.screenshots = await exportScreenshots(
        directory,
        manifest.ios.snapshot.attachmentPrefix ?? "snapshot-",
      );
      receipt.backend = await readiness(manifest, build.source);
      requireValue(receipt.backend, "Backend disappeared during capture");
      await verifyArtifact(build.appArtifact);
      await verifyArtifact(build.testRunner);
      await verifyArtifact(build.xctestrun);
      requireValue(
        build.source.digest === (await sourceIdentity(manifest.root)).digest,
        "Source changed during capture",
      );
    });
  } finally {
    let cleanupError;
    try {
      for (const [setting, value] of [
        ["appearance", appearance],
        ["content_size", textSize],
      ]) {
        if (!value) continue;
        try {
          await run(["xcrun", "simctl", "ui", device, setting, value]);
        } catch (error) {
          cleanupError ??= error;
        }
      }
    } finally {
      try {
        await projectLease?.release();
      } finally {
        await simulatorLease.release();
      }
    }
    if (cleanupError) {
      receipt.status = "failed";
      receipt.cleanupError = cleanupError.message;
      await writeJSON(join(directory, "receipt.json"), receipt);
      throw cleanupError;
    }
  }
}

export async function archive(manifest) {
  requireValue(manifest.ios?.release, "Manifest has no release configuration");
  const { directory, receipt } = await beginEvidence(manifest, "archive");
  const lease = await acquireLease(
    `xcode-${sha256(manifest.ios.cwd + manifest.ios.project).slice(0, 24)}`,
  );
  try {
    await finish(directory, receipt, async () => {
      await generate(manifest);
      receipt.source = await sourceIdentity(manifest.root);
      receipt.tools = await environmentEvidence();
      const path = join(directory, `${manifest.ios.appName}.xcarchive`);
      await run(
        [
          "xcodebuild",
          ...buildArguments(
            manifest,
            manifest.ios.release.configuration ?? "Release",
            "generic/platform=iOS",
          ),
          "-archivePath",
          path,
          "archive",
        ],
        { cwd: manifest.ios.cwd, log: join(directory, "archive.log") },
      );
      const appPath = join(path, "Products", "Applications", `${manifest.ios.appName}.app`);
      receipt.identity = await appIdentity(manifest, appPath, manifest.ios.release.expectedInfo);
      if (manifest.ios.release.inspectBinary) {
        command(manifest.ios.release.inspectBinary, "release.inspectBinary");
        await run(
          [...manifest.ios.release.inspectBinary, join(appPath, receipt.identity.executable)],
          { cwd: manifest.ios.cwd, log: join(directory, "inspection.log") },
        );
      }
      requireValue(
        receipt.source.digest === (await sourceIdentity(manifest.root)).digest,
        "Source changed during archive",
      );
      receipt.archive = await artifact(path);
      receipt.symbols = await artifact(join(path, "dSYMs"));
    });
  } finally {
    await lease.release();
  }
}

export async function exportArchive(manifest, receiptPath) {
  const input = await readJSON(resolve(receiptPath));
  requireReceipt(manifest, input, "archive");
  await verifyArtifact(input.archive);
  const { directory, receipt } = await beginEvidence(manifest, "export");
  await finish(directory, receipt, async () => {
    const options = resolve(manifest.ios.cwd, manifest.ios.release.exportOptions);
    const exportOptions = await plist(options);
    requireValue(
      exportOptions.destination === "export",
      "Export options must use destination=export; uploads are a separate command",
    );
    requireValue(
      exportOptions.manageAppVersionAndBuildNumber === false,
      "Export must preserve the archived version and build",
    );
    receipt.input = {
      receipt: await artifact(resolve(receiptPath)),
      archive: input.archive,
      identity: input.identity,
      source: input.source,
    };
    receipt.source = input.source;
    receipt.options = await artifact(options);
    receipt.tools = await environmentEvidence();
    const destination = join(directory, "export");
    await run(
      [
        "xcodebuild",
        "-exportArchive",
        "-archivePath",
        input.archive.path,
        "-exportPath",
        destination,
        "-exportOptionsPlist",
        options,
      ],
      { cwd: manifest.ios.cwd, log: join(directory, "export.log") },
    );
    const packages = (await readdir(destination)).filter((name) => name.endsWith(".ipa"));
    requireValue(packages.length === 1, "Expected one exported IPA");
    receipt.ipa = await artifact(join(destination, packages[0]));
    receipt.identity = input.identity;
  });
}

export async function upload(manifest, receiptPath) {
  const input = await readJSON(resolve(receiptPath));
  requireReceipt(manifest, input, "export");
  await verifyArtifact(input.ipa);
  const names = manifest.ios.release.uploadEnvironment;
  requireValue(
    names && ["keyID", "issuerID", "keyPath"].every((key) => /^[A-Z_][A-Z0-9_]*$/.test(names[key])),
    "Configure uploadEnvironment variable names",
  );
  const values = Object.fromEntries(
    Object.entries(names).map(([key, name]) => [key, process.env[name]]),
  );
  requireValue(
    values.keyID && values.issuerID && values.keyPath,
    "Required upload credentials are absent from the environment",
  );
  const { directory, receipt } = await beginEvidence(manifest, "upload");
  await finish(directory, receipt, async () => {
    receipt.ipa = input.ipa;
    receipt.identity = input.identity;
    receipt.source = input.source;
    receipt.exportReceipt = await artifact(resolve(receiptPath));
    await run(
      [
        "xcrun",
        "altool",
        "--upload-package",
        input.ipa.path,
        "--api-key",
        values.keyID,
        "--api-issuer",
        values.issuerID,
        "--p8-file-path",
        values.keyPath,
        "--wait",
        "--output-format",
        "json",
      ],
      { log: join(directory, "upload.log") },
    );
    receipt.result =
      "Upload command succeeded; inspect upload.log for Apple delivery details. This does not submit App Review.";
  });
}
