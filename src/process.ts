import { spawn } from "node:child_process";
import { open } from "node:fs/promises";
import { hasErrorCode } from "./evidence.js";

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  log?: string;
  timeoutMs?: number;
  capture?: boolean;
}
export async function run(command: readonly string[], options: RunOptions = {}): Promise<string> {
  const executable = command[0];
  if (!executable) throw new Error("Provide a command array");
  const { cwd, env = {}, log, timeoutMs = 1_800_000, capture = false } = options;
  const output = log ? await open(log, "a", 0o600) : null;
  try {
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(executable, command.slice(1), {
        ...(cwd === undefined ? {} : { cwd }),
        env: { ...process.env, ...env },
        detached: true,
        stdio: ["ignore", capture ? "pipe" : (output?.fd ?? "inherit"), output?.fd ?? "inherit"],
      });
      let result = "";
      let interrupted = false;
      let killTimer: NodeJS.Timeout | undefined;
      const stop = () => {
        interrupted = true;
        if (child.pid) signalGroup(child.pid, "SIGTERM");
        killTimer ??= setTimeout(() => {
          if (child.pid) signalGroup(child.pid, "SIGKILL");
        }, 10_000);
      };
      const timer = setTimeout(stop, timeoutMs);
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (data: string) => {
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
            new Error(`${executable} failed (${signal ?? code})${log ? `; inspect ${log}` : ""}`),
          );
      });
    });
  } finally {
    await output?.close();
  }
}
export function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (!hasErrorCode(error, "ESRCH")) throw error;
  }
}
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ESRCH")) return false;
    if (hasErrorCode(error, "EPERM")) return true;
    throw error;
  }
}
export function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
