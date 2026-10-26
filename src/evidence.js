import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, readlink, writeFile, rename } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

export const version = "0.1.0";
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export async function hashPath(path) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) return sha256(`link:${await readlink(path)}`);
  if (stat.isFile()) return sha256(await readFile(path));
  const parts = [];
  for (const name of (await readdir(path)).sort())
    parts.push([name, await hashPath(join(path, name))]);
  return sha256(JSON.stringify(parts));
}

export async function sourceIdentity(root) {
  const git = (args) =>
    execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  const names = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
    .split("\0")
    .filter(Boolean);
  const entries = [];
  for (const name of [...new Set(names)].sort()) {
    if (name.startsWith(".config/") || /(^|\/)\.env(?:\.|$)/.test(name)) continue;
    try {
      entries.push([name, await hashPath(join(root, name))]);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  let revision = null;
  try {
    revision = git(["rev-parse", "HEAD"]).trim();
  } catch {}
  return {
    revision,
    dirty: git(["status", "--porcelain"]).length > 0,
    digest: sha256(JSON.stringify(entries)),
  };
}

export async function writeJSON(path, value, { exclusive = false } = {}) {
  const data = `${JSON.stringify(value, null, 2)}\n`;
  if (exclusive) return writeFile(path, data, { flag: "wx", mode: 0o600 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, data, { mode: 0o600 });
  await rename(temporary, path);
}

export async function readJSON(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function beginEvidence(manifest, stage) {
  const runID = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const directory = join(manifest.artifacts, stage, runID);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return {
    directory,
    receipt: {
      schema: 1,
      toolkit: version,
      stage,
      runID,
      app: manifest.app,
      environment: receiptEnvironment(manifest, stage),
      manifestHash: manifest.hash,
      source: await sourceIdentity(manifest.root),
      startedAt: new Date().toISOString(),
      status: "running",
    },
  };
}

export function requireReceipt(manifest, receipt, stage) {
  if (
    receipt.schema !== 1 ||
    receipt.stage !== stage ||
    receipt.status !== "succeeded" ||
    receipt.app !== manifest.app ||
    receipt.environment !== receiptEnvironment(manifest, stage) ||
    receipt.manifestHash !== manifest.hash
  ) {
    throw new Error(
      "Receipt does not match the requested app, environment, manifest or successful stage",
    );
  }
}

function receiptEnvironment(manifest, stage) {
  if (["archive", "export", "upload"].includes(stage)) return manifest.ios.release.environment;
  return manifest.environment;
}

export async function verifyArtifact(artifact) {
  if (!artifact || (await hashPath(artifact.path)) !== artifact.sha256)
    throw new Error("Artifact has changed since its receipt");
}

export async function artifact(path) {
  return { path, sha256: await hashPath(path) };
}
