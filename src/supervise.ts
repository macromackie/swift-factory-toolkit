import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { readJSON, writeJSON } from "./evidence.js";
import { loadManifest, requireStack } from "./manifest.js";
import { leaseOwnerSchema, stackReceiptSchema } from "./schemas.js";
import { alive, delay, signalGroup } from "./process.js";
import type { StackReceipt } from "./types.js";

type StartingStack = Extract<StackReceipt, { status: "starting" }>;
async function terminateGroup(pid: number): Promise<void> {
  signalGroup(pid, "SIGTERM");
  const deadline = Date.now() + 10_000;
  while (alive(-pid) && Date.now() < deadline) await delay(100);
  if (!alive(-pid)) return;
  signalGroup(pid, "SIGKILL");
  const killDeadline = Date.now() + 2000;
  while (alive(-pid) && Date.now() < killDeadline) await delay(100);
  if (alive(-pid)) throw new Error("Owned process group did not exit after termination");
}
async function finishStack(
  starting: StartingStack,
  receiptPath: string,
  childPID: number | undefined,
): Promise<void> {
  if (childPID) await terminateGroup(childPID);
  const lease = leaseOwnerSchema.parse(await readJSON(join(starting.lease, "owner.json")));
  if (lease.nonce !== starting.leaseNonce) throw new Error("Stack lease ownership changed");
  await rm(starting.lease, { recursive: true });
  await writeJSON(receiptPath, {
    ...starting,
    status: "stopped",
    ...(childPID ? { owner: { pid: process.pid, childPID } } : {}),
    finishedAt: new Date().toISOString(),
  });
}
async function supervise(): Promise<void> {
  const [manifestPath, receiptPath, nonce] = process.argv.slice(2);
  if (!manifestPath || !receiptPath || !nonce)
    throw new Error("Provide the manifest, receipt and ownership token");
  const manifest = await loadManifest(manifestPath);
  const stack = requireStack(manifest);
  const starting = stackReceiptSchema.parse(await readJSON(receiptPath));
  if (starting.status !== "starting" || starting.nonce !== nonce)
    throw new Error("Supervisor ownership does not match");
  const child = spawn(stack.command[0], stack.command.slice(1), {
    cwd: stack.cwd,
    detached: true,
    stdio: "inherit",
    env: { ...process.env, SWIFT_FACTORY_SOURCE_ID: starting.source.digest },
  });
  let finish: () => void = () => {};
  const stopped = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const stop = () => {
    finish();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const timer = setTimeout(stop, Math.max(0, Date.parse(starting.deadline) - Date.now()));
  child.once("error", (error) => {
    console.error(error.message);
    finish();
  });
  child.once("exit", stop);
  let childPID: number | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    childPID = child.pid;
    if (!childPID) throw new Error("Owned stack has no process identifier");
    const owner = { pid: process.pid, childPID };
    const lease = leaseOwnerSchema.parse(await readJSON(join(starting.lease, "owner.json")));
    if (lease.nonce !== starting.leaseNonce) throw new Error("Stack lease ownership changed");
    await writeJSON(join(starting.lease, "owner.json"), {
      ...lease,
      pid: process.pid,
      receipt: receiptPath,
    });
    await writeJSON(receiptPath, { ...starting, status: "running", owner });
    await stopped;
  } finally {
    clearTimeout(timer);
    await finishStack(starting, receiptPath, childPID);
  }
}
await supervise();
