---
name: artifacts
message: Validate stage-specific artifact receipts and distribute only the bytes whose identity was checked.
paths: ["src/**/*.ts", "test/**/*.ts", "test/**/*.js", "helpers/**/*"]
---

# Artifact provenance

## Rules

Parse manifests and receipts from unknown input through their declared schema. Keep resolved runtime paths separate
from the serialized input. Give stack, build, snapshot, archive, export and upload receipts distinct stage-specific
representations; validate the required stage and success state before consuming a receipt.

Bind reusable test builds to source, manifest, application, runner and xctestrun hashes. Reject missing, changed or
cross-application artifacts. Inspect the actual app's bundle identity and platform settings, not only a filename.
Keep archive, export and upload separate. Export preserves the archive version and build and cannot upload.
An upload command's success does not establish App Review submission or customer release.

Retain raw recordings and explicit edit intervals with source hashes. Retained footage plays at real speed; an edit
removes idle intervals without synthesizing product behavior. Treat logs, screenshots and recordings as private
application evidence. Receipts contain identities and hashes, not environment dumps, credentials or source contents.

Publish immutable package versions with explicit contents. Inspect the release archive and exercise its public entry
points before publication. Keep local receipts, recordings, private app inputs and credentials out of the package.

## Checks

Run `pnpm check` for strict TypeScript, formatting, typed lint, dependency checks and the portable tests.
`src/schemas.ts` owns input decoding; `src/types.ts` owns stage representations. Exercise malformed, changed and
wrong-stage artifacts. Run a real snapshot with fresh and reused build
receipts and inspect its screenshot and accessibility attachments. Run an authorized archive/export and inspect the
app identity, artifact hashes and stage receipts. Upload remains a separately authorized operation.
