---
description: Récupère la prochaine mission GitHub canonique du dépôt courant
allowed-tools: Bash(node scripts/next-mission.mjs:*)
---

Lance `node scripts/next-mission.mjs` et présente le résultat à l'opérateur.

Cette commande est en **lecture seule** : elle lit le remote git, les issues
ouvertes portant un label d'orchestration, le dernier commentaire de la mission
retenue, les branches `mission/*` et une éventuelle PR liée.

Règles à respecter en rendant le résultat :

- `AMBIGUOUS` → **ne choisis pas**. Présente les candidates et demande l'arbitrage.
- `UNAVAILABLE` → dis que GitHub n'a pas pu être lu. Ce n'est **pas** « aucune mission ».
- `NONE` → aucune issue ne porte de label d'orchestration.
- `BLOCKED` / `REVIEW` → la mission existe mais n'est pas actionnable.
- `READY` / `REWORK` → annonce la mission, la branche à réutiliser et la PR liée.

Ne lance aucun orchestrateur, ne merge rien, ne déploie rien.
