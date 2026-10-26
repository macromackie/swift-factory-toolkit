import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  artifact,
  beginEvidence,
  finishEvidence,
  readJSON,
  requireReceipt,
  verifyArtifact,
} from "../evidence.js";
import { archiveReceiptSchema } from "../schemas.js";
import { requireIOS, requireRelease } from "../manifest.js";
import { run } from "../process.js";
import type { Manifest } from "../types.js";
import { environmentEvidence, object, plist } from "./tools.js";

export async function exportArchive(manifest: Manifest, receiptPath: string): Promise<void> {
  const input = archiveReceiptSchema.parse(await readJSON(resolve(receiptPath)));
  requireReceipt(manifest, input, "archive");
  await verifyArtifact(input.archive);
  const ios = requireIOS(manifest);
  const release = requireRelease(manifest);
  const evidence = await beginEvidence(manifest, "export");
  await finishEvidence(evidence, async () => {
    const options = resolve(ios.cwd, release.exportOptions);
    const exportOptions = object(await plist(options), "Export options");
    if (exportOptions["destination"] !== "export")
      throw new Error("Export options must use destination=export; uploads are a separate command");
    if (exportOptions["manageAppVersionAndBuildNumber"] !== false)
      throw new Error("Export must preserve the archived version and build");
    const destination = join(evidence.directory, "export");
    const tools = await environmentEvidence();
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
      { cwd: ios.cwd, log: join(evidence.directory, "export.log") },
    );
    const packages = (await readdir(destination)).filter((name) => name.endsWith(".ipa"));
    const name = packages[0];
    if (packages.length !== 1 || !name) throw new Error("Expected one exported IPA");
    return {
      source: input.source,
      input: {
        receipt: await artifact(resolve(receiptPath)),
        archive: input.archive,
        identity: input.identity,
        source: input.source,
      },
      options: await artifact(options),
      tools,
      ipa: await artifact(join(destination, name)),
      identity: input.identity,
    };
  });
}
