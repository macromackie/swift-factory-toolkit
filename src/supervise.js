import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { readJSON, writeJSON } from "./evidence.js";
import { loadManifest } from "./manifest.js";
import { alive, delay, signalGroup } from "./process.js";

const [manifestPath, receiptPath, nonce] = process.argv.slice(2);
const manifest = await loadManifest(manifestPath);
const receipt = await readJSON(receiptPath);
if (receipt.nonce !== nonce || !receipt.owned)
  throw new Error("Supervisor ownership does not match");
const child = spawn(manifest.stack.command[0], manifest.stack.command.slice(1), {
  cwd: manifest.stack.cwd,
  detached: true,
  stdio: "inherit",
  env: { ...process.env, SWIFT_FACTORY_SOURCE_ID: receipt.source.digest },
});
let finish;
const stopped = new Promise((resolve) => {
  finish = resolve;
});
const stop = () => finish();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
const timer = setTimeout(stop, Math.max(0, Date.parse(receipt.deadline) - Date.now()));
child.once("error", (error) => {
  console.error(error.message);
  finish();
});
child.once("exit", finish);
try {
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  receipt.owner = { pid: process.pid, childPID: child.pid };
  const lease = await readJSON(join(receipt.lease, "owner.json"));
  if (lease.nonce !== receipt.leaseNonce) throw new Error("Stack lease ownership changed");
  await writeJSON(join(receipt.lease, "owner.json"), {
    ...lease,
    pid: process.pid,
    receipt: receiptPath,
  });
  await writeJSON(receiptPath, receipt);
  await stopped;
} finally {
  clearTimeout(timer);
  if (child.pid) {
    signalGroup(child.pid, "SIGTERM");
    const deadline = Date.now() + 10_000;
    while (alive(-child.pid) && Date.now() < deadline) await delay(100);
    if (alive(-child.pid)) {
      signalGroup(child.pid, "SIGKILL");
      const killDeadline = Date.now() + 2000;
      while (alive(-child.pid) && Date.now() < killDeadline) await delay(100);
      if (alive(-child.pid)) throw new Error("Owned process group did not exit after termination");
    }
  }
  const lease = await readJSON(join(receipt.lease, "owner.json"));
  if (lease.nonce !== receipt.leaseNonce) throw new Error("Stack lease ownership changed");
  await rm(receipt.lease, { recursive: true });
  receipt.status = "stopped";
  receipt.finishedAt = new Date().toISOString();
  await writeJSON(receiptPath, receipt);
}
