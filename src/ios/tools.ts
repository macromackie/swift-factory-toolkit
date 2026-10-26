import { join } from "node:path";
import { z } from "zod";
import { run } from "../process.js";
import { appIdentitySchema } from "../schemas.js";
import { requireIOS } from "../manifest.js";
import type { AppIdentity, Manifest, ToolEvidence } from "../types.js";

export type JsonValue = z.infer<ReturnType<typeof z.json>>;
export type JsonObject = { [key: string]: JsonValue };
export async function plist(path: string): Promise<JsonValue> {
  const raw: unknown = JSON.parse(
    await run(["plutil", "-convert", "json", "-o", "-", path], { capture: true }),
  );
  return z.json().parse(raw);
}
export function object(value: JsonValue | undefined, name: string): JsonObject {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return value;
  throw new Error(`${name} must be an object`);
}
export function text(value: JsonValue | undefined, name: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error(`${name} must be a nonempty string`);
}
export function array(value: JsonValue | undefined, name: string): JsonValue[] {
  if (Array.isArray(value)) return value;
  throw new Error(`${name} must be an array`);
}
export async function appIdentity(
  manifest: Manifest,
  path: string,
  expected: Record<string, string | number | boolean> = {},
): Promise<AppIdentity> {
  const info = object(await plist(join(path, "Info.plist")), "Info.plist");
  const ios = requireIOS(manifest);
  if (info["CFBundleIdentifier"] !== ios.bundleID)
    throw new Error("Built app bundle identity differs from the manifest");
  for (const [key, value] of Object.entries(expected)) {
    if (info[key] !== value) throw new Error(`Built app has a different ${key}`);
  }
  return appIdentitySchema.parse({
    bundleID: info["CFBundleIdentifier"],
    version: info["CFBundleShortVersionString"],
    build: info["CFBundleVersion"],
    minimumOS: info["MinimumOSVersion"],
    executable: info["CFBundleExecutable"],
    sdk: info["DTSDKName"],
    xcodeBuild: info["DTXcodeBuild"],
  });
}
export async function environmentEvidence(): Promise<ToolEvidence> {
  return {
    xcode: await run(["xcodebuild", "-version"], { capture: true }),
    host: await run(["sw_vers"], { capture: true }),
  };
}
export function buildArguments(
  manifest: Manifest,
  configuration: string,
  destination: string,
): string[] {
  const ios = requireIOS(manifest);
  return [
    "-project",
    ios.project,
    "-scheme",
    ios.scheme,
    "-configuration",
    configuration,
    "-destination",
    destination,
    "-jobs",
    String(ios.jobs),
    "-skipMacroValidation",
    "-onlyUsePackageVersionsFromResolvedFile",
  ];
}
export async function generate(manifest: Manifest): Promise<void> {
  const ios = requireIOS(manifest);
  if (ios.generate) await run(ios.generate, { cwd: ios.cwd });
}
export function projectLeaseName(manifest: Manifest): string {
  const ios = requireIOS(manifest);
  return ios.cwd + ios.project;
}
