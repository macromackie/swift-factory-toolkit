import { join } from "node:path";
import { artifact, beginEvidence, finishEvidence, sha256, sourceIdentity } from "../evidence.js";
import { requireIOS, requireRelease } from "../manifest.js";
import { run } from "../process.js";
import { acquireLease } from "../stack.js";
import type { Manifest } from "../types.js";
import { appIdentity, buildArguments, environmentEvidence, generate } from "./tools.js";

export async function archive(manifest: Manifest): Promise<void> {
  const ios = requireIOS(manifest);
  const release = requireRelease(manifest);
  const evidence = await beginEvidence(manifest, "archive");
  await finishEvidence(evidence, async () => {
    const lease = await acquireLease(`xcode-${sha256(ios.cwd + ios.project).slice(0, 24)}`);
    try {
      await generate(manifest);
      const source = await sourceIdentity(manifest.root);
      const tools = await environmentEvidence();
      const path = join(evidence.directory, `${ios.appName}.xcarchive`);
      await run(
        [
          "xcodebuild",
          ...buildArguments(manifest, release.configuration, "generic/platform=iOS"),
          "-archivePath",
          path,
          "archive",
        ],
        { cwd: ios.cwd, log: join(evidence.directory, "archive.log") },
      );
      const appPath = join(path, "Products", "Applications", `${ios.appName}.app`);
      const identity = await appIdentity(manifest, appPath, release.expectedInfo);
      if (release.inspectBinary)
        await run([...release.inspectBinary, join(appPath, identity.executable)], {
          cwd: ios.cwd,
          log: join(evidence.directory, "inspection.log"),
        });
      if (source.digest !== (await sourceIdentity(manifest.root)).digest)
        throw new Error("Source changed during archive");
      return {
        source,
        tools,
        identity,
        archive: await artifact(path),
        symbols: await artifact(join(path, "dSYMs")),
      };
    } finally {
      await lease.release();
    }
  });
}
