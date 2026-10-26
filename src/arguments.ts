import { version } from "./evidence.js";
import type { Command } from "./types.js";

export const usage = `swift-factory ${version}

  stack start <manifest>
  stack stop <stack-receipt>
  stack run <manifest> -- <command...>
  ios snapshot <manifest> <scenario> --device <UUID> [--build-receipt <path>]
  ios archive <manifest>
  ios export <manifest> --receipt <archive-receipt>
  ios upload <manifest> --receipt <export-receipt>
  evidence source <repository-root>
  evidence inspect <receipt>
  record capture <output.mp4> <stop-file> [maximum-seconds] [application-bundle-id]
  record edit <edit-manifest>

Use a private application manifest. Archive and export never upload.
`;
export type Invocation =
  | { kind: "help" | "version" }
  | { kind: "source"; root: string }
  | { kind: "inspect" | "stop"; receipt: string }
  | { kind: "start" | "archive"; manifest: string }
  | { kind: "run"; manifest: string; command: Command }
  | { kind: "snapshot"; manifest: string; scenario: string; device: string; buildReceipt?: string }
  | { kind: "export" | "upload"; manifest: string; receipt: string }
  | { kind: "edit"; path: string }
  | { kind: "capture"; args: string[] };
function takeOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
  args.splice(index, 2);
  return value;
}
export function parseInvocation(input: readonly string[]): Invocation {
  const [group, action, ...args] = input;
  if (!group || group === "--help") return { kind: "help" };
  if (group === "--version") return { kind: "version" };
  const first = args[0];
  if (group === "evidence" && args.length === 1 && first) {
    if (action === "source") return { kind: "source", root: first };
    if (action === "inspect") return { kind: "inspect", receipt: first };
  }
  if (group === "stack") {
    if (action === "stop" && args.length === 1 && first) return { kind: "stop", receipt: first };
    if (action === "start" && args.length === 1 && first) return { kind: "start", manifest: first };
    const executable = args[2];
    if (action === "run" && first && args[1] === "--" && executable)
      return { kind: "run", manifest: first, command: [executable, ...args.slice(3)] };
  }
  if (group === "ios" && first) {
    if (action === "archive" && args.length === 1) return { kind: "archive", manifest: first };
    const rest = args.slice(1);
    if (action === "snapshot") {
      const device = takeOption(rest, "--device");
      const buildReceipt = takeOption(rest, "--build-receipt");
      const scenario = rest[0];
      if (rest.length === 1 && scenario && device)
        return {
          kind: "snapshot",
          manifest: first,
          scenario,
          device,
          ...(buildReceipt ? { buildReceipt } : {}),
        };
    }
    const receipt = takeOption(rest, "--receipt");
    if (receipt && rest.length === 0 && (action === "export" || action === "upload"))
      return { kind: action, manifest: first, receipt };
  }
  if (group === "record") {
    if (action === "edit" && args.length === 1 && first) return { kind: "edit", path: first };
    if (action === "capture" && args.length >= 2 && args.length <= 4)
      return { kind: "capture", args };
  }
  throw new Error(usage);
}
