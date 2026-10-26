#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readJSON, sourceIdentity, verifyArtifact } from "./evidence.js";
import { archive, exportArchive, snapshot, upload } from "./ios.js";
import { loadManifest, requireValue } from "./manifest.js";
import { run } from "./process.js";
import { startStack, stopStack, withStack } from "./stack.js";

const usage = `swift-factory 0.1.0

  stack start <manifest>
  stack stop <stack-receipt>
  stack run <manifest> -- <command...>
  ios snapshot <manifest> <scenario> --device <UUID> [--build-receipt <path>]
  ios archive <manifest>
  ios export <manifest> --receipt <archive-receipt>
  ios upload <manifest> --receipt <export-receipt>
  evidence source <repository-root>
  evidence inspect <receipt>
  record capture <output.mp4> <stop-file> [maximum-seconds] [application-bundle-id]
  record edit <edit-manifest>

Use a private application manifest. Archive and export never upload.
`;

function takeOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  requireValue(value && !value.startsWith("--"), `${name} needs a value`);
  args.splice(index, 2);
  return value;
}

async function main() {
  const [group, action, ...args] = process.argv.slice(2);
  if (!group || group === "--help" || group === "--version") {
    console.log(usage);
    return;
  }
  if (group === "evidence" && action === "source") {
    requireValue(args.length === 1, "Provide the repository root");
    console.log((await sourceIdentity(resolve(args[0]))).digest);
    return;
  }
  if (group === "evidence" && action === "inspect") {
    requireValue(args.length === 1, "Provide a receipt");
    const receipt = await readJSON(resolve(args[0]));
    for (const field of ["archive", "ipa", "appArtifact", "testRunner", "xctestrun"]) {
      if (receipt[field]) await verifyArtifact(receipt[field]);
    }
    console.log(JSON.stringify(receipt, null, 2));
    return;
  }
  if (group === "stack" && action === "stop") {
    requireValue(args.length === 1, "Provide a stack receipt");
    await stopStack(args[0]);
    return;
  }
  if (group === "stack") {
    const manifest = await loadManifest(args.shift());
    if (action === "start" && args.length === 0) {
      console.log(await startStack(manifest));
      return;
    }
    if (action === "run" && args.shift() === "--" && args.length) {
      await withStack(manifest, async (receipt) => {
        console.log(`Stack receipt: ${receipt}`);
        const ownership = await readJSON(receipt);
        await run(args, {
          cwd: process.cwd(),
          env: { SWIFT_FACTORY_SOURCE_ID: ownership.source.digest },
          timeoutMs: manifest.stack.lifetimeSeconds * 1000,
        });
      });
      return;
    }
  }
  if (group === "ios") {
    const manifest = await loadManifest(args.shift());
    if (action === "archive" && args.length === 0) {
      await archive(manifest);
      return;
    }
    if (action === "snapshot") {
      const device = takeOption(args, "--device");
      const receipt = takeOption(args, "--build-receipt");
      requireValue(args.length === 1 && device, "Provide one scenario and --device");
      await snapshot(manifest, args[0], device, receipt);
      return;
    }
    const receipt = takeOption(args, "--receipt");
    if (receipt && args.length === 0) {
      if (action === "export") {
        await exportArchive(manifest, receipt);
        return;
      }
      if (action === "upload") {
        await upload(manifest, receipt);
        return;
      }
    }
  }
  if (group === "record") {
    const helpers = resolve(dirname(fileURLToPath(import.meta.url)), "../helpers");
    if (action === "edit" && args.length === 1) {
      await run(["uv", "run", join(helpers, "edit-video.py"), resolve(args[0])]);
      return;
    }
    if (action === "capture" && args.length >= 2 && args.length <= 4) {
      const temporary = await mkdtemp(join(tmpdir(), "swift-factory-capture-"));
      try {
        const binary = join(temporary, "record-window");
        await run([
          "xcrun",
          "swiftc",
          "-parse-as-library",
          "-O",
          join(helpers, "record-window.swift"),
          "-o",
          binary,
        ]);
        await run([binary, ...args], { timeoutMs: 1_230_000 });
      } finally {
        await rm(temporary, { recursive: true });
      }
      return;
    }
  }
  throw new Error(usage);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
