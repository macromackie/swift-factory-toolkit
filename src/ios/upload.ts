import { join, resolve } from "node:path";
import {
  artifact,
  beginEvidence,
  finishEvidence,
  readJSON,
  requireReceipt,
  verifyArtifact,
} from "../evidence.js";
import { exportReceiptSchema } from "../schemas.js";
import { requireRelease } from "../manifest.js";
import { run } from "../process.js";
import type { Manifest } from "../types.js";

export async function upload(manifest: Manifest, receiptPath: string): Promise<void> {
  const input = exportReceiptSchema.parse(await readJSON(resolve(receiptPath)));
  requireReceipt(manifest, input, "export");
  await verifyArtifact(input.ipa);
  const names = requireRelease(manifest).uploadEnvironment;
  if (!names) throw new Error("Configure uploadEnvironment variable names");
  const keyID = process.env[names.keyID];
  const issuerID = process.env[names.issuerID];
  const keyPath = process.env[names.keyPath];
  if (!keyID || !issuerID || !keyPath)
    throw new Error("Required upload credentials are absent from the environment");
  const evidence = await beginEvidence(manifest, "upload");
  await finishEvidence(evidence, async () => {
    await run(
      [
        "xcrun",
        "altool",
        "--upload-package",
        input.ipa.path,
        "--api-key",
        keyID,
        "--api-issuer",
        issuerID,
        "--p8-file-path",
        keyPath,
        "--wait",
        "--output-format",
        "json",
      ],
      { log: join(evidence.directory, "upload.log") },
    );
    return {
      ipa: input.ipa,
      identity: input.identity,
      source: input.source,
      exportReceipt: await artifact(resolve(receiptPath)),
      result:
        "Upload command succeeded; inspect upload.log for Apple delivery details. This does not submit App Review.",
    };
  });
}
