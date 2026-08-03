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

**État de référence** — `main` = `b4675d35bb1c11cfdb2688305528ba9f332d9c3d`
(PR #99 mergée, CI post-merge `success` — run `30857825482`)
Dernière mise à jour : 2026-08-04 · mission `mission/settings-mobile-overflow`
(branche **non mergée**)

---

## Fonctionnel

Capacités dont l'exécution réelle a été constatée.

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
| **Zéro exécution de trading** | 5 outils tous `read_*` · `improvement_proposals` reste à 0 · **aucune table d'ordre n'existe** — structurellement impossible, pas seulement non advenu |
| **Filtres Runs réellement consommés** | `parseRunsFilters` branché ; `?agent=` réduit la liste ; alias `copilot` accepté pour les liens déjà partagés |
| **Surface `/settings` en lecture seule** | posture des providers, runtime, endpoints assainis, plafonds, LangGraph, télémétrie — **aucune valeur de secret**, sondé avec une fuite masquée (préfixe tronqué) |

## Testé

| Suite | État |
|---|---|
| `npm run test` (unitaire, hors ligne) | **2 516 tests passés + 1 échec attendu**, 197 fichiers |
| `npm run typecheck` | **0 erreur** |
| `npm run build` | **OK** |
| `npm run check` | **exit 0** — 19 gates |
| Validation navigateur (Chromium) | **19 captures** + `REVIEW.md` sous `docs/visual-reviews/AIGENT-HARDENING-PRODUCTION-001/` — `/sign-in`, `/`, `/agents`, `/runs` aux **deux** points de rupture ; les 8 pages restantes en 1440×900 |
| Garde de régression `aria-current` | `tests/unit/sidebar-aria-current.test.ts` — 3 cas, **sondé rouge** quand l'attribut disparaît |
| `check:secrets` (gitleaks) | propre sur l'historique complet |
| Suite live (opt-in, facturée) | **hors chaîne** — jamais dans `verify` |

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
| Purge de code mort audité + accent unique en gravité | `6b0225cf` | mergé — **tête de `main`** |

**Écarts de suivi constatés le 2026-08-03**, à corriger côté GitHub :

- **L'issue #93 est encore OUVERTE** alors que sa PR #96 est mergée.
- L'issue #94 est fermée (livrée par #95). #93 et #94 sont des **issues**, pas
  des PR — la confusion des deux numérotations a déjà produit un rapport d'état
  inexact.
- `ff7e6e17` a été cité comme tête de `main` ; `main` a avancé depuis vers
  `6b0225cf`.

## Déployé

**Rien n'est déclaré déployé.** La mission de durcissement n'a rien déployé et
n'a pas été mergée.

Vérifié le 2026-08-03 : `.github/workflows/ci.yml` ne contient que deux jobs
(`check + build`, `sonarqube`) et **aucune étape de déploiement**. Il n'existe ni
`vercel.json`, ni `railway.json`, ni `fly.toml`, ni `netlify.toml`. Les fichiers
de `deploy/` sont des `docker-compose` lancés **à la main**.

Conséquence : **un push ne déploie rien**, et aucune ligne de cette section ne
peut être remplie sans un ordre de déploiement explicite et sa preuve.

## Non fonctionnel

Ce qui est **codé mais pas fonctionnel** — la distinction est le cœur de ce
fichier.

| Élément | Pourquoi ce n'est pas fonctionnel |
|---|---|
| **Qualification aval : shadow, replay, qualification runs** | code complet, **0 ligne en base**. La route de qualification ne transmet pas de driver → les étapes retombent systématiquement en « non disponible ». |
| **Boucle d'amélioration autonome** | la fonction existe et est testée, mais **aucune route ni cron ne l'appelle**. Moteur sans surface. |
| **Écran de comparaison V1/V2 — RENDU, NON PROUVÉ** | le composant existe et est testé (16 cas, dont le garde contre les scores V2 à 0 % qui afficheraient une régression inventée). Mais `improvement_proposals` est **vide en base** : les trois états (V2 disponible / sans V2 / scores non mesurés) n'ont **jamais été observés rendus**. Reste NON PROUVÉ tant qu'aucune proposition réelle n'existe — une absence de donnée ne devient pas un PASS. |
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
    supprimées.

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

## Prochaines étapes

Ordonnées par rapport valeur / risque. Les trois premières de la version
précédente sont faites.

1. **Observer réellement les trois états V1/V2** — il faut une proposition
   d'amélioration en base. Tant qu'il n'y en a pas, l'écran reste NON PROUVÉ.
2. **Régénérer les preuves visuelles des autres surfaces au HEAD final** — les captures existantes
   datent d'un HEAD antérieur aux deux correctifs de ce commit, et trois
   contrôles V1/V2 restent non observables tant qu'aucune proposition
   d'amélioration n'existe en base.
3. **Fermer les faux verts de mesure** (limites 12, 13, 14) — un compteur de
   sécurité non mesuré coercé en 0, un provider écrit en dur, une télémétrie qui
   ne distingue pas la provenance.
4. **Réentrance des POST coûteux** (limite 15) — dont un qui crée deux PR
   distantes sur un double-clic.
5. **Couvrir les 8 pages restantes en 390 px** — seules `/sign-in`, `/`,
   `/agents`, `/runs` ont été vérifiées aux deux points de rupture.
5. **Appliquer `DESIGN_DOCTRINE.md`** aux écrans de production (limite 18), avec
   preuves visuelles.
6. **Brancher la qualification aval** : transmettre un driver pour que shadow et
   replay cessent de retomber en « non disponible ».
7. **Rendre l'écran de comparaison V1/V2** — la donnée est déjà calculée.

## Preuves

| Type | Référence |
|---|---|
| `main` | `6b0225cfc7ef6d2b943cb22dff9f3f6318a8e2e6` |
| PR mergées | #92 `9ef6b3c8` · #95 `9da3823c` · #96 `ff7e6e17` |
| Issues | #93 **ouverte** (livrée par #96) · #94 fermée (livrée par #95) |
| Audit de référence | 2026-08-03, 10 périmètres, lecture seule, arbre inchangé |
| Run runtime réel | 2026-08-03 — `openai` / `gpt-5.4`, coût mesuré, provider recoupé en base |
| Déploiement | **aucun** — absence de mécanisme vérifiée le 2026-08-03 |
| Run consommateur réel | `bff77516-c634-438c-8a9c-e34579e614b4` — `openai` / `gpt-5.4`, $0.019429, 2026-08-04 |
| Installation consommateur | `inst-development-dc635c1eb45f482fbfad`, projet `proj-tradeagent` |
| Preuve consommateur | `docs/visual-reviews/AIGENT-RUNTIME-PRODUCTIZATION-001/CONSUMER-PILOT.md` |
| PR #99 | mergée — `b4675d35` ; CI post-merge `success` (run `30857825482`) |
| Preuve responsive `/settings` | `docs/visual-reviews/SETTINGS-MOBILE-OVERFLOW/` — 5 captures + REVIEW, 0 débordement aux 5 viewports |

> Un runId de run interne d'Aigent sera consigné ici dès qu'une mission en
> produira un dans le cadre d'une preuve. La ligne ci-dessus référence un run
> exécuté **par** le runtime d'Aigent à la demande d'un consommateur ; c'est la
> preuve que le chemin d'exécution canonique fonctionne.
