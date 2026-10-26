import { spawn, execFileSync } from "node:child_process";
import { mkdir, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { beginEvidence, readJSON, sha256, writeJSON } from "./evidence.js";
import { alive, delay } from "./process.js";

export async function readiness(manifest, source) {
  let response;
  try {
    response = await fetch(manifest.stack.ready.url, {
      signal: AbortSignal.timeout(2000),
      redirect: "error",
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("The readiness endpoint returned a non-JSON response");
  }
  const expected = {
    status: "ok",
    app: manifest.app,
    environment: manifest.environment,
    protocol: manifest.stack.ready.protocol,
    build: source.digest,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (body[key] !== value)
      throw new Error(
        `Running backend has a different ${key}; stop its owning task or use another port`,
      );
  }
  return expected;
}

export async function waitReady(manifest, source, ownerAlive = () => true) {
  const deadline = Date.now() + manifest.stack.timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    if (!ownerAlive()) throw new Error("Owned stack exited before becoming ready");
    const result = await readiness(manifest, source);
    if (result) return result;
    await delay(Math.min(250, Math.max(0, deadline - Date.now())));
  }
  throw new Error(`Backend readiness timed out after ${manifest.stack.timeoutSeconds} seconds`);
}

export async function acquireLease(name) {
  const directory = join(tmpdir(), `swift-factory-${process.getuid?.() ?? "user"}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${name}.lock`);
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (error.code === "EEXIST")
      throw new Error(`Resource is leased: ${path}. Inspect its owner before manual recovery.`);
    throw error;
  }
  const owner = { pid: process.pid, nonce: randomUUID(), createdAt: new Date().toISOString() };
  await writeJSON(join(path, "owner.json"), owner);
  return {
    path,
    nonce: owner.nonce,
    async release() {
      const current = await readJSON(join(path, "owner.json"));
      if (current.nonce !== owner.nonce) throw new Error("Lease ownership changed");
      await rm(path, { recursive: true });
    },
  };
}

export async function startStack(manifest) {
  if (!manifest.stack) throw new Error("Manifest has no stack");
  const evidence = await beginEvidence(manifest, "stack");
  const receiptPath = join(evidence.directory, "receipt.json");
  const receipt = evidence.receipt;
  const existing = await readiness(manifest, receipt.source);
  if (existing) {
    Object.assign(receipt, { status: "reused", owned: false, identity: existing });
    await writeJSON(receiptPath, receipt);
    return receiptPath;
  }
  const lease = await acquireLease(`stack-${sha256(manifest.stack.ready.url).slice(0, 24)}`);
  let supervisor;
  try {
    receipt.owned = true;
    receipt.nonce = randomUUID();
    receipt.lease = lease.path;
    receipt.leaseNonce = lease.nonce;
    receipt.deadline = new Date(Date.now() + manifest.stack.lifetimeSeconds * 1000).toISOString();
    await writeJSON(receiptPath, receipt);
    const log = await open(join(evidence.directory, "stack.log"), "a", 0o600);
    let spawned;
    try {
      supervisor = spawn(
        process.execPath,
        [
          fileURLToPath(new URL("./supervise.js", import.meta.url)),
          manifest.path,
          receiptPath,
          receipt.nonce,
        ],
        { detached: true, stdio: ["ignore", log.fd, log.fd] },
      );
      spawned = new Promise((resolve, reject) => {
        supervisor.once("spawn", resolve);
        supervisor.once("error", reject);
      });
    } finally {
      await log.close();
    }
    await spawned;
    supervisor.unref();
    const identity = await waitReady(manifest, receipt.source, () => alive(supervisor.pid));
    const ready = await readJSON(receiptPath);
    if (!ready.owner || ready.status !== "running")
      throw new Error("Stack supervisor did not retain ownership");
    ready.identity = identity;
    await writeJSON(join(evidence.directory, "ready.json"), { ...ready, status: "ready" });
    return receiptPath;
  } catch (error) {
    await writeJSON(join(evidence.directory, "failure.json"), { error: error.message });
    if (supervisor?.pid) {
      if (alive(supervisor.pid)) process.kill(supervisor.pid, "SIGTERM");
      await waitStopped(receiptPath);
    } else {
      await lease.release();
    }
    throw new Error(`${error.message}; inspect ${evidence.directory}`);
  }
}

export async function stopStack(receiptPath) {
  const path = resolve(receiptPath);
  const receipt = await readJSON(path);
  if (receipt.stage !== "stack" || receipt.schema !== 1) throw new Error("Not a stack receipt");
  if (!receipt.owned || receipt.status === "stopped") return;
  const pid = receipt.owner?.pid;
  if (!Number.isInteger(pid) || !receipt.nonce)
    throw new Error("Incomplete stack ownership; inspect the receipt");
  if (!alive(pid))
    throw new Error("Stack supervisor is absent; inspect its log and lease before manual recovery");
  const args = execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
  if (!args.includes(receipt.nonce) || !args.includes(path) || !args.includes("supervise.js")) {
    throw new Error("Process identity changed; refusing to signal it");
  }
  process.kill(pid, "SIGTERM");
  await waitStopped(path);
}

async function waitStopped(path) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if ((await readJSON(path)).status === "stopped") return;
    await delay(100);
  }
  throw new Error("Stack did not confirm cleanup; inspect its receipt and log");
}

export async function withStack(manifest, action) {
  const receiptPath = await startStack(manifest);
  try {
    return await action(receiptPath);
  } finally {
    await stopStack(receiptPath);
  }
}
