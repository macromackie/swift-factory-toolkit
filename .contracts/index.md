# Swift Factory Toolkit contracts

- [Resource lifecycle](001-delivery/CONTRACT.md): stack ownership, simulator leases and interruption cleanup.
- [Artifact provenance](002-artifacts/CONTRACT.md): validated stage receipts, hashes and separate release steps.
- [Compiler strictness](004-code-typescript-compiler-strictness/CONTRACT.md): strict source, scripts and tests.
- [Shared ownership](005-code-ownership-and-boundaries/CONTRACT.md): application configuration and reusable execution boundaries.
- [Contract maintenance](006-contract-maintenance/CONTRACT.md): scoped requirements and update provenance.

Run `mise run check:contracts` for document validation and the root `mise run check` for required code checks.
Shared contracts are pinned in [`.tenet.lock`](../.tenet.lock). Their `Local adaptations` sections define repository
scope; [the adoption record](../.agents/guidance-adoption.md) explains the reviewed source and retained differences.
Model assessments are separate from deterministic checks and must report provider failures or incomplete scope.
