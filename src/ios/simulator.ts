import { copyFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import { artifact, errorMessage, readJSON } from "../evidence.js";
import { run } from "../process.js";
import type { Artifact } from "../types.js";

export interface SimulatorSettings {
  appearance: string;
  textSize: string;
}
export async function simulatorSettings(device: string): Promise<SimulatorSettings> {
  return {
    appearance: await run(["xcrun", "simctl", "ui", device, "appearance"], { capture: true }),
    textSize: await run(["xcrun", "simctl", "ui", device, "content_size"], { capture: true }),
  };
}
export async function restoreSimulatorSettings(
  device: string,
  settings: SimulatorSettings,
): Promise<void> {
  let failure: unknown;
  for (const [name, value] of [
    ["appearance", settings.appearance],
    ["content_size", settings.textSize],
  ] as const) {
    try {
      await run(["xcrun", "simctl", "ui", device, name, value]);
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure) throw new Error(errorMessage(failure));
}
const attachmentsSchema = z.array(
  z.object({
    attachments: z
      .array(z.object({ suggestedHumanReadableName: z.string(), exportedFileName: z.string() }))
      .default([]),
  }),
);
export async function exportScreenshots(directory: string, prefix: string): Promise<Artifact[]> {
  const attachments = join(directory, "attachments");
  await run([
    "xcrun",
    "xcresulttool",
    "export",
    "attachments",
    "--path",
    join(directory, "capture.xcresult"),
    "--output-path",
    attachments,
  ]);
  const manifest = attachmentsSchema.parse(await readJSON(join(attachments, "manifest.json")));
  const images: string[] = [];
  for (const test of manifest) {
    for (const attachment of test.attachments) {
      const name = attachment.suggestedHumanReadableName;
      const exported = basename(attachment.exportedFileName);
      if (!name.startsWith(prefix) || !exported.endsWith(".png")) continue;
      const stem = name.split("_", 1)[0];
      if (!stem) throw new Error("Screenshot attachment has no name");
      const destination = `${stem.replace(/[^a-zA-Z0-9._-]/g, "-")}.png`;
      if (images.includes(destination)) throw new Error("Duplicate screenshot name");
      await copyFile(join(attachments, exported), join(directory, destination));
      images.push(destination);
    }
  }
  if (images.length === 0)
    throw new Error("Test completed without a named screenshot; inspect capture.xcresult");
  const figures = images
    .map(
      (name) =>
        `<figure><figcaption>${name}</figcaption><a href="${name}"><img src="${name}"></a></figure>`,
    )
    .join("");
  await writeFile(
    join(directory, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>App snapshots</title><style>body{font:16px system-ui;background:#eee;margin:24px}img{max-width:420px;width:100%}figure{display:inline-block;vertical-align:top}</style>${figures}`,
  );
  return Promise.all(images.map((name) => artifact(join(directory, name))));
}
