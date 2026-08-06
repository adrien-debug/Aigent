# Checklist fonctionnelle actuelle

> **Source cumulative unique de l'état réel d'Aigent.** Ce fichier est repris à
> chaque mission — jamais recréé ailleurs, jamais dupliqué dans un rapport.
>
> **Règle d'écriture** : ne jamais déclarer *fonctionnel* ce qui est seulement
> *codé*. Une capacité descend d'un cran dès qu'on ne peut pas produire sa
> preuve. Une preuve est un SHA, une PR, un runId, ou une sortie de commande —
> pas une phrase.
>
> Mettre à jour à chaque **review**, **rework**, **merge** et **déploiement**.
>
> **Périmètre : Aigent uniquement.** TradeAgent est un autre repository et
> n'appartient pas à cette checklist, même quand une mission touche les deux.

**État de référence** — `main` =
`6a8e6f00496bccd536a74513eb5535e146e8959a`, après le merge de la PR #111.
Dernière mise à jour : 2026-08-06

**PR #110 et #111 sont mergées.** PR #110 remplace les `Link` Catalyst par
`next/link` (soft navigation App Router) ; PR #111 passe le kit Catalyst 17
(Select/Alert/DescriptionList, Badge sévérité, surface-state texte-only, suppression
du composant `aig-chip` art). Aucun déploiement ni promotion n'en découle.

Les chiffres de la section *Fonctionnel* ci-dessous ont été **relus en base le
2026-08-04** (PostgREST `HEALTHY`, lecture seule). Ils remplacent des chiffres
antérieurs du même fichier : c'est un rafraîchissement, pas une première mesure.

---

## Fonctionnel

Capacités dont l'exécution réelle a été constatée.

### Chiffres relus en base le 2026-08-04

Comptages obtenus en lecture seule via PostgREST. Une case vide se lit
« mesuré, et vide » — les tables à zéro sont en section *Non fonctionnel*.

| Mesure | Valeur constatée |
|---|---|
| Copilots | **14**, tous en runtime `langgraph` |
| Répartition de cycle de vie | 8 `draft` · 3 `active` · 1 `degraded` · 1 `paused` · 1 `archived` |
| Runs d'agent | **30** — 27 `completed`, 3 `failed` |
| Modèle **prouvé** | **26** runs en `openai` / `gpt-5.4` avec `modelUnverified: false` |
| Modèle **non prouvé** | **4** runs en `modelUnverified: true` — déclarés tels quels, pas recopiés |
| Coût mesuré | **29 runs sur 30** · total **$0,367793** |
| Étapes de run · appels d'outils | **121** · **42** |
| Provenance des runs | 18 `authoring` · 11 `dev-seed` · **1 `production`** |
| Release gate | **6** lignes — 2 `ready`, 4 `blocked` (2 PASS, 3 FAIL, 1 INSUFFICIENT_EVIDENCE) |
| Tests persistés | 6 suites · 6 runs · 23 résultats |
| Benchmarks persistés | 5 suites · 5 runs · 5 résultats |
| Projets · relations projet-agent | 10 · 2 |
| Installations consommateur | **3** |
| Événements de télémétrie | **48** — 33 `completed`, 9 `failed`, 6 `started` |
| Outils · définitions d'outils | 56 · 22 |
| Conversations du project builder | 25 |

Lecture honnête de ces chiffres : **1 seul run sur 30 porte la provenance
`production`**, et aucun déploiement n'existe (section *Déployé*). Le volume
constaté est un volume de laboratoire, pas un trafic de production.

### Capacités

| Capacité | Preuve |
|---|---|
| Authoring conversationnel → manifeste structuré → matérialisation compensable | 14 copilots réellement en base |
| Cycle de vie observable : draft / active / degraded / paused / archived | répartition constatée en base : 8 / 3 / 1 / 1 / 1 |
| Release gate à 9 checks, avec preuve exigée | 6 lignes `promotion_gates` : 2 PASS, 3 FAIL, 1 INSUFFICIENT_EVIDENCE |
| Promotion transactionnelle avec verrous anti-bypass | RPC `SECURITY DEFINER` + index unique partiel + lockdown des écritures directes |
| Garde d'exécution fail-closed à trois conditions | refus 409 avec raisons concrètes |
| API runtime consommateur — exécution réelle d'un agent gouverné | contrat `1.1.0` ; run réel observé le 2026-08-03 (`openai` / `gpt-5.4`, coût mesuré) |
| Multi-provider : plusieurs providers câblés, le non-câblé lève une erreur typée | aucun fallback muet |
| Registre canonique outils + runtimes, à parité avec le registre exécutable | 22 = 22, gate `check:registry-integrity` |
| Fail-closed sans backend ni credentials (`503`, aucun chemin mock) | constaté sur les chemins d'authoring et de run |
| Authentification fail-closed dans **tous** les environnements | aucun fallback dev ; vérifié ligne à ligne le 2026-08-03 |
| Ingestion de télémétrie, payload traité comme hostile | plafond avant parse, schéma strict, aucun écho |
| Double verrou sur écriture distante (confirmation + armement) | aucune mutation avant le garde |
| **Garde d'identité sur les pages du cockpit** | smoke test : `/`, `/agents`, `/runs` → **302** vers `/sign-in?next=…` ; `/api/agent-ops/**` → **401** ; validé au navigateur sur 6 pages |
| **Surface de connexion `/sign-in`** | flux complet exercé au navigateur : formulaire → `POST /api/auth/login` → cookie `httpOnly`/`SameSite=Lax` → retour vers `next=` honoré |
| **`npm run health` dit la vérité** | `STACK HEALTHY` constaté ; sondé dans les deux sens (stack up / Next injoignable) |
| **`npm run check` vert et identique partout** | exit 0, 19 gates ; l'écart local/CI est fermé |
| **CI concluante** | run `30843292019` — `success` ; le job sans runner est `skipped`, il ne suspend plus rien |
| **Navigation annoncée aux lecteurs d'écran** | `aria-current="page"` constaté dans le DOM servi, **unique** par page, absent (pas `false`) sur les entrées inactives, et suit la navigation au clic réel |
| **Les 11 pages assainies vérifiées en session authentifiée** | 11/11 en 200, aucune trace de pile, aucun SQLSTATE, aucune mention PostgREST, aucune erreur console critique |
| **Isolation tenant du runtime** | jeton d'installation scopé : 7 agents rendus sur 14 en flotte ; agent d'un autre projet → **404** (contrôle négatif fait : agent du propre projet → 200) ; jeton valide + mauvaise installation → **401** |
| **Parcours consommateur de bout en bout** | installation `inst-development-dc635c1eb45f482fbfad` (HTTP 201) → jeton scopé → run réel → persistance |
| **Run réel via le runtime gouverné** | runId `bff77516-c634-438c-8a9c-e34579e614b4` · `openai` / `gpt-5.4` (`modelUnverified: false`) · **$0.019429** · `completed` 18 410 ms · dispatché sur l'**assistant dédié**, pas le graphe nu |
| **Parcours aval réel jusqu’à l’arrêt humain** | `run 57ddfc88…` → `qualification qual-1ea9edc7…` → `shadow cbacd5f9…` → `replay 3ea12074…` → `proposal ef6cff02` → V2 `512c952e` → comparaison `MATCHED` sur `8b3c2a28…`. V1 et V2 restent à **0 % mesuré**, benchmark 29,7 → 29,6 : aucune amélioration inventée, aucune décision ni promotion. |
| **Zéro exécution de trading sur le parcours aval** | 3 outils source tous `read_*` (`read_project_summary`, `read_copilot_summary`, `read_recent_runs`) · `unsafe_attempt_count=0` mesuré · tables `orders` et `trades` absentes · proposition `v2-created` avec `decided_at=null` |
| **Filtres Runs réellement consommés** | `parseRunsFilters` branché ; `?agent=` réduit la liste ; alias `copilot` accepté pour les liens déjà partagés |
| **Surface `/settings` en lecture seule** | posture des providers, runtime, endpoints assainis, plafonds, LangGraph, télémétrie — **aucune valeur de secret**, sondé avec une fuite masquée (préfixe tronqué) |

## Testé

| Suite | État |
|---|---|
| `npm run test` (unitaire, hors ligne) | **2 559 tests passés + 1 échec attendu**, 201 fichiers (2026-08-06) |
| `npm run typecheck` | **0 erreur** |
| `npm run build` | **OK** |
| `npm run check` | **exit 0** — 19 gates |
| Validation navigateur (Chromium) | **19 captures** + `REVIEW.md` sous `docs/visual-reviews/AIGENT-HARDENING-PRODUCTION-001/` — `/sign-in`, `/`, `/agents`, `/runs` aux **deux** points de rupture ; les 8 pages restantes en 1440×900 |
| Garde de régression `aria-current` | `tests/unit/sidebar-aria-current.test.ts` — 3 cas, **sondé rouge** quand l'attribut disparaît |
| Garde « une mesure de sécurité absente n'est pas 0 » | `tests/unit/qualification-orchestrator.test.ts` — 4 cas, **sondés rouges** en restaurant le `?? 0` ; le zéro **mesuré** passe toujours |
| Migrations aval live | 0047 puis 0048 appliquées explicitement sur GPU1 le 2026-08-04 ; OpenAPI confirme mesures nullables et colonnes `content_hash` / liens présentes |
| Parcours aval facturé unique complet | source run **$0.009905** · shadow **$0.003765** · replay **$0.00753** · proposition **$0.007176** ; provider `openai`, modèle `gpt-5.4`, hash identique sur toutes les preuves |
| Comparaison réelle V1/V2 | corpus `MATCHED`; tests **0 % → 0 %** (vrai zéro), benchmark **29,7 → 29,6** ; aucune promotion automatique ni décision |
| Idempotence concurrente shadow/replay | **Prouvée hors ligne sur la PR #107** : 2 puis 10 appels simultanés pour chaque moteur donnent exactement 1 acquisition, 1 exécution shadow / 1 comparaison replay (2 runners), 1 ligne, 1 coût cumulé, 1 terminal et 1 télémétrie `completed`. Les 1/9 perdants reçoivent tous `already running`. Panne shadow et replay → `failed`, second appel refusé, aucun retry implicite. |
| Validation visuelle finale | Chrome 1440×900, `/agents/seed-agent-alpha` : section V1/V2, empreinte et chaîne de preuves présentes, zéro erreur console |
| `check:secrets` (gitleaks) | propre — **1 218 commits scannés**, aucune fuite |
| Suite live (opt-in, facturée) | **hors chaîne** — jamais dans `verify` |
| `npm run health` — pile complète | **NEXT · LANGGRAPH · POSTGREST · STACK tous HEALTHY** (2026-08-04) |
| Environnement de dev local | **CPU 0 %** au repos, RSS stable ~809–815 MiB, **0 fichier `.sst` ouvert** — PR #101 **mergée** (`e3e84839`), donc vrai sur `main` |

**Non couvert par les tests** — à lire comme un manque, pas comme un détail :

- **Aucun test de rendu.** L'environnement vitest est `node` : il n'y a pas de
  DOM. Les composants ne sont couverts que par `typecheck` et `build`.
- **Majorité des routes API sans test.**
- Le comportement anti-bypass de la promotion n'est prouvé **hors ligne** que par
  lecture de texte SQL ; son comportement réel n'est prouvé que par la suite
  live, absente de la CI.

## Mergé

| Élément | SHA | État |
|---|---|---|
| PR #92 — Aperçu en composition plate | `9ef6b3c8` | mergée |
| PR #95 — preuve de rendu + gate `theme-foundation` (issue #94) | `9da3823c` | mergée |
| PR #96 — six entrées de navigation, Aperçu recomposé (issue #93) | `ff7e6e17` | mergée |
| Purge de code mort audité + accent unique en gravité | `6b0225cf` | mergé |
| PR #97 — AIGENT-GOVERNANCE-RESET-001, refonte de la doctrine | `5ffb22e1` | mergée |
| PR #98 — AIGENT-HARDENING-PRODUCTION-001, auth des pages | `885aef92` | mergée |
| PR #99 — AIGENT-RUNTIME-PRODUCTIZATION-001, isolation tenant | `b4675d35` | mergée |
| PR #100 — SETTINGS-MOBILE-OVERFLOW, débordement horizontal | `d2e27758` | mergée |
| PR #101 — cache disque Turbopack (environnement de dev **uniquement**) | `e3e84839` | mergée |
| PR #104 — compteur de sécurité absent ≠ « 0 unsafe actions » + migration 0047 | `f4569ed8` | mergée |
| PR #102 — rafraîchissement de cette checklist | `374c78b2` | mergée |
| PR #105 — section « Composants externes qualifiés » | `26dffb01` | mergée |
| PR #107 — tronçon aval + idempotence concurrente shadow/replay | `1ea80b91` | mergée — V2 créée, mesurée et laissée sans décision |
| PR #108 — convergence post-merge : idempotence, sécurité, vérité des mesures | `b4eb8dd8` | mergée — corrections P0/P1 sans déploiement |
| PR #109 — stabilisation documentaire (REPOSITORY_MAP, GLOSSARY, règle Cursor, decisions, corrections README) | `e6ff7abf` | mergée — documentaire, aucun delta fonctionnel |
| PR #110 — Catalyst `Link` → `next/link` (soft nav App Router) | `9ca55169` | mergée — soft-nav prouvée localement ; CI `check + build` SUCCESS |
| PR #111 — Catalyst-only broom (kit 17, kill aig-chip art) | `5d9071be` | mergée — Select/Alert/DescriptionList ; Badge sévérité ; surface-state texte-only |

**#103 est CLOSED, pas abandonnée.** Elle portait le même contenu que #105 mais
visait `chore/aigent-checklist-refresh-001` ; GitHub l'a fermée
automatiquement quand cette branche de base a été supprimée au merge de #102.
#105 la recrée à l'identique depuis la même branche de travail, vers `main`.
Erreur de séquencement, pas de perte de contenu.

## En review

Ce qui est poussé, ouvert, et **non mergé**. Une PR en review n'est pas un
acquis : rien de cette section n'est vrai sur `main`.

**Vide après le merge de la PR #111.**

## Déployé

**Déployé en production le 2026-08-06** — hot-deploy du bundle standalone
(`21107959` + fix docker `b0ef6c98`) dans le conteneur `aigent-app` sur gpu1.
Méthode : build local + `docker cp` (rebuild Docker bloqué — token Motion+
invalide côté gpu1 ; fix `NPM_TOKEN` build-arg poussé pour la prochaine fois).

Preuves :
- `curl http://127.0.0.1:8099/sign-in` → **200** (gpu1 loopback)
- `curl https://aigent.hearst.app/sign-in` → **200** (tunnel Cloudflare)
- `docker ps` → `aigent-app Up (healthy)`

**Non refait lors de ce déploiement** : rebuild image complète, reprovision
assistants (service `aigent-reprovision` inchangé).

## Non fonctionnel

Ce qui est **codé mais pas fonctionnel** — la distinction est le cœur de ce
fichier.

### Tables encore à zéro, relues en base le 2026-08-04

Ces zéros sont **mesurés**, pas supposés : la requête a abouti et la table est
vide. Le tronçon aval n’appartient plus à cette liste : après le parcours réel,
`qualification_runs=2`, `shadow_experiments=2`, `replay_comparisons=2` et
`improvement_proposals=1`.

| Table | Lignes | Ce que l'absence signifie |
|---|---|---|
| `agent_drafts` | **0** | aucun brouillon d'agent |
| `sandbox_reports` | **0** | aucun rapport de bac à sable |
| `tool_build_missions` | **0** | aucune mission de construction d'outil |

### Éléments

| Élément | Pourquoi ce n'est pas fonctionnel |
|---|---|
| **Export autonome d'agent** | capacité **future** (`PRODUCT_DOCTRINE.md` §3), pas l'autorité actuelle. L'artefact généré ne porte pas les outils ni les gardes de l'agent qualifié. |
| **Canal de retour depuis un artefact autonome** | structurellement inerte : le champ qui déclenche la génération de l'émetteur n'est écrit par aucun chemin, et l'émetteur n'a aucun appelant. |
| **Filtres autres qu'Agent et Projet** | statut, période, provider, modèle, durée, coût sont consommés **par URL** mais n'ont aucun contrôle d'interface. Le reset ne remet à zéro qu'Agent et Projet — délibérément, pour ne pas effacer en silence un paramètre invisible. |

## Limites connues

Relevé de l'audit du 2026-08-03 (10 périmètres). Chaque ligne est vérifiée.

> **Sept limites de ce relevé ont été fermées** par la mission
> `aigent-hardening-production-001` (branche non mergée) : limites 1, 2, 3, 5, 6,
> 7 et 11. Elles sont barrées ci-dessous avec leur preuve, et non supprimées :
> une limite qu'on efface est une limite qu'on ne peut plus auditer.

**Sécurité**

1. ~~**Les pages ne sont pas authentifiées.**~~ **FERMÉE** — proxy inversé, 302
   vers `/sign-in`, 401 pour l'API ; vérifié au navigateur sur 6 pages, aucune
   fuite de contenu avant redirection. Les 11 pages ne rendent plus de message
   interne (corrigé à la source). Ancien texte : Le matcher du proxy ne couvre que
   `/api/agent-ops/**` ; aucune page ne vérifie de session et elles lisent la
   base en direct. Plusieurs rendent un message d'erreur interne dans le HTML.
   Il n'existe plus de page de login : l'UI n'a jamais été derrière la garde.
2. ~~**Évasion du périmètre repo.**~~ **FERMÉE** — `..` refusé (formes encodées et double-encodées incluses), `list_repo_tree` filtre le chemin demandé. Ancien texte : : les
   segments `..` ne sont pas filtrés et l'URL sort du dépôt scopé, avec le jeton
   serveur. Le contrôle correct existe déjà côté TypeScript.
3. ~~**Throttle de login contournable.**~~ **FERMÉE** — `CF-Connecting-IP` prioritaire après vérification de la topologie réelle, plus un plafond global. Ancien texte : : l'identifiant client est pris à
   l'extrémité de la chaîne d'en-têtes que le client contrôle.
4. **Clé API opérateur unique**, non scopée, sans expiration, partagée à
   plusieurs systèmes.
5. ~~**Advisory de contournement de proxy.**~~ **FERMÉE** — `next` 16.2.10 → 16.2.12 ; 8 advisories de production (3 high) → 4 (0 high). Ancien texte : sur la version de framework installée —
   or le proxy est la garde unique de toutes les routes mutantes.

**Chaîne de validation**

6. ~~**`npm run check` rouge en local, vert en CI.**~~ **FERMÉE** — exit 0, 19 gates ; portée d'ignore étroite, sondée dans les deux sens. Ancien texte : et vert en CI : le linter voit des
   fichiers vendorés que git ignore. Même commande, deux verdicts.
7. ~~**La CI ne conclut jamais.**~~ **FERMÉE, PROUVÉE EN EXÉCUTION** — run
   `30843292019` : `conclusion=success`, `check + build` **success**,
   `SonarQube analysis (optional)` **skipped** au lieu de rester `queued`.
   Premier run terminal du dépôt après 100 runs sans succès. Ancien texte : : un job cible un runner inexistant, et
   l'annulation en cascade fait qu'aucun run n'atteint un état terminal. `main`
   n'a aucune protection de branche ni check requis.
8. **Deux gates prouvées contournables** : le détecteur de code mort accepte une
   référence depuis un simple `.md` ; le détecteur de valeur fabriquée ne voit
   pas une chaîne construite par concaténation.
9. **Une gate sans garde-fou anti-vacuité** : elle afficherait ✓ sur zéro cible.
10. **Une garde d'accessibilité morte** : elle interdit un nom de classe d'une
    version antérieure de Tailwind, absente du dépôt.
11. ~~**`npm run health` faux-rouge.**~~ **FERMÉE** — sonde une route gardée ; 401 = HEALTHY, 200 = UNHEALTHY. `STACK HEALTHY` constaté. Ancien texte : : il sonde une route
    supprimée. L'outil anti-faux-vert est lui-même cassé.

**Vérité des données**

12. **Un compteur de sécurité non mesuré est coercé en 0** dans l'orchestrateur
    de qualification, puis affiché comme preuve positive.
    **Aggravé le 2026-08-04 — le défaut est STRUCTUREL, pas applicatif.** Il ne
    vit pas seulement dans un orchestrateur : **18 colonnes de mesure sont
    déclarées `NOT NULL DEFAULT 0`** dans les migrations, dont
    `unsafe_attempt_count`, `unsafe_action_count`, `unauthorized_route_count`,
    `confirmation_mistake_count`, `score`, `pass_rate`, plus des coûts et des
    latences. `AGENTS.md` l'interdit explicitement (« une colonne de mesure est
    nullable ») et qualifie ce cas de défaut le plus grave de sa famille.
    Conséquence opérationnelle : **toute source qui écrira dans ces tables — y
    compris un composant externe — verra ses absences de mesure converties en
    zéros, donc en preuves positives.** C'est un prérequis à tout branchement
    aval, pas un nettoyage cosmétique.
    **PARTIELLEMENT FERMÉE le 2026-08-04** — PR #104 mergée (`f4569ed8`) :
    (a) migration 0047, les 23 colonnes de mesure perdent `NOT NULL DEFAULT 0`
    (`benchmark_suites.task_count` exclu, définitionnel) ; (b) `stepBenchmark`
    ne rend plus `PASS « 0 unsafe actions »` sur une absence — ni ligne
    `benchmark_results` manquante, ni compteur nul — mais `INSUFFICIENT_EVIDENCE`,
    avec garde de régression **sondée dans les deux sens**.
    **FERMÉE EN REVIEW le 2026-08-04** : les lectures
    aval identifiées ne rabattent plus pass rate, score, coût, latence ou compteur
    de sécurité absent vers zéro ; les writers concernés propagent `null`, les
    agrégations refusent les valeurs non finies, et des tests conservent les vrais
    zéros mesurés. Les migrations 0047 et 0048 ont été appliquées explicitement
    sur GPU1 ; OpenAPI confirme ces mesures nullables et le parcours réel a
    conservé un vrai `pass_rate=0` sans le confondre avec une absence. Les lignes
    historiques restent ambiguës et ne sont pas réécrites sans preuve.
13. **Un provider est écrit en dur** sur le chemin d'exécution produit, ce qui
    fausse le coût pour les autres providers.
14. **La télémétrie ne distingue pas la provenance** à l'agrégation : les runs
    internes sont comptés comme trafic déployé.

**Contrat d'API**

15. **11 POST coûteux sans protection de réentrance**, dont un qui crée deux
    branches et deux PR distantes sur un double-clic.
16. **Divergence de validation d'identifiant** entre deux routes voisines : un
    agent créable et exécutable peut être non benchmarkable.
17. **Environ la moitié des routes n'a aucun appelant** — héritage de surfaces
    supprimées. Surface totale recomptée le 2026-08-04 : **76 routes**
    (66 `agent-ops` · 7 `runtime/v1` · 2 télémétrie · 1 auth) pour **17 pages
    produit**. Le compte de 76 mesure la surface, **pas** l'usage : la
    proportion sans appelant reste une estimation non rechiffrée.

**Cohérence visuelle**

17a. ~~**`/settings` déborde horizontalement à 390 px.**~~ **FERMÉE, PROUVÉE** —
    branche `mission/settings-mobile-overflow`. Deux causes distinctes :
    (1) les `Panel`, items de grille, gardaient `min-width: auto` et refusaient
    de rétrécir — le `min-w-0` du conteneur ne se propage pas aux enfants ;
    (2) le `hint` de `Panel` est rendu `ml-auto shrink-0 truncate`, où
    `shrink-0` **annule** le `truncate`. Mesuré après correctif : **0 élément
    débordant** et `scrollWidth === clientWidth` aux cinq viewports
    (390/430/1280/1440/1920), focus clavier visible, console propre.
    Preuve : `docs/visual-reviews/SETTINGS-MOBILE-OVERFLOW/`. Ancien texte : Le débordement est **clippé** : ni scrollable, ni tronqué
    proprement, donc des noms de variables apparaissent coupés sur la surface
    même qui sert à dire quoi renseigner. Un correctif sur `EnvVarNames` a été
    posé (tokens cassables) — **ce n'était pas la cause**. `/runs` et `/agents`
    sont propres au même point de rupture.
    Piège de mesure à connaître : `documentElement.scrollWidth > clientWidth`
    renvoie **faux** ici parce que le document ne scrolle pas ; il faut mesurer
    `getBoundingClientRect().right` élément par élément.

17b. **Le contrat de lecture d'un run n'expose pas sa provenance de coût.**
    `GET /api/runtime/v1/runs/{runId}` ne rend ni provider, ni modèle, ni coût,
    ni latence — ils n'existent que dans la réponse du `POST`. Un consommateur
    qui relit un run *a posteriori* ne peut pas reconstituer ce qu'il a payé ni
    ce qui a tourné. Champs **absents**, pas des faux zéros.
    Point associé : `GET /projects/{key}/agents` répond 200/vide pour un projet
    étranger au lieu de 404 — **sans fuite** (un projet fictif donne la réponse
    identique, donc pas d'énumération possible), mais asymétrique avec le 404
    de `/agents/{agentId}`.

17c. **`/runtime` affiche le NOM d'une variable d'environnement** dans un
    diagnostic de configuration (`AIGENT_RUNTIME_TELEMETRY_TOKEN est absent…`).
    **Revu et conservé délibérément** : c'est un nom, jamais une valeur, sur une
    surface désormais authentifiée, et dire à l'opérateur quelle variable
    renseigner est le service attendu d'un plan de contrôle. Le message est en
    anglais alors que l'UI est en français — cosmétique, non traité ici.

18. **Deux autorités de statut coexistent** sur les mêmes écrans : les jetons
    sémantiques et une palette de composant. La gate en place ne voit pas la
    seconde. `DESIGN_DOCTRINE.md` tranche désormais ; l'application reste à faire.

**Relevées le 2026-08-04**

19. **Des événements shadow existent sans expérience correspondante.** La
    télémétrie porte **4 `shadow_started` et 4 `shadow_completed`**, alors que
    `shadow_experiments` est à **0**. Constaté, **non instruit**.
    **Resserré le 2026-08-04, et l'écart est plus sérieux qu'écrit d'abord.**
    Une première hypothèse — « les événements viennent du harnais trading
    in-memory » — a été **testée et réfutée** : ils sont émis par la route shadow
    elle-même, qui fait un `POST shadow_experiments` **avant** d'émettre
    `shadow_started`. Les lignes ont donc bien été créées, puis ont disparu — ou
    proviennent d'une autre base. L'absence d'insertion est écartée ; la cause
    reste inconnue et ne doit pas être devinée.

20. **Le cache disque de Turbopack occupe 1,3 GiB** sous
    `.next/dev/cache/turbopack`, dont **243 MiB d'orphelin `v16.2.10`** (version
    de Next désinstallée). **FERMÉE le 2026-08-04** — PR #101 mergée
    (`e3e84839`) : sur `main` le cache n'est plus lu (0 fichier `.sst` ouvert,
    CPU au repos 0 %, RSS stable). Le répertoire reste sur disque (ignoré par
    git) ; le supprimer récupérerait 1,3 GiB — non fait, et sans urgence
    puisqu'il est inerte.

21. **La télémétrie ne prouve sa version que sur 4 événements sur 48.**
    `version_verified` est à `false` sur **44** des 48 événements. Ce n'est pas
    un défaut de mesure : c'est la mesure qui dit qu'elle n'a pas pu prouver.
    À lire avec la limite 14 — l'agrégation ne distingue toujours pas la
    provenance.

22. **Aucune reprise automatique d'un `running` ancien.** Le driver traite un
    `running` comme déjà acquis, sans timeout arbitraire ni réexécution. Une
    panne moteur termine la ligne en `failed`; une nouvelle tentative exige une
    nouvelle qualification/clé explicite. Cette politique évite une double
    facturation mais laisse la récupération d'un processus tué avant son
    `catch` à une décision opérateur.

## Prochaines étapes

Ordonnées par rapport valeur / risque, révisées le 2026-08-06 (mission
`full-delivery-orchestration-001`).

1. **Garder la V2 en attente humaine** — inchangé ; proposition
   `improve-seed-agent-alpha-ef6cff02` toujours sans `decided_at`.
2. ~~**Exposer les métadonnées de coût en lecture**~~ — **FERMÉ** : `GET
   `/api/runtime/v1/runs/{runId}` rend désormais provider, modèle, coût,
   latence ; contrat **1.2.0**.
3. **Déployer** — en cours (docker-compose `deploy/app` sur gpu1).
4. ~~**Provider hardcodé** (limite 13)~~ — **FERMÉ** : plus de `?? 'openai'` sur
   le chemin runtime consommateur ; `model_provider` absent → 409.
5. ~~**Provenance télémétrie** (limite 14)~~ — **FERMÉ partiellement** :
   `summarizeFleetRuntimeTelemetry({ excludeInternal: true })` sur le dashboard ;
   agrégations agent-detail à aligner si besoin.
6. ~~**Réentrance POST coûteux** (limite 15)~~ — **PARTIEL** : guard sur 4
   routes à plus haut risque ; 15 autres sans garde.
7. **Instruire l'écart shadow** (limite 19) — **ouvert**.
8. ~~**390 px sur 11 pages**~~ — **FERMÉ** : captures
   `docs/visual-reviews/AIGENT-FULL-DELIVERY-001/` (2026-08-06).
9. **Autorité statut visuel** (limite 18) — **ouvert**.
10. ~~**Preuves visuelles HEAD courant**~~ — **FERMÉ** (même dossier).

## Composants externes qualifiés

Mission `AIGENT-EXTERNAL-COMPONENTS-QUALIFICATION-001`, 2026-08-04. **Étude
seule : aucun composant n'est intégré, aucune dépendance ajoutée, aucun code
produit.** Rien de cette section n'est fonctionnel — un composant étudié n'est
pas un composant branché.

**Critère éliminatoire appliqué à tous** : un score non mesuré doit rester non
mesuré. Aigent porte déjà un vocabulaire à six états (`PASS` · `FAIL` ·
`NOT_CONFIGURED` · `NOT_AVAILABLE` · `INSUFFICIENT_EVIDENCE` · `PENDING`) que la
plupart des moteurs examinés ne savent pas exprimer.

| Composant | Verdict | Motif décisif (vérifié) |
|---|---|---|
| **Arize Phoenix** | **INSPIRE_ONLY** | Aucun concept de shadow (`grep` ne renvoie que du *token replay* OAuth2) ; `compare_experiments` ne rend **aucun verdict** (3 champs, jugement à l'œil dans l'UI) ; `POST /v1/experiment_evaluations` est un **upsert** — une preuve d'échec s'efface avec un POST, face à des `promotion_gates` append-only relus dans la RPC de promotion. Serveur en **Elastic License 2.0** (pas open source au sens commercial) ; `PHOENIX_ENABLE_AUTH` **False par défaut**. |
| **Temporal** (serveur + SDK TS) | **REJECT** (revisitable) | Techniquement solide et **tout en MIT** (serveur, SDK TS, UI — le piège de licence supposé n'existe pas). Mais `bundler.ts` n'autorise que `assert`/`url`/`util` et `injectGlobals` n'injecte pas `fetch` : `node:crypto` (qui porte `fingerprintCandidate()`) et les ~20 appels PostgREST **sortent du workflow**. ~10 lignes resteraient, 837 partiraient en activités. Échelle : $0,367793 de dépense totale du projet. |
| **OpenWorkflow** | **REJECT** | **Signaux non bufferisés** — doc : *« If you send a signal before any workflow is waiting for it, the signal is lost »*. Une approbation humaine cliquée trop tôt disparaît **en silence** : exactement la classe de défaut que ce produit existe pour empêcher. Bus factor 1 (663 commits sur ~1130), 0.9.x, cron encore « Coming Soon » — il ne fermerait pas le trou visé. |
| **DeepEval** | **REJECT** | Critère éliminatoire touché : une trace jamais capturée produit `score=0.0, success=False` **et une prose qui affirme** « missing tools […] called [] » alors que la vérité est qu'on ne sait pas. Motif indépendant et suffisant : `ToolCorrectnessMetric`, annoncée déterministe, **exige une clé OpenAI pour être instanciée** — incompatible avec une gate hors ligne. |
| **Evidently** | **POC_REQUIRED** | Seul moteur à préserver `nan` au niveau de la valeur — mais `lte(0)` sur ce `nan` rend **`FAIL`** : fail-closed, donc sûr, et **indistinguable d'une vraie violation**. Deux faux zéros trouvés (`TextLength` sur texte absent → `0` avec `isna=False` ; `MeanValue(unsafe)=0.0` masque un run non mesuré). **Dormant** : 0 commit sur 90 jours, dernière release il y a 146 jours. Le pont Python↔TypeScript n'existe pas et son coût n'est pas chiffré. |
| **Opik** — plateforme | **REJECT** | **Second control plane** : MySQL + Redis + ClickHouse + Zookeeper + MinIO + backend Java + backend Python + frontend, plus une « Optimization Studio » serveur. Aigent a déjà son control plane et Langfuse. Scores inconnus **non préservés** : `ScoreResult(value=0.0, scoring_failed=True)` met le faux zéro dans le canal numérique ; `DEFAULT_SCORING_FAILURE_THRESHOLD = 1.0` fait qu'un run où 99 % des items ne sont pas notés se termine `COMPLETED`. **Zéro feedback humain** (158 fichiers cherchés). |
| **Opik** — 3 artefacts isolés | **ADAPT** | Templates du réflexif hiérarchique (Apache-2.0, texte pur, zéro dépendance), dont `_validate_reasons_present` qui **lève si aucun score ne porte de motif** ; plus `improves_over` et le refus du `NaN`. ~30 lignes à réécrire en TS **en corrigeant** le seuil de 1.0. |
| **TensorZero** | **REJECT — projet mort** | `archived=true` (vérifié via l'API GitHub, dernier push 2026-06-11), organisation entière archivée. **CVE-2026-54457, CVSS 7,7** (lecture de fichiers de credentials + SSRF) corrigée dans la *dernière* release, archivage 8 jours plus tard. Retenu **INSPIRE_ONLY** sur deux formes seulement : `StoppingResult::NotStopped` (troisième état explicite) et `CheckStoppingError::MissingVariance` — **une variance manquante lève, elle ne vaut pas zéro**. |
| **Binance `exchangeInfo`** | **ADAPT** | 8 endpoints Binance déjà appelés (3 spot, 5 futures). `exchangeInfo` absent, et **0 occurrence** de `tickSize`/`stepSize`/`minNotional`/`PRICE_FILTER`/`LOT_SIZE` dans tout `src/`. Mesuré : **17,4 Mo, 3670 symboles** (1371 TRADING), poids **20 à plat** — filtrer n'économise pas de quota, seulement du volume (~9400× avec `?symbols=[…]`) ; **ni ETag ni Last-Modified**. Aucun raccordement dans les deux dépôts TradeAgent. |

**Le résultat principal de cette qualification externe n'est aucun de ces
composants.** Le trou interne alors observé — driver aval non injecté — a depuis
été fermé et exercé en live par la mission
`AIGENT-DOWNSTREAM-LAST-MILE-001` (voir *Fonctionnel* et *Testé*). Aucun
composant externe n'a été ajouté pour le fermer.

**Drapeaux de supply chain, à connaître avant tout usage** — Opik et DeepEval
installent un `sys.excepthook` **global à l'import** et expédient du contenu
d'exception à un tiers ; Opik convertit chaque log WARNING+ en événement Sentry
avec traceback et **nom de workspace en clair**, son opt-out
`OPIK_SENTRY_ENABLE=false` n'étant documenté nulle part.
`EVIDENTLY_DISABLE_TELEMETRY` est du **code mort** (la vraie variable est
`DO_NOT_TRACK`), et `PHOENIX_TELEMETRY_ENABLED=0` **fait planter le démarrage**
au lieu de désactiver. Seul **OpenWorkflow** est à zéro télémétrie.

**Porte de sortie de licence, si Phoenix revenait un jour** : le serveur et
`phoenix-evals` (Python) sont ELv2, mais **les paquets JS `@arizeai/*` sont
Apache-2.0** (vérifié sur le registre npm).

**Limites de cette qualification, à ne pas surinterpréter** : aucun composant
n'a été déployé ni exercé de bout en bout ; les verdicts Opik et TensorZero
portent sur l'**architecture** lue, pas sur l'efficacité empirique des
algorithmes ; le support Postgres du **serveur** Temporal n'a pas pu être
vérifié (serveur Go non cloné) ; la qualification **juridique** de l'ELv2 pour
l'usage exact d'Aigent relève d'un avis juridique, pas de cette étude.

## Preuves

| Type | Référence |
|---|---|
| `main` | `6a8e6f00496bccd536a74513eb5535e146e8959a` (2026-08-06, après #109 · #110 · #111) |
| PR mergées | #92 `9ef6b3c8` · #95 `9da3823c` · #96 `ff7e6e17` · #97 `5ffb22e1` · #98 `885aef92` · #99 `b4675d35` · #100 `d2e27758` · #101 `e3e84839` · #104 `f4569ed8` · #102 `374c78b2` · #105 `26dffb01` · #107 `1ea80b91` · #108 `b4eb8dd8` · #109 `e6ff7abf` · #110 `9ca55169` · #111 `5d9071be` |
| PR ouverte, **non mergée** | **aucune** au 2026-08-06 |
| Relecture des chiffres en base | 2026-08-04 — PostgREST `HEALTHY`, lecture seule, 29 tables comptées, arbre inchangé |
| Pile locale | `npm run health` — NEXT · LANGGRAPH · POSTGREST · STACK **HEALTHY** (2026-08-04) ; dev server pid 22899 sur `127.0.0.1:3987` |
| Issues | #93 **fermée** (livrée par #96) · #94 fermée (livrée par #95) — relu le 2026-08-04 |
| Audit de référence | 2026-08-03, 10 périmètres, lecture seule, arbre inchangé |
| Run runtime réel | 2026-08-03 — `openai` / `gpt-5.4`, coût mesuré, provider recoupé en base |
| Déploiement | **aucun** — absence de mécanisme vérifiée le 2026-08-03 |
| Run consommateur réel | `bff77516-c634-438c-8a9c-e34579e614b4` — `openai` / `gpt-5.4`, $0.019429, 2026-08-04 |
| Installation consommateur | `inst-development-dc635c1eb45f482fbfad`, projet `proj-tradeagent` |
| Preuve consommateur | `docs/visual-reviews/AIGENT-RUNTIME-PRODUCTIZATION-001/CONSUMER-PILOT.md` |
| PR #99 | mergée — `b4675d35` ; CI post-merge `success` (run `30857825482`) |
| PR #108 | mergée — `b4eb8dd8` ; CI post-merge `success` (run `30924224962`) ; navigateur local `/`, `/agents`, `/agents/seed-agent-alpha`, `/runs`, `/settings` propres (0 erreur console, 0 erreur réseau) |
| Preuve responsive `/settings` | `docs/visual-reviews/SETTINGS-MOBILE-OVERFLOW/` — 5 captures + REVIEW, 0 débordement aux 5 viewports |

> Un runId de run interne d'Aigent sera consigné ici dès qu'une mission en
> produira un dans le cadre d'une preuve. La ligne ci-dessus référence un run
> exécuté **par** le runtime d'Aigent à la demande d'un consommateur ; c'est la
> preuve que le chemin d'exécution canonique fonctionne.
