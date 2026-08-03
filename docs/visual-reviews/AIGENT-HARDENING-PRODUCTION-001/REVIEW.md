# Revue runtime & visuelle — AIGENT-HARDENING-PRODUCTION-001

- **Date** : 2026-08-03
- **Branche** : `mission/aigent-hardening-production-001`
- **HEAD** : `5adf0949`
- **Cible** : `http://127.0.0.1:3987` (stack déjà en cours, non redémarrée)
- **Outil** : Playwright (Chromium headless, contexte **isolé**, aucun profil Chrome existant)
- **Périmètre** : validation seule. Aucun fichier source modifié.

> Note d'exécution : le profil partagé du MCP Playwright (`hearst-pro`) était
> verrouillé par un autre chantier. La revue a été conduite avec `playwright`
> local en contexte isolé — jamais le profil quotidien d'Adrien. Navigateur
> fermé en fin de chaque passe.

## Verdict

**PARTIAL** — le durcissement d'authentification est intègre et vérifié sur
toute la surface testée ; un écart d'accessibilité (§7) préexistant subsiste sur
la navigation.

---

## 1. Accès refusé sans authentification — PASSÉ

Sans cookie de session, les six pages redirigent vers `/sign-in` avec le
paramètre de retour exact.

| Page | HTTP | Destination finale | Verdict |
|---|---|---|---|
| `/` | 302 | `/sign-in?next=%2F` | PASSÉ |
| `/agents` | 302 | `/sign-in?next=%2Fagents` | PASSÉ |
| `/runs` | 302 | `/sign-in?next=%2Fruns` | PASSÉ |
| `/projects` | 302 | `/sign-in?next=%2Fprojects` | PASSÉ |
| `/qualification` | 302 | `/sign-in?next=%2Fqualification` | PASSÉ |
| `/delivery` | 302 | `/sign-in?next=%2Fdelivery` | PASSÉ |

**Aucune fuite de contenu cockpit avant la redirection.** Le corps de la réponse
302 ne contient que la cible de redirection (17 à 23 octets) — ni nom de projet,
ni roster, ni coût.

**Routes API sans session** — 401 JSON, corps `{"ok":false,"error":"Authentication required"}` :
`/api/agent-ops/copilots`, `/api/agent-ops/dashboard-overview`, `/api/agent-ops/runs`.

### Réserve — le shell est dans le DOM de `/sign-in`

Le HTML servi non authentifié contient la coque applicative (libellés de
navigation « Aperçu / Agents / Projets / Runs », bloc « Session locale ·
Opérateur Aigent », squelette « Aperçu … Chargement »).

Ce sont des **libellés statiques**, pas des données. Le texte visible complet a
été extrait et audité : **aucune donnée métier réelle** (aucun nom de projet,
aucun compteur, aucun coût). Visuellement, le modal de connexion couvre
intégralement la coque (cf. `sign-in-1440.png`). L'occurrence de `$` détectée au
scan initial est un **faux positif** : ce sont les marqueurs de streaming
Suspense de React (`<!--$-->`), pas un montant.

Non bloquant. Signalé pour décision : afficher `/sign-in` hors de la coque
serait plus net.

## 2. Surface `/sign-in` — PASSÉ

| Contrôle doctrine | Constat | Verdict |
|---|---|---|
| Libellé réel (§7) | `<label for>` → « Mot de passe opérateur ». **Aucun placeholder** utilisé comme substitut | PASSÉ |
| Anneau de focus (§7) | `outline: 2px solid` cuivre, contraste réel, visible en capture | PASSÉ |
| Mobile 390×844 (§5) | `scrollWidth == clientWidth == 390` → **aucun débordement horizontal** | PASSÉ |
| Cibles tactiles (§7) | champ et bouton : **44 px** de haut en contexte tactile | PASSÉ |
| État d'erreur (§6) | « Mot de passe incorrect. » — lisible, explicite, non technique | PASSÉ |
| Région vivante (§7) | erreur portée par `aria-live="assertive"` | PASSÉ |
| Liaison champ/erreur | `aria-invalid="true"` + `aria-describedby` | PASSÉ |
| Structure sémantique (§7) | un seul `<h1>` (« Connexion »), `<title>` « Connexion · Aigent » | PASSÉ |
| `disabled` explicite (§7) | bouton désactivé tant que le champ est vide | PASSÉ |

Le mot de passe invalide a été **réellement soumis** : l'API répond 401 et l'UI
rend l'état d'erreur sans divulguer de détail technique.

## 3. Accès normal avec authentification — PASSÉ

Session frappée via le **formulaire** `/sign-in?next=%2Fagents` (pas par appel
API direct), avec `AMC_ADMIN_PASSWORD` lu depuis `.env.local` et injecté par
variable d'environnement — **sa valeur n'apparaît nulle part** dans ce rapport,
les captures ou les journaux.

- Redirection après login : `→ http://127.0.0.1:3987/agents` — **le `next=` est honoré**.
- Cookie de session : `amc_session`, `httpOnly=true`, `sameSite=Lax`.
  (`secure=false` attendu en dev HTTP local.)
- `/`, `/agents`, `/runs` rendues en 1440×900 et 390×844.
- **Aucun débordement horizontal** sur aucune page, aux deux points de rupture.

**Aucun message technique rendu.** Balayage du texte visible de chaque page
contre : `PostgREST`, noms de tables (`runtime_telemetry_events`,
`copilot_versions`), variables d'environnement (`AMC_*`, `SUPABASE_*`,
`LANGGRAPH_*`, `DATABASE_URL`), traces de pile (`at Object.`, `at async`,
`TypeError`, `Unhandled`), `SQLSTATE`, `ECONNREFUSED` → **aucune occurrence**.

Les états de donnée respectent §6 : « 5 runs mesurés », « 2 indisponible(s) »,
« 5 mesuré(s) » — une absence est dite absente, jamais coercée en `0`.

## 4. Console — PASSÉ

**Aucune erreur critique** sur les pages authentifiées : ni exception non gérée,
ni échec de chargement de ressource, ni erreur d'hydratation React.

Seule erreur console de toute la session : le `401` du test délibéré de mot de
passe invalide sur `/sign-in` — c'est le comportement attendu, pas un défaut.

## 5. Écart avec `DESIGN_DOCTRINE.md`

### ÉCHOUÉ — §7 : `aria-current` absent de la navigation principale

La doctrine §7 est explicite : « **`aria-current`** sur la navigation :
"vous êtes ici" ne peut pas être uniquement visuel. »

Relevé au runtime sur les trois pages :

| Page | Entrée active | `data-current` | `aria-current` |
|---|---|---|---|
| `/` | Aperçu | `true` | **ABSENT** |
| `/agents` | Agents | `true` | **ABSENT** |
| `/runs` | Runs | `true` | **ABSENT** |

Les six entrées (`Aperçu`, `Agents`, `Projets`, `Runs`, `Support`, `Réglages`)
sont dépourvues d'`aria-current` sur toutes les pages testées.

**Cause** : `src/components/ui/sidebar.tsx` — `SidebarItem` reçoit bien
`current` depuis `src/components/app-shell.tsx:116`, mais ne le projette qu'en
`data-current` (crochet de style, lignes 113 et 122). Aucun `aria-current` n'est
émis. La surface courante n'est donc portée **que visuellement**, invisible à un
lecteur d'écran.

**Portée** : préexistant, **hors du périmètre livré par cette mission**
(l'authentification). Le repository sait poser `aria-current` correctement
ailleurs — `context-tabs.tsx:68`, `runtime/tab-bar.tsx:33`, `runs/run-list.tsx:62`.
Correctif d'une ligne dans le kit UI, à traiter en mission dédiée.

### Conforme par ailleurs

- §2 autorité `--aig-*` : gravité déclinée par **assombrissement d'un accent
  cuivre unique** (Actifs → Dégradés → Signal critique), jamais par changement de
  teinte. Une seule autorité de statut par écran.
- §4 direction visuelle : sidebar noire, body clair, cuivre en accent limité.
- §4 KPI plats : un chiffre, un libellé, un état. Aucune jauge décorative,
  aucun dégradé, **aucun mini-graphique inline** dans une carte ou une table.
- §5 responsive : aucune information d'état masquée en 390 px.
- §10 aucune valeur inventée à l'écran.

## 6. Captures produites

Toutes prises à `HEAD 5adf0949`, dans ce dossier :

| Fichier | Contenu |
|---|---|
| `sign-in-1440.png` | `/sign-in` desktop, champ au focus (anneau cuivre) |
| `sign-in-390.png` | `/sign-in` mobile 390×844, sans débordement |
| `sign-in-focus-1440.png` | état de focus clavier |
| `sign-in-error-1440.png` | mot de passe invalide — erreur explicite |
| `cockpit-1440.png` / `cockpit-390.png` | `/` authentifiée |
| `agents-1440.png` / `agents-390.png` | `/agents` authentifiée |
| `runs-1440.png` / `runs-390.png` | `/runs` authentifiée |

## 7. Ce que cette revue ne prouve pas

- Le rendu n'a été observé que sur **Chromium**, aux deux seuls points de
  rupture demandés (1440×900, 390×844).
- Les contrastes ont été constatés à l'œil sur capture, **non mesurés** au ratio
  WCAG.
- Aucun test de lecteur d'écran réel n'a été mené : les constats
  d'accessibilité portent sur les attributs du DOM.
- `/projects`, `/qualification`, `/delivery` ont été vérifiées **en redirection
  seulement**, pas en rendu authentifié.
- Les « 11 pages » censées ne plus rendre d'erreur interne n'ont été vérifiées
  que pour les trois pages capturées plus les six testées en redirection.

---

# Complément de validation navigateur — 2026-08-03

- **HEAD au moment de cette passe** : `3fb8e20d`
- **Cible** : `http://127.0.0.1:3987` (stack déjà en cours — **ni redémarrée, ni tuée**)
- **Outil** : Playwright, Chromium, **contexte isolé** (aucun profil Chrome existant)
- **Périmètre** : validation seule. **Aucun fichier source modifié.**
- **Session** : frappée via le **vrai formulaire** `/sign-in` (pas d'appel API direct).
  `AMC_ADMIN_PASSWORD` lu depuis `.env.local` et injecté **par variable
  d'environnement** ; sa valeur n'apparaît ni ici, ni dans une capture, ni dans
  une ligne de commande.

Cette section **complète** la revue ci-dessus ; elle n'en retire rien. Elle lève
deux réserves du §7 précédent : l'écart `aria-current` (§5, désormais corrigé et
vérifié au runtime) et les pages jamais ouvertes en rendu authentifié.

## 8. `aria-current` réellement servi — PASSÉ

Le correctif de `src/components/ui/sidebar.tsx` est **constaté dans le DOM
servi**, pas seulement dans la source. Un test unitaire garde le source mais ne
rend rien : la preuve ci-dessous est un relevé runtime.

| Page | Entrée portant `aria-current` | Valeur | Nb dans le rail rendu |
|---|---|---|---|
| `/` | Aperçu | `page` | **1** |
| `/agents` | Agents | `page` | **1** |
| `/runs` | Runs | `page` | **1** |

Extrait DOM réel (`/agents`) :

```html
<a href="/agents" aria-current="page" data-current="true"
   class="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 …">
```

Chaîne d'ascendance du seul porteur rendu, confirmant qu'il est bien dans le
rail de navigation :

```
A.flex.w-full < SPAN.relative < DIV.relative < DIV.flex.flex-col
  < DIV.flex.flex-1 < NAV.flex.h-full < DIV.dark.aig-dark
```

**Unicité** — vérifiée dans les deux sens :

- Les entrées **non courantes** n'ont **pas** l'attribut du tout :
  `hasAttribute('aria-current') === false`. Ce n'est donc pas un `aria-current="false"`
  déguisé — la distinction a été relevée explicitement.
- Une seule entrée du rail le porte à la fois, sur les trois pages.

**Suivi de la navigation** — par **clic réel** sur le rail (pas un `goto`), donc
navigation client Next :

| Instant | `nav [aria-current]` |
|---|---|
| Sur `/` | `Aperçu=page` |
| Après clic sur « Agents » → `/agents` | `Agents=page` |

L'attribut **se déplace** et ne se duplique pas.

### Deux observations qui pourraient faire croire à un doublon

1. **Dans le HTML brut** (`curl`), `/agents` et `/runs` montrent 3 occurrences de
   `aria-current="page"` et `/` en montre 2. Ce sont les rails **dupliqués du
   `Dialog` mobile** (coque `app-shell`), non montés à 1440 px. Dans l'arbre
   réellement rendu, il n'y en a **qu'un seul** (vérifié par
   `getBoundingClientRect` + `visibility`). Aucun doublon dans l'arbre
   d'accessibilité actif.
2. **Sur `/runs`**, un second `aria-current="true"` existe **hors du rail** : c'est
   la ligne sélectionnée de la liste de runs (`run-list.tsx`), un widget distinct
   avec la valeur `true` — sémantiquement correct, sans rapport avec le rail.

## 9. Les 8 pages restantes en session authentifiée

Toutes ouvertes **avec session**, en 1440×900. Les identifiants des pages à
paramètre sont **réels**, extraits des liens des pages de liste correspondantes
(aucun id inventé) : `proj-tradeagent`, `copilot-market-intelligence`.

| Page | HTTP | Fuite message interne | Erreur console critique | Débordement horizontal | Capture |
|---|---|---|---|---|---|
| `/projects` | 200 | non | non | non | `projects-auth-1440.png` |
| `/projects/proj-tradeagent` | 200 | non | non | non | `project-detail-auth-1440.png` |
| `/qualification` | 200 | non | non | non | `qualification-auth-1440.png` |
| `/qualification/copilot-market-intelligence` | 200 | non (réserve §9.2) | non | non | `qualification-detail-auth-1440.png` |
| `/delivery` | 200 | non | non | non | `delivery-auth-1440.png` |
| `/delivery/copilot-market-intelligence` | 200 | non | non | non | `delivery-detail-auth-1440.png` |
| `/builder` | 200 | non | non | non | `builder-auth-1440.png` |
| `/runtime` | 200 | non (réserve §9.3) | non | non | `runtime-auth-1440.png` |

### 9.1 Motifs balayés

Texte visible **et** HTML complet, sur chaque page, contre : `PostgREST` ·
`copilots` · `agent_runs` · `manifests` · `projects` · `tool_calls` ·
`benchmark_*` · `test_runs` · `promotion_*` · `advisory_*` · `AMC_*` ·
`SUPABASE_*` · `LANGGRAPH_*` · `OPENAI_*` · `GITHUB_TOKEN` · `at Object.` ·
`at async` · `.ts:<ligne>` · SQLSTATE (`PGRST###`, `22P02`, `23505`, `42P01`,
`42501`) · `Error:`.

**Aucune trace de pile, aucun SQLSTATE, aucun `Error:`, aucune mention de
PostgREST** sur aucune des 8 pages.

Les correspondances brutes ont toutes été **arbitrées une par une** ; les
faux positifs :

- `projects` → l'attribut `href="/projects"` du rail de navigation.
- `copilots` (`/projects/proj-tradeagent`) → des **noms de fichiers du dépôt**
  affichés comme contenu légitime (`scripts/aigent/seed-partner-copilots.mjs`),
  pas un nom de table.
- `promotion_blocked` (`/runtime`) → un **libellé d'événement de cycle de vie**
  affiché comme donnée métier. Aucun token `promotion_<table>` n'apparaît.

### 9.2 Réserve — noms de tables internes dans une infobulle

`/qualification/[copilotId]` porte sur un bouton :

```
title="Exécuter chaque cas de la suite contre le candidat, avec un juge
       par cas, et persister test_runs + test_results."
```

`test_runs` / `test_results` sont de **vrais noms de tables internes**. Nuances
constatées : le texte est **absent du texte visible** (`inVisibleText === false`),
il ne vit que dans l'attribut `title` (donc exposé au survol et aux lecteurs
d'écran), et c'est une **infobulle rédigée en dur**
(`src/components/qualification/actions.ts:72`) — **pas une fuite d'erreur**.

Non bloquant : destinée à un opérateur, elle ne divulgue ni schéma exploitable
ni état d'erreur. Signalée pour décision de rédaction.

### 9.3 Réserve — noms de variables d'environnement affichés

Un balayage **élargi** a été relancé sur les 11 pages avec le motif générique
`[A-Z][A-Z0-9]{2,}(_[A-Z0-9]+)+` — le balayage initial ne cherchait que les
préfixes `AMC_` / `SUPABASE_` / `LANGGRAPH_` / `OPENAI_` et **serait passé à
côté**. Résultat, texte visible :

| Page | Jetons en texte visible |
|---|---|
| `/runtime` | `AIGENT_RUNTIME_TELEMETRY_TOKEN` |
| `/projects/proj-tradeagent` | `GITHUB_PUSH_ENABLED`, `LAST_REPORT` |
| les 9 autres | *(aucun)* |

Message rendu sur `/runtime` :

> « Runtime telemetry ingestion is not configured on Aigent
> (AIGENT_RUNTIME_TELEMETRY_TOKEN unset). POST /api/runtime-telemetry returns 503
> to any agent that tries. This says nothing about whether delivered agents are
> running — only that Aigent cannot currently receive their telemetry. »

Constats : ce sont des **noms** de variables, **jamais des valeurs** — aucun
secret n'est divulgué. Le message est un **diagnostic de configuration
délibéré** (`src/lib/agent-mission-control/telemetry-health.ts:91`), pas une
erreur non rattrapée ; il est même explicitement prudent sur ce qu'il ne prouve
pas, conformément à la doctrine de vérité des données.

Deux points signalés **pour décision**, non bloquants : ce message est **en
anglais** alors que toute l'interface est en français, et il nomme une variable
d'environnement dans une surface opérateur.

### 9.4 Console

`browser_console_messages` relevé page par page (console, `pageerror`,
`requestfailed`). **Aucune erreur critique** : ni exception non gérée, ni échec
de chargement de ressource, ni erreur d'hydratation React.

Seuls messages, sur toutes les pages — **bruit de dev connu** :

- `Download the React DevTools…` (`info`)
- `[HMR] connected` / `[Fast Refresh] rebuilding` (`log`)

## 10. Captures ajoutées par cette passe

`nav-aria-current-1440.png` · `projects-auth-1440.png` ·
`project-detail-auth-1440.png` · `qualification-auth-1440.png` ·
`qualification-detail-auth-1440.png` · `delivery-auth-1440.png` ·
`delivery-detail-auth-1440.png` · `builder-auth-1440.png` ·
`runtime-auth-1440.png`

## 11. Ce que cette passe ne prouve pas

- Chromium uniquement, **1440×900 uniquement** — les 8 pages n'ont **pas** été
  vérifiées en 390 px.
- Les contrastes n'ont **pas** été mesurés au ratio WCAG.
- Aucun lecteur d'écran réel : les constats portent sur les attributs du DOM.
- `aria-current` vérifié sur `/`, `/agents`, `/runs` — les autres surfaces
  n'ont pas d'entrée de rail dédiée.
- Une seule paire d'identifiants réels par page à paramètre : les autres jeux de
  données de ces pages n'ont pas été parcourus.
- Le balayage de fuites est **par motifs** : il prouve l'absence des motifs
  listés, pas l'absence de tout message interne concevable.

## Verdict de ce complément

**APPROVED** sur ce périmètre — `aria-current="page"` est réellement servi,
unique et suivant la navigation ; les 8 pages restantes rendent en 200 sans
trace de pile, sans SQLSTATE, sans fuite PostgREST et sans erreur console
critique. Deux réserves rédactionnelles non bloquantes sont signalées (§9.2,
§9.3).
