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

**État de référence** — `main` = `6b0225cfc7ef6d2b943cb22dff9f3f6318a8e2e6`
Dernière mise à jour : 2026-08-03 · mission `aigent-governance-reset-001`

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

## Testé

| Suite | État |
|---|---|
| `npm run test` (unitaire, hors ligne) | **2 364 tests, 0 skipped**, 189 fichiers |
| `npm run typecheck` | **0 erreur** |
| `npm run build` | **OK**, 41 routes |
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

**Rien n'est déclaré déployé.**

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
| **Écran de comparaison V1/V2** | la donnée est **calculée à chaque lecture de fiche agent puis jetée** — aucun composant ne la rend. On demande une décision humaine sans montrer le diff. |
| **Export autonome d'agent** | capacité **future** (`PRODUCT_DOCTRINE.md` §3), pas l'autorité actuelle. L'artefact généré ne porte pas les outils ni les gardes de l'agent qualifié. |
| **Canal de retour depuis un artefact autonome** | structurellement inerte : le champ qui déclenche la génération de l'émetteur n'est écrit par aucun chemin, et l'émetteur n'a aucun appelant. |
| **Surface `/settings`** | placeholder ; son contrat backend existe et n'a aucun appelant. |
| **Filtres de runs et d'agents par URL** | le parseur de filtres n'est appelé par **aucune page** : l'URL affiche un filtre, la page renvoie tout. |

## Limites connues

Relevé de l'audit du 2026-08-03 (10 périmètres). Chaque ligne est vérifiée.

**Sécurité — à traiter en premier**

1. **Les pages ne sont pas authentifiées.** Le matcher du proxy ne couvre que
   `/api/agent-ops/**` ; aucune page ne vérifie de session et elles lisent la
   base en direct. Plusieurs rendent un message d'erreur interne dans le HTML.
   Il n'existe plus de page de login : l'UI n'a jamais été derrière la garde.
2. **Évasion du périmètre repo dans les outils de lecture LangGraph** : les
   segments `..` ne sont pas filtrés et l'URL sort du dépôt scopé, avec le jeton
   serveur. Le contrôle correct existe déjà côté TypeScript.
3. **Throttle de login contournable** : l'identifiant client est pris à
   l'extrémité de la chaîne d'en-têtes que le client contrôle.
4. **Clé API opérateur unique**, non scopée, sans expiration, partagée à
   plusieurs systèmes.
5. **Advisory de contournement de proxy** sur la version de framework installée —
   or le proxy est la garde unique de toutes les routes mutantes.

**Chaîne de validation**

6. **`npm run check` est rouge en local** et vert en CI : le linter voit des
   fichiers vendorés que git ignore. Même commande, deux verdicts.
7. **La CI ne conclut jamais** : un job cible un runner inexistant, et
   l'annulation en cascade fait qu'aucun run n'atteint un état terminal. `main`
   n'a aucune protection de branche ni check requis.
8. **Deux gates prouvées contournables** : le détecteur de code mort accepte une
   référence depuis un simple `.md` ; le détecteur de valeur fabriquée ne voit
   pas une chaîne construite par concaténation.
9. **Une gate sans garde-fou anti-vacuité** : elle afficherait ✓ sur zéro cible.
10. **Une garde d'accessibilité morte** : elle interdit un nom de classe d'une
    version antérieure de Tailwind, absente du dépôt.
11. **`npm run health` est faux-rouge en permanence** : il sonde une route
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

18. **Deux autorités de statut coexistent** sur les mêmes écrans : les jetons
    sémantiques et une palette de composant. La gate en place ne voit pas la
    seconde. `DESIGN_DOCTRINE.md` tranche désormais ; l'application reste à faire.

## Prochaines étapes

Ordonnées par rapport valeur / risque.

1. **Authentifier les surfaces de production** (limite 1) — le seul point qui
   expose des données sans décision préalable.
2. **Filtrer les segments `..`** dans les outils de lecture (limite 2) — une
   ligne, le contrôle existe déjà ailleurs.
3. **Rendre la chaîne de validation concluante** (limites 6 et 7) : ignorer les
   fichiers vendorés côté linter, désarmer le job sans runner.
4. **Fermer les faux verts de mesure** (limites 12, 13, 14).
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

> Un runId de run interne d'Aigent sera consigné ici dès qu'une mission en
> produira un dans le cadre d'une preuve. La ligne ci-dessus référence un run
> exécuté **par** le runtime d'Aigent à la demande d'un consommateur ; c'est la
> preuve que le chemin d'exécution canonique fonctionne.
