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
    // Kit Catalyst vendoré (Tailwind Plus) : source TIERCE, copiée telle quelle
    // pour rester alignable sur l'amont. On ne la reformate pas au goût du repo —
    // sinon chaque mise à jour du kit devient un conflit. Exclue du lint comme
    // n'importe quel code vendoré. Le code QUI L'UTILISE, lui, est linté.
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
