# AIGENT-SURFACE-RESET-017 — REVIEW

## Verdict

`PARTIAL`

- étapes 01, 02, 03 terminées côté Codex (`CODEX_DONE`) ;
- contrat shell appliqué (app bornée) ;
- instabilités shell ciblées corrigées ;
- mais des multi-scrolls verticaux persistent sur certaines routes via sections métier bornées hors scope de cette passe.

## Contrat retenu

- choisi: `app bornée` ;
- propriétaire du scroll: `PageBody` ou zone bornée métier explicitement scrollable ;
- `html/body`: bornés viewport, non scrollables ;
- exceptions shell route-specific: `aucune`.

## Correctifs shell effectués

- `src/components/app-shell.tsx`
  - suppression du marqueur actif manuel (le marqueur de `SidebarItem` reste l'unique source) ;
  - suppression des wrappers sidebar scrollables (desktop et mobile) pour éviter le double scroll avec `SidebarBody` ;
  - ajout de repères d'audit (`data-app-shell`, `data-page-body`, etc.) ;
- `scripts/audit-surface-scroll.mjs`
  - audit déterministe routes × viewports ;
  - collecte métriques de scroll + captures sentinelles + drawer mobile ;
- `tests/unit/app-shell-contract.test.ts`
  - garde-fou régression marqueur actif et wrappers sidebar.

## Matrice avant/après (résumé sentinelles)

- `/settings` (page courte): document ne scrolle pas, aucun scroll principal parasite (3 viewports) ;
- `/runs` (table/liste): scroll principal `PageBody` stable ; pas de document scroll ;
- `/runtime` (surface bornée): scroll principal interne runtime conservé, document neutre ;
- `/agents/[copilotId]` (page longue): scroll principal `PageBody`, mais scrolls internes métier secondaires subsistent (expected hors refonte page).

## Validations exécutées

- `npm ci` ✅
- `npm run typecheck` ✅
- `npm run lint` ✅
- `npm run check` ✅
- `npm run quality:dead` ✅
- `npm run test` ✅
- `npm run build` ✅
- `npm run verify` ✅
- `npm run check:secrets` ✅

## Audits & captures

- développement (before): `before/scroll-matrix.json` + `before/scroll-matrix.md` + captures ;
- développement (after): `after/scroll-matrix.json` + `after/scroll-matrix.md` + captures ;
- production (after): `after/production/scroll-matrix.json` + `after/production/scroll-matrix.md` + captures.

Captures minimales présentes :

- `before/desktop-1440x900.png`
- `before/laptop-1280x800.png`
- `before/mobile-375x812.png`
- `before/mobile-drawer-open-375x812.png`
- `after/desktop-1440x900.png`
- `after/laptop-1280x800.png`
- `after/mobile-375x812.png`
- `after/mobile-drawer-open-375x812.png`

## Limites observées (prouvées)

- production: erreurs console répétées `DataInteractive` (Headless UI Fragment prop passthrough) ; non introduites par le patch shell ;
- production: nombreux `requestfailed net::ERR_ABORTED` sur navigations RSC préemptées ;
- routes avec composants métiers bornés (`/agents`, `/delivery` mobile) gardent des scrolls secondaires.
