# HANDOFF — Plateforme d'agents Aigent → workspaces (état au 2026-07-16)

> Prompt de continuation pour le prochain agent. Session dense : on a bouclé le
> cycle de vie complet d'un agent (créer → tester → auto-améliorer → promouvoir →
> pousser → consommer dans un workspace). Ce doc = la vérité de l'état, ce qui est
> fait / pas fait, et la suite immédiate. **Lis-le en entier avant d'agir.**

---

## LE MODÈLE (la doctrine, non négociable)

**Aigent = l'usine UNIQUE à agents.** Elle conçoit, teste, débugge, promeut et
**pousse** les agents. Les workspaces cibles (TradeAgent & co) **reçoivent** et
**exploitent** — ils ne fabriquent JAMAIS d'agent en local.

Frontière stricte, à chaque étape le back-office décide (jamais d'auto) :
```
AIGENT (usine)                          WORKSPACE (consommateur)
créer → tester → auto-improve →
promouvoir V1 → [PUSH manuel] ──push──▶ registre (agents/_registry.json sur GitHub)
                                        → [ACTIVER manuel] → agent actif (flotte)
                                        → [DÉPLOYER version manuel] → V2 remplace V1
                                        → commercialisation = HUMAIN, hors scope agent
```
- **Push, Activer, Déployer-version, Approuver, Promouvoir = TOUJOURS un geste
  humain explicite.** Jamais automatique. Câblé partout (`forbiddenActions:
  auto-promote to production`).
- La **commercialisation** (à vendre ? un seul client ? prix ? allocation ?) est
  décidée par Adrien, APRÈS activation, HORS du périmètre agent. Ne jamais la
  pré-remplir.

---

## ÉTAT GIT (au handoff)

- **Aigent** : `/Users/adrienbeyondcrypto/Aigent`, branche `main`, HEAD `1f0bde4`,
  working tree **propre**, 0 worktree. Gate `npm run check` verte, 116 tests.
  Dev : `npm run dev` (Next + LangGraph). ⚠️ Le dev **shuffle de port** :
  TradeAgent occupe souvent `:3000`, donc **Aigent tourne sur `:3001`** (LangGraph
  `:2024`). Toujours re-détecter le port. Login dev : mdp `hearst-agent-mc-2026`.
  Bypass dev (`AMC_DEV_BYPASS_AUTH=1`) ouvre les PAGES mais PAS l'API agent-ops →
  il faut une session valide (se logger) pour que les mutations marchent.
- **TradeAgent** : `/Users/adrienbeyondcrypto/Desktop/TradeAgent/app`, `main`,
  HEAD `825c4cd`, ~4 fichiers en vol (travail d'Adrien/autre session — NE PAS
  toucher). ⚠️ **Une session Claude concurrente travaille souvent dans ce repo**
  (ledger, private-accounts). Sa gate peut être ROUGE (son code, pas le tien).
  Toujours : vérifier que c'est calme, committer UNIQUEMENT tes fichiers (jamais
  `-A`), demander le feu vert repo à Adrien (repo externe).

---

## CE QUI EST FAIT (Aigent — tout committé/poussé sur main)

**Cycle de vie d'un agent, de bout en bout, PROUVÉ sur BTC Alert & Levels Sentinel :**
- Champ `manifest.skills` (skills métier générées par l'Agent Builder) + migration
  `0013_manifest_skills`. Carte Skills sur l'overview.
- Bouton **"Generate test suite"** (un agent créé peut avoir 0 suite si l'auto-eval
  a raté → ce bouton la génère). Route `tests/generate`.
- Tests : tableau des cas réaligné, "Run tests" reçoit le suiteId (s'active).
- **Streaming live des tests** : route SSE `tests/run/stream`, `runTestSuite` émet
  des events par cas, + **CANVAS LangGraph rejoué EN DIRECT** (2/3 canvas node-par-
  node + 1/3 détail live + tableau qui se remplit). `streamOnAgentServer` (stream
  au lieu de wait, résultat identique via getState). Composant pur `GraphCanvasSvg`.
- Page **/admin/langgraph** (explorateur) : **supprimée** avec la nav project-centric
  (`70d357c`) — le canvas SVG vit dans le builder / panneaux de test live.
- **Improve** = l'outil de debug : lit les tests échoués → patch le system prompt →
  V2 → re-run. LIVE et câblé. A fait passer BTC de 60% → 100%.
- **Bouton "Auto-improve"** (`098f7fb`) : boucle `runAutoImprovementCycle`
  (improvement-loop.ts) qui enchaîne analyze→create-V2→re-run→compare toute seule,
  jusqu'à convergence/plateau/budget ($2)/max 5 itérations. Route SSE `improve/auto`
  (progression live). **S'ARRÊTE avant l'approbation — jamais d'auto-approve.**
  Message d'erreur 401≠503 corrigé (`1f0bde4`). ✅ Testé server-to-server (marche ;
  sur BTC répond "nothing to improve" car déjà 100% — normal).
- **Garde de maturité du push** : la route `push-agent` refuse 422 si
  `productionVersionId === null`. On ne pousse qu'un agent testé + promu.
- **Le PONT Aigent→workspace armé** : `pushAgentToRepo` (github.ts) pousse
  `agents/<slug>/{handler,manifest,README}` + `agents/_registry.json` +
  `agents/README.md` via l'API GitHub. Registre fusionné (re-push = update).
  `last_push_*` persistés. Bouton "Push to repo" + dialog. `GITHUB_PUSH_ENABLED=1`
  posé (dev `.env.local` + prod gpu1 `deploy/app/.env`). ✅ **BTC réellement poussé**
  dans `adrien-debug/TradeAgent` (commit 1e5bbaf).
- **Passe UX complète** (audit + retours) : nav réordonnée
  `Overview→Manifest→Quality→Runs→Improve→Release` (Config→Manifest, Builder retiré
  → bouton "Open Builder" sur la liste), header copilot (nom+statut+model),
  **Release à 1 seul bouton Promote** (legacy supprimé), Improve lisible (stepper +
  next-action + états grisés expliqués), preuve de push sur l'overview, dé-dups.
- Divers réglés : contraste blanc-sur-vert (variant Badge accentSolid), code mort
  (4 primitives Catalyst supprimées, 23 primitives), config gpu1 isolée +
  reproductible (`deploy/db/`, `REVOKE CONNECT`, `docs/BACKEND-GPU1.md`).

## CE QUI EST FAIT (TradeAgent — côté consommateur)

- `registry.ts` lit `agents/_registry.json` via **l'API GitHub** (token+repo dans
  son `.env.local`) → l'agent apparaît **dès le push, sans git pull**. ✅ BTC visible
  dans /admin/agents section "Deployed from Aigent".
- **Page de réception construite par la commande `/agent-intake`** (commits
  `30fc908`/`dab7d2d`/`825c4cd`) : table `aigent_active_agents` + `aigent_agent_
  deployments` (audit), routes `intake/[slug]/{activate,deploy}`, états
  déployé→actif→versionné, canevas neutre, sécurité fail-closed. ⚠️ La migration
  `0036` n'est peut-être PAS appliquée sur la base TradeAgent (intake est fail-soft
  si la table manque — à vérifier avant de tester "Activer").

---

## LES COMMANDES SLASH (dans ~/.claude/commands/)

**Décision d'Adrien : 2 commandes + 1 câblage natif (PAS 3 commandes).**

1. **`/agent-intake`** ✅ CRÉÉE (`~/.claude/commands/agent-intake.md`) et **TESTÉE**
   (Adrien l'a lancée dans TradeAgent en worktree isolé → a produit la page de
   réception, mergée). Contrat : construire la page back-office de réception
   (afficher registre GitHub · Activer · Déployer-version), canevas neutre, zéro
   commercial, tout manuel. **Verdict : la commande MARCHE.**

2. **`/agent-demand`** ❌ PAS ENCORE CRÉÉE — **c'est la PROCHAINE tâche.** But :
   commande conversationnelle qui tient à jour un **`AGENTS-WANTED.md`** par repo,
   où un workspace déclare "je veux un agent qui fait X" quand Adrien en discute.
   Reco de design (Adrien à valider) : fichier PAR REPO (`AGENTS-WANTED.md` racine),
   Aigent les agrège. Conversationnel : Adrien décrit un besoin → ça s'écrit dans
   le fichier (type d'agent, ce qu'il doit faire, priorité, quand/pourquoi).

3. **`/agent-forge`** ❌ VOLONTAIREMENT PAS une commande. Adrien veut que ce soit
   **NATIF dans Aigent** : l'**Agent Builder doit LIRE les `AGENTS-WANTED.md`** des
   workspaces quand Adrien frame un nouvel agent (scan repo + demande). C'est du
   câblage produit côté Aigent (le builder scanne les demandes), à faire APRÈS
   `/agent-demand`.

---

## LA SUITE IMMÉDIATE (par ordre)

1. **Créer `/agent-demand`** (commande, `~/.claude/commands/agent-demand.md`) —
   la prochaine tâche. Puis Adrien la teste dans un workspace.
2. Ensuite : **câbler l'Agent Builder d'Aigent pour lire les `AGENTS-WANTED.md`**
   (natif, pas une commande).
3. Vérifier/appliquer la migration `0036` sur TradeAgent + tester le flow "Activer"
   un agent en vrai (BTC → actif dans la flotte).

## RESTE OUVERT (pas prioritaire, identifié)

- **Mode auto CONTINU H24** (sans clic) : manque toute la couche scheduler/worker
  (inexistante) + le shadow mode (types only). Gros projet. L'Auto-improve actuel
  couvre le "auto sur déclenchement".
- Redondances Overview R2/R6 restantes (mineures).
- Les "5 dimensions" du benchmark sont **cosmétiques** (le scoring ne les lit pas) —
  défaut UI à noter. La note benchmark (~93.7%) plafonne structurellement
  (accuracy jugée LLM + latence/coût) → viser 100% de benchmark n'a pas de sens ;
  100% de TESTS oui (atteint). Le release-gate ne demande que "pas de régression >2pts".

---

## RÈGLES DE TRAVAIL (rappel — CLAUDE.md global)

- Orchestrateur : workers en worktrees isolés (RULE 0 : workers = fichiers jamais
  git ; seul l'orchestrateur commit, direct sur `main`, zéro branche/PR). Fan-out
  parallèle sur fichiers DISJOINTS ; séquencer si collision (ex. layout.tsx).
- Gate verte AVANT tout commit. Preuve avant "fait" (browser + gate collée).
- Zéro `AskUserQuestion` (§3) : décide, annonce en 1 ligne, exécute.
- **Piège récurrent de la session** : `git add "chemin/[id]/..."` — les crochets
  cassent le glob zsh → TOUJOURS quoter les chemins avec `[...]`, sinon le commit
  avorte silencieusement (vérifier `git log` après commit).
- Clés API en clair = input normal (§7), jamais de sermon rotate/révoque.
- Appels API Anthropic supplémentaires = demander avant (§8). Les runs LLM
  (tests/improve/benchmark) coûtent → c'est Adrien qui les déclenche (ses clics).
