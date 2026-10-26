import { resolve } from "node:path";

export function dependencyRules({
  tsconfig = "tsconfig.json",
  forbidden = [],
  externalModules = [],
} = {}) {
  const unresolved = { couldNotResolve: true };
  if (externalModules.length > 0) {
    unresolved.pathNot = externalModules.map(
      (name) => `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
    );
  }
  return {
    forbidden: [
      { name: "no-circular-imports", severity: "error", from: {}, to: { circular: true } },
      { name: "no-unresolved-imports", severity: "error", from: {}, to: unresolved },
      ...forbidden,
    ],
    options: {
      doNotFollow: { path: "node_modules" },
      tsPreCompilationDeps: true,
      tsConfig: { fileName: resolve(tsconfig) },
      enhancedResolveOptions: {
        exportsFields: ["exports"],
        conditionNames: ["types", "import", "node", "default"],
      },
    },
  };
}
