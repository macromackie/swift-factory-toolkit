import { resolve } from "node:path";
import { readReceipt, sourceIdentity, verifyArtifact, version } from "./evidence.js";
import { archive } from "./ios/archive.js";
import { exportArchive } from "./ios/export.js";
import { snapshot } from "./ios/snapshot.js";
import { upload } from "./ios/upload.js";
import { loadManifest, requireStack } from "./manifest.js";
import { run } from "./process.js";
import { captureRecording, editRecording } from "./recording.js";
import { startStack, stopStack, withStack } from "./stack.js";
import { usage } from "./arguments.js";
import type { Invocation } from "./arguments.js";
import type { Receipt } from "./types.js";

async function inspectReceipt(path: string): Promise<void> {
  const receipt = await readReceipt(resolve(path));
  await inspectArtifacts(receipt);
  console.log(JSON.stringify(receipt, null, 2));
}
async function inspectArtifacts(receipt: Receipt): Promise<void> {
  if (receipt.status !== "succeeded") return;
  switch (receipt.stage) {
    case "build":
      await verifyArtifact(receipt.appArtifact);
      await verifyArtifact(receipt.testRunner);
      await verifyArtifact(receipt.xctestrun);
      return;
    case "archive":
      await verifyArtifact(receipt.archive);
      await verifyArtifact(receipt.symbols);
      return;
    case "export":
      await verifyArtifact(receipt.ipa);
      await verifyArtifact(receipt.options);
      await verifyArtifact(receipt.input.receipt);
      await verifyArtifact(receipt.input.archive);
      return;
    case "upload":
      await verifyArtifact(receipt.ipa);
      await verifyArtifact(receipt.exportReceipt);
      return;
    case "snapshot":
      await inspectArtifacts(receipt.build);
      for (const screenshot of receipt.screenshots) await verifyArtifact(screenshot);
      return;
  }
}
export async function execute(invocation: Invocation): Promise<void> {
  switch (invocation.kind) {
    case "help":
      console.log(usage);
      return;
    case "version":
      console.log(version);
      return;
    case "source":
      console.log((await sourceIdentity(resolve(invocation.root))).digest);
      return;
    case "inspect":
      await inspectReceipt(invocation.receipt);
      return;
    case "stop":
      await stopStack(invocation.receipt);
      return;
    case "start":
      console.log(await startStack(await loadManifest(invocation.manifest)));
      return;
    case "run": {
      const manifest = await loadManifest(invocation.manifest);
      await withStack(manifest, async (path) => {
        console.log(`Stack receipt: ${path}`);
        const ownership = await readReceipt(path);
        await run(invocation.command, {
          cwd: process.cwd(),
          env: { SWIFT_FACTORY_SOURCE_ID: ownership.source.digest },
          timeoutMs: requireStack(manifest).lifetimeSeconds * 1000,
        });
      });
      return;
    }
    case "snapshot":
      await snapshot(
        await loadManifest(invocation.manifest),
        invocation.scenario,
        invocation.device,
        invocation.buildReceipt,
      );
      return;
    case "archive":
      await archive(await loadManifest(invocation.manifest));
      return;
    case "export":
      await exportArchive(await loadManifest(invocation.manifest), invocation.receipt);
      return;
    case "upload":
      await upload(await loadManifest(invocation.manifest), invocation.receipt);
      return;
    case "edit":
      await editRecording(invocation.path);
      return;
    case "capture":
      await captureRecording(invocation.args);
      return;
  }
}
