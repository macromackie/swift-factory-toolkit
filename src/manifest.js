import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { sha256 } from "./evidence.js";

const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

export function command(value, name) {
  requireValue(
    Array.isArray(value) &&
      value.length > 0 &&
      value.every((part) => typeof part === "string" && part.length),
    `${name} must be a nonempty command array`,
  );
}

export async function loadManifest(path) {
  const absolute = resolve(path);
  const raw = await readFile(absolute, "utf8");
  const value = JSON.parse(raw);
  requireValue(value.version === 1, "Manifest version must be 1");
  requireValue(
    identifier.test(value.app) && identifier.test(value.environment),
    "Provide app and environment identifiers",
  );
  requireValue(
    typeof value.root === "string" && typeof value.artifacts === "string",
    "Provide root and artifacts paths",
  );
  value.root = resolve(dirname(absolute), value.root);
  value.artifacts = resolve(value.root, value.artifacts);
  value.path = absolute;
  value.hash = sha256(raw);
  if (value.stack) {
    command(value.stack.command, "stack.command");
    const url = new URL(value.stack.ready.url);
    requireValue(
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
      "Stack readiness must use a loopback URL",
    );
    requireValue(
      url.protocol === "http:" && !url.username && !url.password,
      "Stack readiness must use HTTP without credentials",
    );
    requireValue(
      Number.isInteger(value.stack.ready.protocol),
      "Provide the expected protocol version",
    );
    for (const [field, fallback, maximum] of [
      ["timeoutSeconds", 90, 600],
      ["lifetimeSeconds", 1800, 86400],
    ]) {
      value.stack[field] ??= fallback;
      requireValue(
        Number.isInteger(value.stack[field]) &&
          value.stack[field] > 0 &&
          value.stack[field] <= maximum,
        `Invalid stack ${field}`,
      );
    }
    value.stack.cwd = resolve(value.root, value.stack.cwd ?? ".");
  }
  if (value.ios) {
    for (const name of ["project", "scheme", "bundleID", "appName"])
      requireValue(
        typeof value.ios[name] === "string" && value.ios[name].length,
        `Provide ios.${name}`,
      );
    value.ios.cwd = resolve(value.root, value.ios.cwd ?? ".");
    value.ios.jobs ??= 4;
    requireValue(
      Number.isInteger(value.ios.jobs) && value.ios.jobs >= 1 && value.ios.jobs <= 16,
      "ios.jobs must be between 1 and 16",
    );
    if (value.ios.generate) command(value.ios.generate, "ios.generate");
    if (value.ios.release)
      requireValue(
        identifier.test(value.ios.release.environment),
        "Provide ios.release.environment",
      );
  }
  return value;
}
