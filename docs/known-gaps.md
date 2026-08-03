# Known gaps — ce qui manque honnêtement

> **ARCHIVE — remplacé comme autorité par `docs/CURRENT_FUNCTIONAL_CHECKLIST.md`
> § Limites connues (2026-08-03).**
>
> Conservé pour ses explications : ce fichier dit *pourquoi* un écart compte, ce
> qu'une liste ne capture pas. Mais son inventaire est daté et plusieurs entrées
> ont été comblées sans qu'il soit mis à jour — le mode de défaillance qu'il
> décrit lui-même au § « La dérive documentaire ». Ne pas le citer comme état
> courant.

> Compagnon de `docs/current-capabilities.md`. Ce fichier-là dit dans quel état
> est chaque capacité ; celui-ci dit pourquoi l'écart compte et ce que le combler
> impliquerait. Rien ici n'est de la spéculation — chaque manque a été établi en
> lisant le code.
>
> **Ce fichier n'est pas de la doctrine** : c'est un constat daté. Les règles
> vivent dans `CLAUDE.md` et `AGENTS.md`. Mis à jour 2026-07-31 (tri docs).

## 1. Une surface UI reste un placeholder

Le front a 16 routes (shell + listes + détails). Une seule affiche encore
`SurfacePlaceholder` :

- `/settings` — réglages (UI non branchée)

Le backend Settings existe désormais en lecture opérateur :
`GET /api/agent-ops/settings/posture` expose un contrat server-only expurgé
(auth, backend GPU1, LangGraph, providers, observabilité, shipping GitHub,
Learning Runtime) sans valeur de secret. Le manque restant est strictement UI :
l'écran `/settings` n'interroge pas encore cette route.

Ce n'est pas un faux zéro : le composant dit explicitement qu'aucune lecture n'a
été tentée. Le reste du parcours (aperçu, runs, agents, projets, builder,
qualification, livraison, runtime, learning, actions) est branché.

**`/actions` a été branché le 2026-08-01** (mission AIGENT-SUPERVISION-LEARNING-001) :
file opérateur complète, filtres dérivés, et reprise d'un run `needs-confirmation`
derrière une double confirmation. C'est la SEULE mutation de cet écran — les huit
autres catégories de la file sont en lecture seule avec « Ouvrir le contexte »,
faute de route mutante sûre en un clic. En particulier, une **décision
d'amélioration V2 reste non arbitrable depuis la file** : la route
`improve/decision` existe, mais l'arbitrage exige un jugement éditorial qui ne
tient pas dans un bouton.

**Aucune gate ne mesure le rendu.** Une réécriture du kit UI peut rester verte —
voir `src/components/ui/README.md` et le revert `5e2aa63`.

## 2. Le canal de retour consommateur n'a jamais porté de trafic réel

L'ingestion est solide : jeton dédié, payload traité comme hostile (plafond
16 Ko, schéma Zod strict, scan de motifs de secrets, aucun écho en réponse), une
table unique pour deux sources.

Mais **zéro ligne de `runtime_telemetry_events` ne provient d'un agent déployé à
l'extérieur** : tout ce qui est stocké vient du runner interne d'Aigent ou d'un
événement de cycle de vie. La boucle
`create → qualify → ship → execute → telemetry → improve` n'a donc jamais été
bouclée de bout en bout par un vrai consommateur. L'endpoint accepte ; personne
n'a encore prouvé qu'il émet.

Corollaire honnête : « Aigent apprend des runs de ses agents déployés » décrit
une capacité **construite**, pas une capacité **exercée**.

## 3. Le shipping est doublement verrouillé par défaut

`push-agent` n'écrit dans un vrai repo GitHub que si **les deux** verrous sont
levés : `confirm: true` dans le corps **et** `GITHUB_PUSH_ENABLED=1` dans
l'environnement. Sinon, dry-run.

C'est le bon défaut pour une écriture distante destructive — mais ça veut dire
que la jambe « livraison » de la boucle n'est pas exercée en fonctionnement
normal, et que « Aigent livre des agents » parle d'un chemin éteint tant que
personne ne l'allume délibérément.

## 4. Le tool builder ne construit qu'un outil

La machinerie de build-mission (`tool_build_missions`) est générale ; la
couverture en sandbox ne l'est pas — un seul outil en dispose. Un outil construit
sans sandbox ne peut pas être certifié par exécution.

## 5. `mistral` est déclaré et non câblé

Il lève une erreur typée plutôt que de retomber silencieusement sur un autre
provider — c'est le bon échec. Mais toute doc ou config qui le liste comme option
liste quelque chose qui ne peut pas tourner. C'est le **seul** provider dans ce
cas : `openai`, `google` (tool-use inclus) et `local` (vLLM, opt-in) exécutent
réellement.

## 6. Dérive de version: calculable, avec zones d'inconnu explicites

La trace de cycle de vie compare désormais la version LIVRÉE (par
`agent_delivery_events.version_id`) et la version auto-déclarée par la
télémétrie (`runtime_telemetry_events.agent_version`), avec quatre sorties
explicites:

- `state: 'measured'` + `versionsMatch: true` quand les deux preuves concordent ;
- `state: 'measured'` + `driftDetected: true` quand elles divergent ;
- `state: 'unknown'` quand une preuve manque (pas de livraison, pas de
  `version_id`, pas de version télémétrie) ;
- `state: 'unknown'` si la lecture télémétrie échoue.

Le calcul reste strictement non inférentiel: aucune déduction par timestamp,
position de version, stage ou nom partiel.

## 7. `active_in_consumer` ne doit jamais être déduit des mauvaises preuves

L'étape `active_in_consumer` n'est jamais dérivée d'une livraison, d'un stage
de version ou d'une télémétrie brute. Le resolver lifecycle consomme uniquement
le verdict de `consumer-activation.ts` et conserve la distinction
`unknown`/`unavailable` (lecture impossible).

## 8. Les gates de vérité sont plus étroites que leur réputation

À énoncer tel quel, parce que l'inverse a déjà été cru dans ce repo :

- `check:lifecycle-truth` ne scanne **qu'un seul fichier** (`agent-lifecycle-trace.ts`).
- `check:agent-truth` vérifie qu'aucun roster n'est *importé*, qu'aucun
  provider/modèle n'est codé en dur dans le contrat canonique, et bloque aussi
  les fallbacks provider/modèle inventés dans `dashboard-overview.ts`,
  `agent-detail.ts` et `data.ts` — il ne prouve toujours pas l'exécutabilité.
- `check:render-truth` couvre désormais aussi `dashboard-overview.ts`,
  `agent-detail.ts` et `data.ts` contre les faux zéros, coercitions `NaN` et
  absences présentées comme mesurées.
- **Aucune gate ne détecte un assistant LangGraph manquant** — le symptôme
  documenté (agent d'apparence saine, `tool_call_count = 0`, « pas de données »)
  reste possible avec toutes les gates vertes.
- **Aucune gate ne mesure le rendu UI** — empreinte SHA du kit ≠ pixels corrects.

## 9. Le Learning Runtime est un contrat sans moteur en face

`src/lib/agent-mission-control/learning-runtime.ts` sait interroger un moteur
H-Supervised (`health`, `capabilities`) et distingue quatre états —
`live | partial | unavailable | not_configured`. **Aucun moteur ne répond
aujourd'hui** : `AIGENT_LEARNING_RUNTIME_URL` n'est pas renseignée, donc l'état
réel est `not_configured` et `/learning` le dit.

Ce qui est prouvé : le client ne tente aucun appel sans configuration, il
n'échange jamais une panne contre une liste vide, et le jeton n'apparaît ni dans
l'endpoint affiché, ni dans un message d'erreur (tests unitaires + une preuve
visuelle en état `unavailable`, obtenue en pointant vers un port fermé).

Ce qui ne l'est pas : les états `live` et `partial` contre un vrai moteur. Les
capacités de la mission suivante — datasets, évaluations par lot, jobs
d'entraînement, registre de modèles — **n'ont volontairement aucun écran** :
elles sont décrites dans le bloc runtime de `/learning` plutôt que suggérées par
des pages vides.

## 10. Le pont Obsidian construit des chaînes, il ne touche à rien

`obsidian-bridge.ts` génère des URI `obsidian://` (ouvrir, créer, rechercher,
Canvas) et refuse tout contenu suspect avant encodage. Il n'accède **jamais** au
filesystem d'un vault et n'ouvre rien lui-même.

Conséquence honnête : que l'URI soit correctement formée est prouvé (82 tests
unitaires + relevé DOM avec un nom de vault accentué et espacé). **Qu'Obsidian
l'honore ne l'est pas** — l'application n'est pas installée sur la machine de
développement, donc aucun clic de bout en bout n'a été observé.

Les quatre templates de `docs/templates/obsidian/` sont versionnés côté Aigent et
substituables, mais rien ne garantit qu'un vault donné les accepte tels quels.

## 11. La dérive documentaire est le mode de défaillance récurrent ici

Il n'existe **aucune gate qui confronte un document au code**. Tant qu'il n'y en a
pas, ce fichier et `docs/current-capabilities.md` ne valent que par la dernière
personne qui a lu la source. Deux réflexes en découlent :

1. quand un document et le code se contredisent, **le code a raison** ;
2. les rapports de mission historiques vivent dans **l'historique git**, jamais
   comme règles actives.

## 12. `quality:dead` reste bloqué par 3 exports frontend hors ownership

Exécution prouvée sur la mission `AIGENT-CODEX-011` :

- `npm run check` passe (incluant `audit:dead`).
- `npm run quality:dead` échoue uniquement sur 3 `Unused exported types` :
  `LabPatternId` (`src/components/lab/registry.ts`), `SurfaceRole` et
  `AllowedThemeParam` (`src/components/visualizations/embed/contract.ts`).

Ces fichiers appartiennent au lot frontend actif ; ils n'ont pas été modifiés
ici par contrainte d'ownership explicite. Tant qu'ils restent exportés sans
consommateur, `npm run verify` échoue sur l'étape Knip.

## Non vérifié dans cette passe

- Si le backend GPU1 live détient le roster documenté dans l'état décrit. Aucun
  compte d'agents n'est figé dans la doctrine précisément pour cette raison.
- Si les produits consommateurs déployés émettent effectivement de la télémétrie
  (§2 dit ce qui est stocké, pas ce qui est émis ailleurs).
- Le comportement runtime au sens large : cette passe a lu la source et exécuté
  les gates, elle n'a pas lancé d'agent.
