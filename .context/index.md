# Toolkit context

The first consumers are the Sundial habit tracker and the 18 Bogeys shared scorecard proof. Their application
manifests supply service commands, scenario names, app identities and signing references. This repository owns
the execution mechanics: bounded process ownership, readiness checks, simulator leases and artifact receipts.

Portable CI runs on Linux and macOS. It checks ownership and evidence rules without pretending to exercise Xcode.
The consuming application's private evidence records real simulator and archive/export verification. The
[resource lifecycle](../.contracts/001-delivery/CONTRACT.md) and [artifact provenance](../.contracts/002-artifacts/CONTRACT.md)
contracts define the separate requirements. Recording helpers retain original media and
explicit edit intervals; they do not synthesize product behavior.

See [the user guide](../README.md) for the manifest and commands and [the recording skill](../.agents/skills/recording/SKILL.md)
for the reusable capture workflow. Application-specific scenarios and production credentials stay in each app.

Manifest version 1 is retained. `src/schemas.ts` decodes serialized inputs and receipts, and `src/types.ts` declares
resolved configuration and stage-specific results. A successful snapshot receipt follows simulator restoration and
lease release. Portable checks exercise compiled production modules. The [adoption record](../.agents/guidance-adoption.md)
identifies locked shared requirements and local adaptations.
