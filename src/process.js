import { spawn } from "node:child_process";
import { open } from "node:fs/promises";

export async function run(
  command,
  { cwd, env = {}, log, timeoutMs = 1_800_000, capture = false } = {},
) {
  if (!Array.isArray(command) || command.length === 0) throw new Error("Provide a command array");
  const output = log ? await open(log, "a", 0o600) : null;
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(command[0], command.slice(1), {
        cwd,
        env: { ...process.env, ...env },
        detached: true,
        stdio: ["ignore", capture ? "pipe" : (output?.fd ?? "inherit"), output?.fd ?? "inherit"],
      });
      let result = "";
      let interrupted = false;
      let killTimer;
      const stop = () => {
        interrupted = true;
        if (child.pid) signalGroup(child.pid, "SIGTERM");
        killTimer ??= setTimeout(() => child.pid && signalGroup(child.pid, "SIGKILL"), 10_000);
      };
      const timer = setTimeout(stop, timeoutMs);
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      child.stdout?.on("data", (data) => {
        result += data;
        if (result.length > 16 * 1024 * 1024) stop();
      });
      const finish = () => {
        clearTimeout(timer);
        clearTimeout(killTimer);
        process.removeListener("SIGINT", stop);
        process.removeListener("SIGTERM", stop);
      };
      child.once("error", (error) => {
        finish();
        reject(error);
      });
      child.once("exit", (code, signal) => {
        finish();
        if (code === 0 && !interrupted) resolve(result.trim());
        else
          reject(
            new Error(`${command[0]} failed (${signal ?? code})${log ? `; inspect ${log}` : ""}`),
          );
      });
    });
  } finally {
    await output?.close();
  }
}

export function signalGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code === "EPERM") return true;
    throw error;
  }
}

export const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
