import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { sha256 } from "./evidence.js";
import { manifestSchema } from "./schemas.js";
import type {
  Manifest,
  IOSConfiguration,
  StackConfiguration,
  ReleaseConfiguration,
  SnapshotConfiguration,
} from "./types.js";

export async function loadManifest(path: string): Promise<Manifest> {
  const absolute = resolve(path);
  const raw = await readFile(absolute, "utf8");
  const parsed: unknown = JSON.parse(raw);
  const value = manifestSchema.parse(parsed);
  value.root = resolve(dirname(absolute), value.root);
  value.artifacts = resolve(value.root, value.artifacts);
  if (value.stack) {
    const url = new URL(value.stack.ready.url);
    if (
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.protocol !== "http:" ||
      url.username ||
      url.password
    ) {
      throw new Error("Stack readiness must use loopback HTTP without credentials");
    }
    value.stack.cwd = resolve(value.root, value.stack.cwd);
  }
  if (value.ios) value.ios.cwd = resolve(value.root, value.ios.cwd);
  return { ...value, path: absolute, hash: sha256(raw) };
}

export function requireStack(manifest: Manifest): StackConfiguration {
  if (!manifest.stack) throw new Error("Manifest has no stack");
  return manifest.stack;
}
export function requireIOS(manifest: Manifest): IOSConfiguration {
  if (!manifest.ios) throw new Error("Manifest has no iOS configuration");
  return manifest.ios;
}
export function requireSnapshot(manifest: Manifest): SnapshotConfiguration {
  const ios = requireIOS(manifest);
  if (!ios.snapshot) throw new Error("Manifest has no snapshot configuration");
  return ios.snapshot;
}
export function requireRelease(manifest: Manifest): ReleaseConfiguration {
  const ios = requireIOS(manifest);
  if (!ios.release) throw new Error("Manifest has no release configuration");
  return ios.release;
}
export function requireValue(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}
