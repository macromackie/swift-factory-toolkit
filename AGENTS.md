# Swift Factory Toolkit

Read [.contracts](.contracts/index.md) before changing resource or artifact handling. Keep application scenarios,
credentials, endpoints, signing policy and release decisions in the consuming repository.

Use `mise exec -- pnpm install --frozen-lockfile`, then `mise run check` and `mise run build`.
The Node tests need no Apple toolchain. Simulator, archive and recording checks require macOS and full Xcode.
Inspect a release tarball before publication. Never include local receipts, recordings, credentials or app source.
