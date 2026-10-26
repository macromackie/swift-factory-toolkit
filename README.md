# Swift Factory Toolkit

`@macromackie/swift-factory-toolkit` runs owned local stacks, captures real iOS test scenarios and records explicit
archive, export and upload stages. Applications provide commands and identity in a small JSON manifest. XcodeGen,
Xcode, mise and the application's tests keep their existing jobs.

## Install

Install the versioned package tarball from the GitHub release and commit your package-manager lockfile:

```sh
pnpm add -D https://github.com/macromackie/swift-factory-toolkit/releases/download/v0.2.0/macromackie-swift-factory-toolkit-0.2.0.tgz
pnpm exec swift-factory --help
```

For a source checkout, use the pinned Node 22.23.2 and pnpm 10.28.0 with `mise exec -- pnpm install --frozen-lockfile`.
`pnpm build` compiles the strict TypeScript CLI into `dist`; `pnpm pack` includes the runnable CLI, native helpers,
recording skill and contracts. A Git dependency also runs `prepare`. Node 22 or later runs the portable commands.

iOS commands require macOS, full Xcode selected through `DEVELOPER_DIR` or `xcode-select`, and the simulator runtime
supported by your application. Recording requires macOS 15 or later and screen-recording permission. Video editing
requires `uv`; its Python script pins `imageio-ffmpeg` and prefers an existing `ffmpeg` on PATH.

## Configure

Save the manifest in the application repository. `root` is relative to the manifest; `artifacts`, stack `cwd` and iOS
`cwd` are relative to root. Xcode project, export options and inspection commands run relative to the iOS directory.
Commands are argument arrays, never shell expressions. Keep secrets out of the manifest. The toolkit validates the
manifest at startup, resolves its paths once, and validates saved receipts and tool output before using them.

```json
{
  "version": 1,
  "app": "example",
  "environment": "local",
  "root": ".",
  "artifacts": ".local/factory",
  "stack": {
    "command": ["pnpm", "dev"],
    "ready": { "url": "http://127.0.0.1:8797/health", "protocol": 2 },
    "timeoutSeconds": 90,
    "lifetimeSeconds": 1800
  },
  "ios": {
    "cwd": "workspaces/swift",
    "project": "apps/example/Example.xcodeproj",
    "scheme": "Example",
    "appName": "Example",
    "bundleID": "com.example.app",
    "generate": ["mise", "run", "generate"],
    "jobs": 4,
    "snapshot": {
      "target": "ExampleUITests",
      "test": "ExampleUITests/SnapshotTests/testCapture",
      "buildSettings": ["API_ORIGIN=http://127.0.0.1:8797", "CODE_SIGN_IDENTITY=-"],
      "expectedInfo": { "APIOrigin": "http://127.0.0.1:8797" },
      "scenarios": {
        "welcome": {
          "environment": { "EXAMPLE_CAPTURE": "welcome" },
          "appearance": "light",
          "textSize": "large"
        }
      }
    },
    "release": {
      "environment": "production",
      "configuration": "Release",
      "exportOptions": "apps/example/ExportOptions.plist",
      "uploadEnvironment": {
        "keyID": "APP_STORE_CONNECT_KEY_ID",
        "issuerID": "APP_STORE_CONNECT_ISSUER_ID",
        "keyPath": "APP_STORE_CONNECT_KEY_PATH"
      }
    }
  }
}
```

Each app owns its scenarios, accounts, API origin, supported OS, signing and App Store record. Optional
`ios.appTarget` selects the Xcode application target when it differs from `ios.scheme`; `ios.appName` is the built
product name without `.app`, which may contain spaces. Optional
`release.inspectBinary` is a command array; the CLI appends the archived executable path. Use it for a named app-owned
binary inspection. `release.expectedInfo` checks additional archived Info.plist values such as API environment.
The application's generate command must seed the generated Xcode project's `Package.resolved` from its committed lock.
Builds pass `-onlyUsePackageVersionsFromResolvedFile` so Xcode fails instead of choosing a new dependency version.

## Local stacks

The command receives `SWIFT_FACTORY_SOURCE_ID`. Pass that value to the backend runtime's configuration. The readiness
endpoint must return these exact fields:

```json
{
  "status": "ok",
  "app": "example",
  "environment": "local",
  "protocol": 2,
  "build": "<SWIFT_FACTORY_SOURCE_ID>"
}
```

`swift-factory evidence source .` calculates the same fingerprint for manual startup. It hashes Git's tracked and
unignored files, omitting `.config/` and `.env` files; receipts retain only the digest, revision and dirty flag. Add
artifact directories and generated local files to `.gitignore`. Runtime configuration remains the app's responsibility.

```sh
pnpm exec swift-factory stack run factory.json -- swift test --package-path workspaces/swift/packages/core --jobs 4
pnpm exec swift-factory stack start factory.json
pnpm exec swift-factory stack stop .local/factory/stack/<run-id>/receipt.json
```

Readiness accepts loopback HTTP only, has a 90-second default deadline, and rejects a different running backend.
`stack run` tears down only the stack it started. `stack start` retains an independent supervisor for at most 30 minutes
by default; configure up to 24 hours. The application command must forward termination to its services and own only its
own database/container resources. The supervisor cannot infer ownership of services detached by that command.

Receipts and logs identify each run. The toolkit serializes starts at one readiness URL. If a process is killed before
cleanup, inspect its recorded PID, log and lease before removing an abandoned lock. It never steals an existing lease.

## Simulator evidence

```sh
pnpm exec swift-factory ios snapshot factory.json welcome --device <simulator-uuid>
pnpm exec swift-factory ios snapshot factory.json welcome --device <simulator-uuid> \
  --build-receipt .local/factory/snapshot/<run-id>/build-receipt.json
```

Start the matching backend first. The app's UI test must attach PNGs named `snapshot-*` (or the configured
`snapshot.attachmentPrefix`). It can attach accessibility data under its own names. Captures retain the xcresult,
attachments, gallery, tool and device inventory, logs and receipt. Failed tests retain their evidence and exit nonzero.

The fresh build uses normal Xcode DerivedData and selects the scheme xctestrun matching the current Xcode
`SDK_NAME` and `ARCHS` build settings. Other SDK or architecture builds stay in place; the toolkit never chooses
the newest file. The build receipt ties current source/configuration to the app, test runner and xctestrun hashes; reuse
checks each before launching. Toolkit builds for the same project are serialized. Avoid changing that project's outputs
with an external Xcode build during capture. The simulator lease is shared across toolkit applications on that host.
Appearance and text size are restored before releasing it; the app's own account state is controlled by its scenario.

## Distribution

```sh
pnpm exec swift-factory ios archive factory.json
pnpm exec swift-factory ios export factory.json --receipt .local/factory/archive/<run-id>/receipt.json
pnpm exec swift-factory ios upload factory.json --receipt .local/factory/export/<run-id>/receipt.json
```

Each stage creates a new output directory and receipt. Archive records app/version/build/minimum OS, source, Xcode,
archive and symbols. Export verifies the archive's app, manifest and hash. Its plist must set `destination` to `export`
and `manageAppVersionAndBuildNumber` to `false`. Upload verifies the IPA hash and reads credential variables by name.
Its private log records Apple's response. Upload success does not submit App Review or release the build to customers.

`swift-factory evidence inspect <receipt>` validates direct artifact hashes and prints the receipt. Keep receipts,
logs, device inventories and recordings private unless you have inspected them for disclosure.

## Recording

Use the packaged [recording skill](.agents/skills/recording/SKILL.md) for capture and editing. Keep the app walkthrough,
authorized accounts and review notes in the application repository.

```sh
pnpm exec swift-factory record capture .local/take.mp4 .local/take.stop 600
touch .local/take.stop
pnpm exec swift-factory record edit .local/edit.json
```

Capture defaults to one visible iPhone Mirroring window. An optional fourth argument selects a different application's
bundle ID. It records without audio or cursor, refuses existing files and bounds capture to 1–1,200 seconds. The editor
keeps raw sources, records hashes and explicit cuts, and refuses existing output. Inspect every resulting cut and screen.

## Shared checks

The package exports three optional development configurations:

- `@macromackie/swift-factory-toolkit/config/eslint`: `strictTypeScript({ root, files?, ignores? })`.
- `@macromackie/swift-factory-toolkit/config/tsconfig.json`: strict compiler settings.
- `@macromackie/swift-factory-toolkit/config/dependencies`: `dependencyRules({ tsconfig?, forbidden?, externalModules? })`.

Consumers declare the ESLint, typescript-eslint and dependency-cruiser tools they use as development dependencies.
These optional peers are not needed to run the CLI. Extend the compiler configuration and override platform-specific
module resolution or libraries in the consuming package. Keep package ownership and extra dependency rules there.
The dependency preset resolves package exports and counts type-only imports when checking cycles. Declare runtime-only
built-ins by exact name, such as `externalModules: ["cloudflare:workers"]`; undeclared unresolved imports still fail.

TypeScript 7 ships a native compiler without the API that type-aware ESLint requires. This checkout follows
[Microsoft’s side-by-side setup](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0):
`@typescript/native` aliases compiler 7.0.2; `typescript` provides the 6.0 API for typescript-eslint. The build and
`typecheck` command invoke the native compiler explicitly. This keeps the application compiler at 7 while lint
uses its supported API.

## Verify

`pnpm check` compiles the CLI, checks formatting and types, runs type-aware lint and resolved import checks, and tests
owned cleanup, concurrent app isolation, stale backend rejection, bounded readiness, receipt redaction and changed
archive rejection without requiring Xcode. Tests exercise the compiled modules used by the installed CLI. Real simulator, signing, export and recording checks depend on
the consuming application's environment; passing portable tests does not establish those behaviors on a device.
