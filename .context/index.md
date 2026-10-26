# Toolkit context

The first consumers are the Sundial habit tracker and the 18 Bogeys shared scorecard proof. Their application
manifests supply service commands, scenario names, app identities and signing references. This repository owns
the execution mechanics: bounded process ownership, readiness checks, simulator leases and artifact receipts.

Portable CI runs on Linux and macOS. It checks ownership and evidence rules without pretending to exercise Xcode.
The consuming application's private evidence records the real simulator and archive/export verification required
by [the delivery contract](../.contracts/001-delivery/CONTRACT.md). Recording helpers retain original media and
explicit edit intervals; they do not synthesize product behavior.

See [the user guide](../README.md) for the manifest and commands and [the recording skill](../.agents/skills/recording/SKILL.md)
for the reusable capture workflow. Application-specific scenarios and production credentials stay in each app.
