import js from "@eslint/js";
import tseslint from "typescript-eslint";

export function strictTypeScript({ root, files = ["**/*.ts"], ignores = [] }) {
  return [
    {
      ignores: ["node_modules/**", "dist/**", ".local/**", ".tenet/**", ...ignores],
    },
    { linterOptions: { reportUnusedDisableDirectives: "error" } },
    { ...js.configs.recommended, files },
    ...tseslint.configs.recommendedTypeChecked.map((configuration) => ({
      ...configuration,
      files,
    })),
    {
      files,
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir: root },
      },
      rules: {
        "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
        "@typescript-eslint/no-explicit-any": "error",
        "@typescript-eslint/no-non-null-assertion": "error",
        "@typescript-eslint/switch-exhaustiveness-check": "error",
      },
    },
  ];
}
