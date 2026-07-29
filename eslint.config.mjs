import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Agent worktrees: isolated copies of the repo created by workflow workers.
    // They are not source of THIS working tree and must never enter the lint gate.
    ".claude/worktrees/**",
    // Vendored Catalyst UI kit: third-party source, excluded from lint like
    // any vendored code.
    "src/components/ui/**",
  ]),
  {
    rules: {
      // `_`-prefixed vars/args are intentional discards, and `{ key: _k, ...rest }`
      // destructuring is the idiomatic "omit key" — none of these should warn.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
]);

export default eslintConfig;
