import { execFileSync } from "node:child_process";
import { chmod, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const compiler = fileURLToPath(
  new URL("bin/tsc", import.meta.resolve("@typescript/native/package.json")),
);
await rm("dist", { recursive: true, force: true });
execFileSync(process.execPath, [compiler, "-p", "tsconfig.build.json"], { stdio: "inherit" });
await chmod("dist/cli.js", 0o755);
