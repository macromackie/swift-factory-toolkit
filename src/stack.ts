import { spawn, execFileSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdir, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  beginEvidence,
  errorMessage,
  hasErrorCode,
  readJSON,
  readReceipt,
  sha256,
  writeJSON,
} from "./evidence.js";
import { backendSchema, leaseOwnerSchema, stackReceiptSchema } from "./schemas.js";
import { requireStack } from "./manifest.js";
import { alive, delay } from "./process.js";
import type { BackendIdentity, Lease, Manifest, SourceIdentity } from "./types.js";

export async function readiness(
  manifest: Manifest,
  source: SourceIdentity,
): Promise<BackendIdentity | null> {
  const stack = requireStack(manifest);
  let response: Response;
  try {
    response = await fetch(stack.ready.url, {
      signal: AbortSignal.timeout(2000),
      redirect: "error",
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const raw: unknown = await response.json().catch(() => {
    throw new Error("The readiness endpoint returned a non-JSON response");
  });
  const body = backendSchema.parse(raw);
  const expected: BackendIdentity = {
    status: "ok",
    app: manifest.app,
    environment: manifest.environment,
    protocol: stack.ready.protocol,
    build: source.digest,
  };
  for (const key of ["status", "app", "environment", "protocol", "build"] as const) {
    if (body[key] !== expected[key])
      throw new Error(
        `Running backend has a different ${key}; stop its owning task or use another port`,
      );
  }
  return expected;
}
export async function waitReady(
  manifest: Manifest,
  source: SourceIdentity,
  ownerAlive: () => boolean = () => true,
): Promise<BackendIdentity> {
  const stack = requireStack(manifest);
  const deadline = Date.now() + stack.timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    if (!ownerAlive()) throw new Error("Owned stack exited before becoming ready");
    const result = await readiness(manifest, source);
    if (result) return result;
    await delay(Math.min(250, Math.max(0, deadline - Date.now())));
  }
  throw new Error(`Backend readiness timed out after ${stack.timeoutSeconds} seconds`);
}
export async function acquireLease(name: string): Promise<Lease> {
  const directory = join(tmpdir(), `swift-factory-${process.getuid?.() ?? "user"}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${name}.lock`);
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (hasErrorCode(error, "EEXIST"))
      throw new Error(`Resource is leased: ${path}. Inspect its owner before manual recovery.`, {
        cause: error,
      });
    throw error;
  }
  const owner = { pid: process.pid, nonce: randomUUID(), createdAt: new Date().toISOString() };
  await writeJSON(join(path, "owner.json"), owner);
  return {
    path,
    nonce: owner.nonce,
    async release() {
      const current = leaseOwnerSchema.parse(await readJSON(join(path, "owner.json")));
      if (current.nonce !== owner.nonce) throw new Error("Lease ownership changed");
      await rm(path, { recursive: true });
    },
  };
}
function supervisorPID(child: ChildProcess): number {
  if (!child.pid) throw new Error("Stack supervisor has no process identifier");
  return child.pid;
}
export async function startStack(manifest: Manifest): Promise<string> {
  const stack = requireStack(manifest);
  const evidence = await beginEvidence(manifest, "stack");
  const receiptPath = join(evidence.directory, "receipt.json");
  const existing = await readiness(manifest, evidence.receipt.source);
  if (existing) {
    await writeJSON(receiptPath, {
      ...evidence.receipt,
      status: "reused",
      owned: false,
      identity: existing,
    });
    return receiptPath;
  }
  const lease = await acquireLease(`stack-${sha256(stack.ready.url).slice(0, 24)}`);
  let supervisor: ChildProcess | undefined;
  const nonce = randomUUID();
  try {
    const receipt = {
      ...evidence.receipt,
      status: "starting",
      owned: true,
      nonce,
      lease: lease.path,
      leaseNonce: lease.nonce,
      deadline: new Date(Date.now() + stack.lifetimeSeconds * 1000).toISOString(),
    };
    await writeJSON(receiptPath, receipt);
    const log = await open(join(evidence.directory, "stack.log"), "a", 0o600);
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
      const child = supervisor;
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
    } finally {
      await log.close();
    }
    supervisor.unref();
    const pid = supervisorPID(supervisor);
    const identity = await waitReady(manifest, receipt.source, () => alive(pid));
    const ready = stackReceiptSchema.parse(await readJSON(receiptPath));
    if (ready.status !== "running") throw new Error("Stack supervisor did not retain ownership");
    await writeJSON(join(evidence.directory, "ready.json"), {
      ...ready,
      status: "ready",
      identity,
    });
    return receiptPath;
  } catch (error) {
    await writeJSON(join(evidence.directory, "failure.json"), { error: errorMessage(error) });
    if (supervisor?.pid) {
      if (alive(supervisor.pid)) signalSupervisor(supervisor.pid, receiptPath, nonce);
      await waitStopped(receiptPath);
    } else {
      await lease.release();
    }
    throw new Error(`${errorMessage(error)}; inspect ${evidence.directory}`, { cause: error });
  }
}
export async function stopStack(receiptPath: string): Promise<void> {
  const path = resolve(receiptPath);
  const receipt = await readReceipt(path);
  if (receipt.stage !== "stack") throw new Error("Not a stack receipt");
  if (receipt.status === "reused" || receipt.status === "stopped") return;
  if (receipt.status !== "running")
    throw new Error("Incomplete stack ownership; inspect the receipt");
  const pid = receipt.owner.pid;
  if (!alive(pid))
    throw new Error("Stack supervisor is absent; inspect its log and lease before manual recovery");
  signalSupervisor(pid, path, receipt.nonce);
  await waitStopped(path);
}
async function waitStopped(path: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if ((await readReceipt(path)).status === "stopped") return;
    await delay(100);
  }
  throw new Error("Stack did not confirm cleanup; inspect its receipt and log");
}
export async function withStack<T>(
  manifest: Manifest,
  action: (receiptPath: string) => Promise<T>,
): Promise<T> {
  const receiptPath = await startStack(manifest);
  try {
    return await action(receiptPath);
  } finally {
    await stopStack(receiptPath);
  }
}

function signalSupervisor(pid: number, path: string, nonce: string): void {
  const args = execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
  if (!args.includes(nonce) || !args.includes(path) || !args.includes("supervise.js"))
    throw new Error("Process identity changed; refusing to signal it");
  process.kill(pid, "SIGTERM");
}
