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
    // Archives Catalyst / staging zip — référence, pas code produit linté.
    "vendor/**",
    ".vendor-staging/**",
    // Exemples Tailwind Plus vendorés (364 fichiers .jsx livrés tels quels).
    // Ils sont ignorés par git (`.gitignore` → `docs/visual-reviews/*`), donc la
    // CI ne les voit jamais : sans cette entrée, `npm run lint` est VERT en CI et
    // ROUGE sur une machine de dev où le dossier existe (8 erreurs). Un flat
    // config eslint ne lit pas `.gitignore` — l'ignore doit être déclaré ici.
    //
    // Portée volontairement réduite à CE dossier, pas à `docs/**` : le reste de
    // `docs/` porte du code réel à linter (`visual-reviews/matiere-phase1/
    // measure.mjs`, seul fichier lintable suivi par git sous `docs/`).
    "docs/visual-reviews/tailwind-plus-application-ui-v4/**",
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
  // Catalyst officiel (Tailwind Plus) — copié tel quel, non reformaté.
  {
    files: ["src/components/ui/**/*.tsx"],
    rules: {
      "prefer-const": "off",
    },
  },
]);

export default eslintConfig;
