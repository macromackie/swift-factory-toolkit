import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, readlink, writeFile, rename } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { receiptSchema } from "./schemas.js";
import type {
  Artifact,
  EvidenceRun,
  Manifest,
  Receipt,
  SourceIdentity,
  Stage,
  StageData,
  SuccessfulStage,
} from "./types.js";

export const version = "0.2.0";
export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An unknown operation failed";
}
export function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
export async function hashPath(path: string): Promise<string> {
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) return sha256(`link:${await readlink(path)}`);
  if (stat.isFile()) return sha256(await readFile(path));
  const parts: [string, string][] = [];
  for (const name of (await readdir(path)).sort())
    parts.push([name, await hashPath(join(path, name))]);
  return sha256(JSON.stringify(parts));
}
export async function sourceIdentity(root: string): Promise<SourceIdentity> {
  const git = (args: readonly string[]) =>
    execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  const names = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
    .split("\0")
    .filter(Boolean);
  const entries: [string, string][] = [];
  for (const name of [...new Set(names)].sort()) {
    if (name.startsWith(".config/") || /(^|\/)\.env(?:\.|$)/.test(name)) continue;
    try {
      entries.push([name, await hashPath(join(root, name))]);
    } catch (error) {
      if (!hasErrorCode(error, "ENOENT")) throw error;
    }
  }
  let revision: string | null = null;
  try {
    revision = git(["rev-parse", "HEAD"]).trim();
  } catch {
    /* A newly initialized repository has no revision. */
  }
  return {
    revision,
    dirty: git(["status", "--porcelain"]).length > 0,
    digest: sha256(JSON.stringify(entries)),
  };
}
export async function writeJSON(
  path: string,
  value: unknown,
  { exclusive = false }: { exclusive?: boolean } = {},
): Promise<void> {
  const data = `${JSON.stringify(value, null, 2)}\n`;
  if (exclusive) {
    await writeFile(path, data, { flag: "wx", mode: 0o600 });
    return;
  }
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, data, { mode: 0o600 });
  await rename(temporary, path);
}
export async function readJSON(path: string): Promise<unknown> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  return value;
}
export async function readReceipt(path: string): Promise<Receipt> {
  return receiptSchema.parse(await readJSON(path));
}
export async function beginEvidence<S extends Stage>(
  manifest: Manifest,
  stage: S,
): Promise<EvidenceRun<S>> {
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
export function requireReceipt(manifest: Manifest, receipt: Receipt, stage: Stage): void {
  if (
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
function receiptEnvironment(manifest: Manifest, stage: Stage): string {
  if (stage === "archive" || stage === "export" || stage === "upload") {
    const release = manifest.ios?.release;
    if (!release) throw new Error("Manifest has no release configuration");
    return release.environment;
  }
  return manifest.environment;
}
export async function finishEvidence<S extends SuccessfulStage>(
  run: EvidenceRun<S>,
  operation: () => Promise<StageData<S>>,
): Promise<StageData<S>> {
  const path = join(run.directory, "receipt.json");
  await writeJSON(path, run.receipt);
  try {
    const data = await operation();
    const completed = receiptSchema.parse({
      ...run.receipt,
      ...data,
      status: "succeeded",
      finishedAt: new Date().toISOString(),
    });
    await writeJSON(path, completed);
    return data;
  } catch (error) {
    await writeJSON(path, {
      ...run.receipt,
      status: "failed",
      error: errorMessage(error),
      finishedAt: new Date().toISOString(),
    });
    throw error;
  } finally {
    console.log(`Evidence: ${path}`);
  }
}
export async function verifyArtifact(value: Artifact): Promise<void> {
  if ((await hashPath(value.path)) !== value.sha256)
    throw new Error("Artifact has changed since its receipt");
}
export async function artifact(path: string): Promise<Artifact> {
  return { path, sha256: await hashPath(path) };
}
