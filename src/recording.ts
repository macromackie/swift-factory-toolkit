import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "./process.js";

const helpers = resolve(dirname(fileURLToPath(import.meta.url)), "../helpers");
export async function editRecording(path: string): Promise<void> {
  await run(["uv", "run", join(helpers, "edit-video.py"), resolve(path)]);
}
export async function captureRecording(args: readonly string[]): Promise<void> {
  const temporary = await mkdtemp(join(tmpdir(), "swift-factory-capture-"));
  try {
    const binary = join(temporary, "record-window");
    await run([
      "xcrun",
      "swiftc",
      "-parse-as-library",
      "-O",
      join(helpers, "record-window.swift"),
      "-o",
      binary,
    ]);
    await run([binary, ...args], { timeoutMs: 1_230_000 });
  } finally {
    await rm(temporary, { recursive: true });
  }
}
