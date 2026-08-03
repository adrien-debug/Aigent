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
