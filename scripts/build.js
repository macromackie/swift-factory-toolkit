import { chmod, cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist");
await cp("src", "dist", { recursive: true });
await chmod("dist/cli.js", 0o755);
