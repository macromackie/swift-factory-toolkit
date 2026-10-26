import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";
import type { Manifest } from "../src/types.js";
import { requireStack } from "../dist/manifest.js";
import { loadManifest } from "../dist/manifest.js";
import { artifact, readReceipt, sourceIdentity, writeJSON } from "../dist/evidence.js";
import { exportArchive } from "../dist/ios/export.js";
import { alive } from "../dist/process.js";
import { readiness, startStack, stopStack, waitReady } from "../dist/stack.js";

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    }),
  );
  return port;
}

async function fixture(t: TestContext, app: string, status = 200): Promise<Manifest> {
  const root = await mkdtemp(join(tmpdir(), "factory-test-"));
  t.after(async () => {
    const receipts = await readdir(join(root, ".local/stack")).catch(() => []);
    for (const receipt of receipts) {
      const path = join(root, ".local/stack", receipt, "receipt.json");
      const record = await readReceipt(path).catch(() => null);
      if (record?.stage === "stack" && record.owned) await stopStack(path);
    }
    await rm(root, { recursive: true, force: true });
  });
  execFileSync("git", ["init", "-q", root]);
  await writeFile(join(root, ".gitignore"), ".local/\n");
  const port = await availablePort();
  await writeFile(
    join(root, "server.mjs"),
    `import { createServer } from 'node:http';
createServer((request, response) => { response.statusCode = ${status}; response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ status: 'ok', app: ${JSON.stringify(app)}, environment: 'local', protocol: 2, build: process.env.SWIFT_FACTORY_SOURCE_ID })); }).listen(${port}, '127.0.0.1');
`,
  );
  const path = join(root, "factory.json");
  await writeJSON(path, {
    version: 1,
    root: ".",
    artifacts: ".local",
    app,
    environment: "local",
    stack: {
      command: [process.execPath, "server.mjs"],
      ready: { url: `http://127.0.0.1:${port}`, protocol: 2 },
      timeoutSeconds: 3,
      lifetimeSeconds: 20,
    },
  });
  return loadManifest(path);
}

await test("stopping a reused stack leaves the owner and a second app running", async (t) => {
  const first = await fixture(t, "first-app");
  const second = await fixture(t, "second-app");
  const owner = await startStack(first);
  await startStack(second);
  const reused = await startStack(first);
  const reusedReceipt = await readReceipt(reused);
  assert.equal(reusedReceipt.stage, "stack");
  assert.ok("owned" in reusedReceipt);
  assert.equal(reusedReceipt.owned, false);
  await stopStack(reused);
  assert.ok(await readiness(first, await sourceIdentity(first.root)));
  await stopStack(owner);
  assert.equal(await readiness(first, await sourceIdentity(first.root)), null);
  assert.ok(await readiness(second, await sourceIdentity(second.root)));
});

await test("stale backend identity is rejected without stopping the running owner", async (t) => {
  const manifest = await fixture(t, "identity-app");
  const source = await sourceIdentity(manifest.root);
  await startStack(manifest);
  await writeFile(join(manifest.root, "changed.txt"), "new source");
  await assert.rejects(startStack(manifest), /different build/);
  assert.ok(await readiness(manifest, source));
});

await test("readiness has a deadline and receipts do not copy process credentials", async (t) => {
  const manifest = await fixture(t, "bounded-app");
  requireStack(manifest).timeoutSeconds = 0.02;
  await assert.rejects(waitReady(manifest, await sourceIdentity(manifest.root)), /timed out/);
  requireStack(manifest).timeoutSeconds = 3;
  process.env["FACTORY_TEST_SECRET"] = "sentinel-do-not-record";
  t.after(() => {
    delete process.env.FACTORY_TEST_SECRET;
  });
  const receipt = await startStack(manifest);
  assert.ok(!(await readFile(receipt, "utf8")).includes(process.env.FACTORY_TEST_SECRET));
  const unavailable = await fixture(t, "unavailable-app", 503);
  requireStack(unavailable).timeoutSeconds = 1;
  await assert.rejects(startStack(unavailable), /timed out/);
  await assert.rejects(fetch(requireStack(unavailable).ready.url), /fetch failed/);
});

await test("export rejects a changed archive or a receipt for another app before invoking Xcode", async (t) => {
  const manifest = await fixture(t, "artifact-app");
  manifest.ios = {
    cwd: manifest.root,
    project: "App.xcodeproj",
    scheme: "App",
    bundleID: "com.example.app",
    appName: "App",
    jobs: 4,
    release: {
      environment: "production",
      configuration: "Release",
      exportOptions: "Export.plist",
      expectedInfo: {},
    },
  };
  const path = join(manifest.root, "archive");
  await writeFile(path, "original artifact");
  const receiptPath = join(manifest.root, "receipt.json");
  const receipt = {
    schema: 1,
    toolkit: "0.2.0",
    source: await sourceIdentity(manifest.root),
    tools: { xcode: "fixture", host: "fixture" },
    identity: {
      bundleID: "com.example.app",
      version: "1.0",
      build: "1",
      minimumOS: "26.0",
      executable: "App",
      sdk: "iphoneos",
      xcodeBuild: "fixture",
    },
    symbols: await artifact(path),
    stage: "archive",
    status: "succeeded",
    app: manifest.app,
    environment: "production",
    manifestHash: manifest.hash,
    archive: await artifact(path),
  };
  await writeJSON(receiptPath, receipt);
  await writeFile(path, "wrong artifact");
  await assert.rejects(exportArchive(manifest, receiptPath), /Artifact has changed/);
  await writeJSON(receiptPath, { ...receipt, app: "different-app" });
  await assert.rejects(exportArchive(manifest, receiptPath), /Receipt does not match/);
});

await test("a process awaiting reaping still exists when its existence probe returns EPERM", (t) => {
  t.mock.method(process, "kill", () => {
    throw Object.assign(new Error("Permission denied during process teardown"), { code: "EPERM" });
  });
  assert.equal(alive(-12345), true);
});
