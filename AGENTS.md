# AGENTS.md — invariants techniques d'Aigent

> **Discipline de ce fichier : les invariants techniques, et rien d'autre.**
> Un invariant est une règle qui, violée, casse le produit ou lui fait dire
> quelque chose de faux.
>
> Ce fichier ne contient **aucune** règle de git, de mission, d'organisation ou
> de design, et **aucun état produit daté**. S'il y en a, elles sont au mauvais
> endroit.
>
> — Ce qu'est Aigent → `PRODUCT_DOCTRINE.md`
> — Comment travailler → `CLAUDE.md`
> — Les surfaces → `DESIGN_DOCTRINE.md`
> — Ce qui marche aujourd'hui → `docs/CURRENT_FUNCTIONAL_CHECKLIST.md`
>
> **Gouvernance 100 % locale.** Les quatre fichiers de règles ci-dessus et les
> gates de `package.json` sont l'intégralité des règles de ce projet. Aucun
> repository distant, aucune doctrine externe, aucun plugin, aucune commande de
> synchronisation n'entre ici.
>
> **Une ancre `fichier:ligne` est morte au premier refactor.** On nomme un
> fichier et un symbole, jamais un numéro de ligne.

## Next.js — lire la doc avant de coder

Cette version de Next a des ruptures d'API par rapport aux connaissances
d'entraînement. Lire le guide pertinent dans `node_modules/next/dist/docs/`
avant d'écrire du code framework.

En particulier : **la garde d'identité est `src/proxy.ts`** (convention `proxy`).
Il n'existe pas de `middleware.ts`.

## Port de dev — 3987

Le dev d'Aigent tourne sur **3987**.

- **Ne jamais** lancer le dev sur **3000, 3001 ou 3210** — bannis par
  `check:dev-port`.
- **Ne jamais** tuer un process sur ces ports : il ne nous appartient pas.
- **Ne jamais** s'y connecter « pour vérifier » : ce qui répond là est le
  chantier d'un autre, et le lire comme si c'était Aigent produit un diagnostic
  faux.

Le port se résout depuis `AIGENT_DEV_PORT`. Le stack de dev refuse de tuer un
listener qu'il ne peut pas prouver être son propre serveur (double preuve : `cwd`
**et** commande). LangGraph tourne sur `:2024`.

## Frontières de confiance — quatre, séparées exprès

| Surface | Appelant | Credential |
|---|---|---|
| `/api/agent-ops/**` | opérateur, ou automatisation d'Aigent | cookie de session HMAC **ou** header `x-amc-key` |
| `/api/runtime/v1/**` | un produit consommateur | son propre jeton runtime |
| `/api/runtime-telemetry` | un agent déployé chez un tiers | son propre jeton de télémétrie |
| `/api/runtime-telemetry/consumer` | une **installation** consommateur identifiée | un jeton **par installation**, haché au repos, révocable |

Règles dures :

- **`src/proxy.ts` ne garde que `/api/agent-ops/**`.** Une route mutante posée
  ailleurs n'est gardée par **rien** : soit elle reste sous ce préfixe, soit elle
  apporte sa propre authentification explicite.
- **Les pages ne sont pas couvertes par le proxy.** Une surface qui lit des
  données sans passer par une route API doit porter sa propre vérification de
  session. Ne jamais supposer que le proxy protège un écran.
- **Les valeurs de jetons ne sont jamais partagées** entre ces surfaces. Seules
  la mécanique d'extraction et la comparaison constant-time sont mutualisées.
- **Toute comparaison de secret est constant-time.** Sans exception.
- Le payload de télémétrie est traité comme **hostile** : plafond de taille avant
  parse, schéma strict, scan de motifs de secrets, et **rien n'est renvoyé en
  écho** — pas même un `err.message`.
- **Aucune réponse d'erreur ne renvoie un message interne.** Ni stack, ni corps
  PostgREST, ni nom de variable d'environnement, ni écho d'entrée. Le détail va
  au log serveur ; le client reçoit un message générique.

## Authentification — fail-closed, sans nuance

`auth.ts` est **fail-closed dans tous les environnements**. Il n'existe **aucun**
secret de session par défaut, **aucun** mot de passe admin de repli, **aucun**
bypass — ni en dev, ni en test, ni en production. Sans secret configuré, la
frappe de session lève.

> Cette formulation corrige une version antérieure de ce fichier qui décrivait
> des fallbacks « dev-only » et ordonnait de qualifier le fail-closed par « en
> production ». Ces fallbacks ont été **supprimés délibérément** et ne doivent
> pas être réintroduits : la doctrine décrivait une posture **plus faible** que
> le code réel.

Les variables d'environnement sont lues **à chaque appel**, jamais capturées au
chargement du module : une capture rendrait la posture dépendante de l'ordre de
démarrage.

## Vérité des données

- **Une valeur non mesurée reste `null`**, jamais coercée en `0`. Une absence de
  run n'est pas 0 % de succès ; une absence de score n'est pas un score de 0 ; une
  API injoignable n'est pas saine. Dictionnaire : `docs/metrics-canon.md`.
- **Aucun provider ni modèle par défaut fabriqué** dans le contrat canonique :
  non résolu → `null` + champs déclarés indisponibles.
- **Un provider non vérifié n'est pas un provider.** Quand un runtime déclare
  qu'il n'a pas pu prouver ce qui a exécuté, la valeur est annulée, pas recopiée.
- **Pas de faux zéro dans la trace de cycle de vie.** L'état d'activation chez un
  consommateur reste littéralement inconnu tant qu'Aigent n'a aucun canal de
  lecture vers lui.
- **Un compteur de sécurité non mesuré ne vaut jamais 0.** Zéro signifie
  « mesuré, et propre » — l'affirmation la plus forte du système. Une absence qui
  se lit comme une preuve de propreté est le défaut le plus grave de cette
  famille.

**Portée réelle des gates de vérité** : `check:render-truth` couvre les surfaces
de rendu **et** les trois agrégateurs principaux du data layer.
`check:agent-truth` couvre le contrat canonique. Aucune ne couvre l'ensemble des
producteurs du data layer : la règle y tient par discipline. Ne pas prétendre
l'inverse, dans un sens comme dans l'autre.

## Runtime & exécution

- **LangGraph est le seul runtime produit exécutable.** Imposé à quatre endroits
  indépendants : la création, la garde d'exécution, le contrat canonique et le
  registre des runtimes.
- **Garde d'exécution fail-closed.** Un run n'est autorisé que si **les trois**
  conditions tiennent : statut actif, aucun outil non résolu, runtime
  `langgraph`. Sinon, refus avec les raisons concrètes.
- **Ne jamais recalculer le statut dans une route.** Il vient du contrat
  canonique — la même dérivation que le catalogue. Trois copies d'une règle de
  sécurité divergent à la première évolution.
- **`active` signifie PROUVÉ** : un run réussi, zéro tentative unsafe, un modèle
  vérifié. Jamais un simple changement de statut.
- **Piège de l'assistant manquant.** Un copilot en `langgraph` **sans assistant
  provisionné** ne tombe pas en erreur : il tourne contre le graphe nu, hérite
  d'outils génériques, et répond « pas de données » **en paraissant sain**.
  L'ordre est obligatoire : **provisionner l'assistant, PUIS basculer le
  runtime**. Aucune gate ne détecte ce cas — c'est une discipline, pas une
  garantie.
- **Endpoint LangGraph** : un endpoint distant est refusé hors production, un
  endpoint local est refusé en production.
- **La description d'un outil porte le contrat que le schéma ne peut pas dire** :
  quand l'appeler, ce que fait un appel sans argument, ce que signifie un champ.
  Une description muette a déjà fait refuser au modèle un appel que le schéma
  autorisait.
- **Multi-provider — ne pas régresser en « OpenAI-only ».** Plusieurs providers
  sont câblés ; celui qui ne l'est pas lève une **erreur typée**, jamais un
  fallback muet.
- **Les plafonds sont appliqués, pas décoratifs.** Un budget de coût se vérifie
  **avant** chaque appel facturé, pas après.
- **Un timeout n'est pas un refus.** Une absence de réponse et une réponse
  négative sont deux faits différents ; les confondre décrit faussement un appel
  qui a peut-être été accepté et facturé.
- **Factory métier read-only** : le domaine trading n'a aucun chemin d'écriture
  réel. Donnée absente → verdict indisponible avec provenance. Un verdict
  bloquant est **terminal** : aucun chemin ne le renverse.

## Données & migrations

- Postgres atteint via **PostgREST** avec une clé service-role, **server-only**.
- **Toute nouvelle table active RLS et grante explicitement `service_role`.** Le
  grant « on all tables » ne couvre pas le futur ; des tables ont déjà vécu sans
  RLS pour cette raison exacte.
- **Une migration est additive par défaut.** Une migration destructive exige un
  accord explicite (`CLAUDE.md`).
- **Une colonne de mesure est nullable.** `NOT NULL DEFAULT 0` sur une métrique
  transforme structurellement une absence en zéro.
- **Ne jamais réutiliser un numéro de migration.** Vérifier le dernier numéro
  **sur disque**, jamais dans un document.
- Les écritures multi-tables qui doivent être atomiques passent par une **RPC
  transactionnelle**, pas par une séquence d'appels.

## Shipping & télémétrie

- **Une écriture distante réelle exige DEUX verrous** : une confirmation
  explicite dans la requête **et** un armement au niveau de l'environnement.
  Sinon c'est un dry-run — et c'est le défaut correct.
- **Aucune mutation avant le garde.** Un dry-run qui a déjà écrit n'est pas un
  dry-run.
- **La télémétrie est un canal unique pour deux sources** : les runs rapportés et
  les runs internes. Une seule table.
- **La provenance d'un run est distinguée à la lecture.** Confondre un run
  interne avec un run consommateur produit une conclusion fausse sur le
  comportement en production.

## Gates — `package.json` fait foi

`npm run check` exécute, dans l'ordre : `typecheck` · `lint:fast` · `lint` ·
`check:no-legacy-front` · `check:no-legacy-design-governance` ·
`check:production-visual-authority` · `check:theme-foundation` ·
`check:ui-kit-integrity` · `check:agent-truth` · `check:lifecycle-truth` ·
`check:registry-parity` · `check:registry-integrity` · `check:dev-port` ·
`check:render-truth` · `check:rsc-boundary` · `check:schema-rebuildable` ·
`check:secrets` · `audit:dead` · `check:governance`.

`npm run verify` ajoute `quality:dead`, `test` et `build`.

**Cette chaîne est statique et hors ligne.** Les gates qui interrogent la base
live en sont volontairement sorties : sans backend elles s'auto-skippent, donc
elles ne mesuraient rien là où elles prétendaient protéger. Ce sont des commandes
d'exploitation. Leur option d'écriture ne se passe jamais par réflexe.

**Une gate verte est une information étroite** : elle dit « la règle que
j'implémente n'est pas violée », jamais « l'écran est bon ». **Aucune gate ne
mesure le rendu.** La carte des angles morts est dans `scripts/README-gates.md` —
la colonne « ne garantit PAS » est la colonne utile.

**Une gate qui n'a rien pu mesurer doit le dire.** Un ✓ silencieux sur zéro cible
est un mensonge, et ce repository en a déjà produit.

## Sources de vérité, dans l'ordre

1. Le **code et les contrats** — l'autorité finale sur les faits.
2. Les **gates branchées** — l'autorité sur ce qui est réellement vérifié.
3. `PRODUCT_DOCTRINE.md`, `AGENTS.md`, `CLAUDE.md`, `DESIGN_DOCTRINE.md` — les
   règles.
4. `docs/CURRENT_FUNCTIONAL_CHECKLIST.md` — l'état réel, daté, avec ses preuves.
5. Les documents `docs/` portant un bandeau **ARCHIVE** — des observations
   datées, **jamais** des règles.

Contradiction entre deux fichiers → le plus spécifique gagne, et l'écart se
corrige **dans le fichier propriétaire**. Ne jamais ouvrir une troisième
doctrine.

