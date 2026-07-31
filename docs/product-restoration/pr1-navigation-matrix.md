# PR 1 — matrice route → navigation → état

> **Nature** : observation datée du 2026-07-31, branche `mission/surface-shell`,
> base `4eaf9c7`. Ce n'est **pas** de la doctrine (`CLAUDE.md` §1). En cas de
> contradiction avec le code, le code a raison et c'est ce document qu'on corrige.
>
> **Ce que PR 1 a fait** : débloqué les dix surfaces du plan de contrôle. Les
> routes existent, sont navigables, et **disent honnêtement qu'elles ne lisent
> rien**. Aucune donnée n'a été branchée — c'était explicitement hors périmètre.
>
> **Ce que PR 1 a supprimé** : les cinq `<SidebarItem disabled>` de
> `app-shell.tsx`. C'étaient des `<button disabled>` qui nommaient une surface
> sans y mener. Ils ont été **supprimés, pas masqués**
> (cf. `feedback-supprimer-pas-cacher`) : le tableau `navigation` local, le type
> `NavEntry` à `href` optionnel, la branche de rendu `disabled` et le
> `SidebarFooter` « Écrans à venir désactivés » ont tous disparu du fichier.

---

## 1. La matrice

Dix entrées de navigation, dix routes, dans l'ordre imposé du parcours produit.
`wired` (colonne « données branchées ») est aussi un champ réel de
`src/components/navigation.ts` : le code porte la même vérité que ce tableau.

| Route | Item de nav | Page existe ? | Données branchées ? | État affiché | Rendue fonctionnelle par |
|---|---|---|---|---|---|
| `/` | **Aperçu** | ✅ oui (préexistante, non modifiée) | ✅ **oui** — 6 lectures PostgREST via `getDashboardOverview` | KPI, séries, roster, file d'action réels. Backend muet → `Unavailable reason="unread"`, jamais des zéros | *déjà fonctionnelle* |
| `/runs` | **Runs** | ✅ oui (créée) | ❌ non | `SurfacePlaceholder` — « surface nommée, pas encore construite » | PR 2 |
| `/agents` | **Agents** | ✅ oui (créée) | ❌ non | `SurfacePlaceholder` | PR 3 |
| `/projects` | **Projets** | ✅ oui (créée) | ❌ non | `SurfacePlaceholder` | PR 4 |
| `/builder` | **Builder** | ✅ oui (créée) | ❌ non | `SurfacePlaceholder` | PR 5 |
| `/qualification` | **Qualification** | ✅ oui (créée) | ❌ non | `SurfacePlaceholder` | PR 6 |
| `/delivery` | **Livraison** | ✅ oui (créée) | ❌ non | `SurfacePlaceholder` | PR 7 |
| `/runtime` | **Runtime** | ✅ oui (créée) | ❌ non | `SurfacePlaceholder` | PR 8 |
| `/actions` | **Actions** | ✅ oui (créée) | ❌ non | `SurfacePlaceholder` | PR 2 |
| `/settings` | **Réglages** | ✅ oui (créée) | ❌ non | `SurfacePlaceholder` | PR 8 |

### États transverses (hérités par toutes les routes ci-dessus)

| Fichier | Rôle | Créé / modifié en PR 1 |
|---|---|---|
| `src/app/loading.tsx` | Attente d'un rendu serveur, dans le shell | **modifié** — le libellé nommait « l'état de la flotte », faux sur neuf surfaces qui ne lisent rien. Devenu neutre : « Chargement de la surface… » |
| `src/app/error.tsx` | Exception pendant le RENDU (client compris) | **modifié** — « Le cockpit n'a pas pu s'afficher » → « Cet écran n'a pas pu s'afficher ». Hors shell délibérément : la panne peut venir du shell |
| `src/app/not-found.tsx` | Chemin inconnu | **créé** — **dans** le shell, pour que la navigation reste la sortie évidente. Aucun lien fabriqué, aucun `/admin` |

Les trois causes de « rien ne s'affiche » restent distinctes : **attente**,
**panne de rendu**, **route inexistante**. Une seule justifie de réessayer.

---

## 2. Les routes volontairement NON fonctionnelles — le cœur du livrable

**Neuf routes sur dix ne lisent rien.** C'est un choix, pas un oubli, et c'est le
point qui doit rester visible.

Chacune rend `SurfacePlaceholder`, qui affiche :

1. le **nom exact** de la surface — lu depuis `NAVIGATION`, donc impossible à
   faire diverger de l'entrée de nav qui y mène ;
2. **ce que la surface portera** une fois construite ;
3. un bloc `Unavailable reason="no-data"` dont le texte lève l'ambiguïté :
   *« Cette surface est nommée, pas encore construite. Aucune lecture n'a été
   tentée : ce que vous voyez n'est pas un état vide de la flotte, c'est
   l'absence d'écran. »* ;
4. la **PR qui la branchera**.

| Route | Ce qu'elle portera | Pourquoi elle ne le porte pas encore |
|---|---|---|
| `/runs` | Historique des exécutions : statut, latence, coût, outils appelés, trace | Branchement de données — hors périmètre PR 1 |
| `/agents` | Roster des copilotes, runtime, version de production, santé | idem |
| `/projects` | Projets consommateurs, dépôt cible, agents rattachés | idem |
| `/builder` | Conversation d'authoring : architecte, manifeste, matérialisation | idem — et surface **mutante**, donc à cadrer |
| `/qualification` | Tests, benchmarks, release gate, promotion de version | idem — surface mutante |
| `/delivery` | Poussées vers dépôts consommateurs, PR ouvertes, sandbox | idem — surface mutante, écriture GitHub à double verrou |
| `/runtime` | Santé du canal de télémétrie, événements des agents déployés | idem |
| `/actions` | File d'action complète, sans troncature | idem |
| `/settings` | Configuration, jetons, frontières de confiance | idem |

### Trois choses qu'aucune de ces pages ne fait

- **Aucun chiffre.** Pas un KPI, pas un compteur, pas un total.
- **Aucun graphique**, aucun squelette de cartes vides. Un placeholder qui
  esquisse des tuiles laisse croire qu'une lecture a eu lieu et a rendu zéro —
  c'est précisément le faux zéro que `AGENTS.md` § Vérité des données interdit.
- **Aucun appel réseau.** Ces pages sont statiques au build (`○` dans la sortie
  de `next build`), ce qui est en soi la preuve qu'elles ne lisent rien.

### Ce que PR 1 ne prouve pas

- **Qu'un écran s'affiche.** Aucun test navigateur n'existe dans ce repo
  (master-plan §5.5). `check`, `vitest` et `build` peuvent être verts sur un
  écran qui explose au premier rendu client — précédent daté du 26/07/2026.
  L'ouverture manuelle sur le port **3987** reste la seule preuve.
- **Que le zéro-scroll tient réellement.** Il est tenu par construction (chaîne
  `h-full` / `overflow-hidden` / `min-h-0` préservée sur chaque nouvelle page),
  pas par une mesure. `documentElement.scrollHeight === clientHeight` n'a été
  vérifié par aucun outil ici.
- **Que le tiroir de décision s'ouvre.** Il est câblé, non exercé.

---

## 3. Décisions tranchées en PR 1

### D-A · Langue : libellés en **français**, routes en **anglais**

L'existant mélangeait (`Cockpit`, `Projets`, `Livraisons`, `Télémétrie`). Tranché
et appliqué partout :

- **Libellés en français** — c'est la langue de tout le reste de l'interface
  (« File d'action », « Plan de contrôle », « Approbation », « Mission bloquée »).
  Passer la nav en anglais aurait créé une interface bilingue sur un seul écran.
- **Routes en anglais** — la table de correspondance F4 du master-plan fixe déjà
  `/agents/:id`, `/projects/:id`, `/projects/:id/builder`, et
  `dashboard-overview.ts` émet ces `href` aujourd'hui. Traduire les URL aurait
  cassé des cibles que d'autres PR consomment déjà.

Renommages appliqués : `Cockpit` → **Aperçu** (le mot « cockpit » désignait
l'écran, pas la surface ; `/actions` reprend maintenant sa colonne de décision),
`Livraisons` → **Livraison**, `Télémétrie` → **Runtime** (la surface porte le
runtime, dont la télémétrie n'est qu'une mesure), `Settings` → **Réglages**.

### D-B · `Actions` pointe sur `/actions`, une route à part entière

Envisagé : ne pas créer la route, puisque la file d'action vit déjà dans la
colonne de droite de `/`. **Rejeté** — l'entrée aurait alors été soit un bouton
inerte (ce qu'Adrien demande justement de supprimer), soit un `href="#"`
(interdit). Une troisième option — que l'entrée ouvre le tiroir de décision —
aurait fait d'un item de navigation un bouton déguisé, non partageable, mort en
deep link.

La route existe donc, et elle a une raison d'être propre : **la colonne de `/`
est tronquée** (`limit` par défaut à 6 dans `buildActionItems`). `/actions` est
la file **complète**, filtrable, adressable par URL. Elle sera branchée en PR 2.

### D-C · La file d'action sous 1280 px → tiroir `Dialog` à droite

`<aside>` était `hidden xl:block` : à **1280×800**, taille de contrôle
obligatoire, la valeur de décision de l'écran était **purement invisible**, sans
repli. Retenu :

- sous `xl`, la colonne passe dans un `Headless.Dialog` qui glisse depuis la
  **droite** — exactement la mécanique déjà en place pour la sidebar mobile,
  aucun composant nouveau, aucun kit externe ;
- le déclencheur est un `NavbarItem` du header, en `xl:hidden`, qui **n'apparaît
  que s'il y a réellement un `aside` à montrer** (`aside ? … : null`). Sur les
  neuf placeholders, qui n'en passent aucun, ni le bouton ni le tiroir n'existent
  dans le DOM ;
- **les deux tiroirs ne peuvent pas se marcher dessus** : celui de navigation est
  `lg:hidden` et vient de la gauche, celui de décision est `xl:hidden` et vient
  de la droite. Entre `lg` et `xl` — la bande où les deux pourraient coexister —
  seul celui de décision reste monté, et ils occupent des bords opposés.

### D-D · L'item courant est dérivé, plus jamais codé en dur

`current: true` était figé sur l'entrée « Cockpit ». Remplacé par
`activeNavHref(usePathname())`, dans `src/components/navigation.ts` :
le préfixe le **plus long** gagne, pour qu'un futur `/projects/:id/builder`
illumine « Projets » et non « Builder ». `/` est traité à part, sinon il
préfixerait tout et resterait courant partout. Conséquence : un **deep link**
direct vers `/runs` rend la page avec la bonne entrée active.

### D-E · Une source unique pour la carte des surfaces

`src/components/navigation.ts` porte les dix entrées : libellé, route, icône,
intention, `wired`. Le shell **et** les pages la lisent. Une page ne réécrit donc
jamais son propre titre, et ne peut pas diverger de l'entrée de nav qui y mène.
Le champ `wired` est la même affirmation que la colonne « données branchées » du
tableau §1 — quand une PR branche une surface, elle bascule le champ, et le code
cesse d'être en désaccord avec ce document.

---

## 4. Fichiers touchés

**Créés (12)**

- `src/components/navigation.ts` — carte des dix surfaces, `activeNavHref`, `navEntry`
- `src/components/surface-placeholder.tsx` — l'état « nommée, pas construite »
- `src/app/not-found.tsx`
- `src/app/{runs,agents,projects,builder,qualification,delivery,runtime,actions,settings}/page.tsx`

**Modifiés (3)**

- `src/components/app-shell.tsx` — dix vrais liens, `usePathname()`, tiroir de décision, `aside`/`aside`-trigger conditionnels
- `src/app/loading.tsx` — libellé neutre (hérité par neuf surfaces qui ne lisent rien)
- `src/app/error.tsx` — libellé neutre, tag de log `[aigent]`

**Volontairement non touchés**

- `src/components/ui/**` — kit Catalyst vendoré. `git diff --stat` **vide**,
  `check:catalyst-integrity` vert sur 27 empreintes SHA-256.
- `src/app/page.tsx` — l'aperçu et son contenu, hors périmètre.
- `src/lib/**`, `src/app/api/**`, `src/proxy.ts` — aucune logique métier touchée.

---

## 5. État du test de dette F4

`tests/unit/action-queue-hrefs.test.ts` porte un `it.fails` qui vérifie que
chaque `href` interne de la file d'action résout vers une route réelle.

**Il reste rouge-attendu, et c'est correct.** Les trois routes qui lui manquent
sont `/agents/:id`, `/projects/:id` et `/projects/:id/builder` — des routes de
**détail dynamique**, livrées par PR 3, 4 et 5. PR 1 a créé les routes de
**collection** `/agents` et `/projects`, qui ne les satisfont pas : le scanner du
test normalise `/agents/c-btc` en `/agents/:param`, qui n'existe pas.

Le marqueur `.fails` reste donc en place. Il s'auto-supprimera comme prévu :
le jour où PR 3/4/5 posent les routes de détail, vitest rapportera
« Expect test to fail » et forcera son retrait.

Suite complète : **1750 passés, 1 expected fail** — exactement la ligne de base
d'avant PR 1.
