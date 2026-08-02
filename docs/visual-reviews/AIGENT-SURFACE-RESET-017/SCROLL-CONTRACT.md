# AIGENT-SURFACE-RESET-017 — SCROLL CONTRACT

- contrat choisi: `app bornée` (Contrat B)
- contrat rejeté: `document naturel` (Contrat A)
- verdict: `CODEX_DECISION`

## Preuves (étape 01)

- la matrice `before/scroll-matrix.md` montre `document scroll = non` sur 36/36 combinaisons route×viewport ;
- le scroll principal est déjà interne au shell/page ou à une zone bornée (jamais `document`) ;
- les écarts observés viennent surtout de scrolls secondaires imbriqués (sidebar wrapper + `SidebarBody`, marqueur actif doublé, pages bornées avec liste interne), pas d'un besoin de revenir au scroll document ;
- les routes sentinelles (`/settings`, `/agents/[copilotId]`, `/runs`, `/runtime`) restent structurellement compatibles avec un shell borné, y compris en mobile.

## Propriétaire unique du scroll

- propriétaire principal attendu: `PageBody` pour les pages documentaires longues ;
- propriétaire principal attendu (surfaces bornées): la zone métier explicitement bornée (table/liste/panneau runtime), pas le document.

## Rôle de `html/body`

- `html`/`body` restent bornés viewport (`h-svh`) ;
- `html`/`body` ne portent pas le scroll principal ;
- `overflow-hidden` global conserve un comportement uniforme inter-routes.

## Rôle de `AppShell`

- fournir le cadre fixe (rail + zone principale) ;
- empêcher un second scroll vertical au niveau wrapper ;
- ne pas devenir propriétaire principal du scroll.

## Rôle de `PageBody`

- porter le scroll principal par défaut pour les pages longues ;
- rester compatible avec des surfaces explicitement bornées qui gèrent leur propre scroll interne ;
- éviter les doubles chaînes fragiles via des repères structurels (`data-page-body` ajouté pour audit).

## Rôle des surfaces bornées

- tables/listes/panneaux métier peuvent rester scrollables localement quand le besoin est fonctionnel ;
- ces scrolls locaux ne doivent pas recréer un second scroll principal concurrent.

## Exceptions autorisées

- aucune exception route par route au niveau du contrat shell ;
- les scrolls internes de composants métier bornés restent permis tant qu'ils ne deviennent pas le second scroll principal du shell.
