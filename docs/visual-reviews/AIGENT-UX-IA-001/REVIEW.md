# AIGENT-UX-IA-001 — navigation et Aperçu : revue

> Preuves de l'issue #93. Base : `main` @ `9da3823c`, qui porte la direction
> visuelle claire de #94. **Le langage visuel de #94 n'est pas retouché** —
> cette mission déplace de l'information, elle ne recolore rien.

## Ce qui a changé

Le menu exposait **onze surfaces**, dont Runtime, Qualification, Learning et
Livraison : des FONCTIONS présentées comme des produits séparés. « La
qualification de quoi ? » n'avait pas de réponse avant d'avoir cliqué. Elles
redeviennent des **facettes de l'objet** qu'elles concernent, et le menu tombe à
six entrées.

## Mapping de navigation — ancien → nouveau

| Entrée (avant) | Après | Où elle vit maintenant |
|---|---|---|
| Aperçu | **menu** | `/` |
| Runs | **menu** | `/runs` |
| Agents | **menu** | `/agents` |
| Projets | **menu** | `/projects` |
| Réglages | **menu** | `/settings` |
| — | **menu** (nouveau) | `/support` |
| Runtime | contexte | onglet de la fiche Agent → `/runtime` |
| Qualification | contexte | onglet de la fiche Agent → `/qualification/:id` |
| Learning | contexte | onglet de la fiche Agent → `/learning` |
| Livraison | contexte | onglet fiche Agent → `/delivery/:id` · onglet fiche Projet |
| Builder | contexte | onglet de la fiche Projet → `/builder/:id` |
| Actions | contexte | `/support` (même file, sous le nom cherché) |

**Six entrées exactement** : Aperçu · Agents · Projets · Runs · Support ·
Réglages.

## Routes conservées / redirigées

**Aucune redirection, aucune suppression.** Les onze routes répondent toujours :
un signet, un lien profond ou un lien contextuel continuent de fonctionner.
Retirer une entrée de menu ne doit jamais casser une URL que quelqu'un a gardée.

Le point technique qui rend cela possible : `navigation.ts` sépare désormais
deux rôles qu'une seule table confondait —

- **`NAVIGATION`** — le CATALOGUE des surfaces, complet. Vingt-et-un fichiers
  appellent `navEntry(href)` pour nommer leur page (`metadata.title`, titre de
  surface) ; en retirer une aurait cassé leur compilation.
- **`MAIN_NAVIGATION`** — les six `href` réellement rendus dans le rail.

`activeNavHref` rattache les surfaces hors menu à leur section (`HOME_SECTION`) :
ouvrir `/qualification/:id` allume « Agents », `/actions` allume « Support ».
Sans ce rattachement, le rail s'éteindrait entièrement sur ces routes et
l'opérateur ne saurait plus où il se trouve.

## Sous-navigation

`ContextTabs` généralise `runtime/tab-bar.tsx` — des LIENS, pas un état local :
le deep link marche, le rechargement marche, le bouton retour marche, et les
fiches restent des Server Components.

**Chaque onglet mène à une route qui existe déjà.** Aucun écran n'est
réimplémenté : « Qualification » sur une fiche Agent pointe vers
`/qualification/:id`, qui porte déjà tout le contenu. C'est ce qui permet de
passer de onze entrées à six **sans perdre une capacité**.

Les boutons « Qualification » et « Livraison » de l'en-tête Agent ont été
retirés : ils devenaient deux chemins vers la même route à 40 px d'écart.

## Aperçu

| Élément | Avant | Après |
|---|---|---|
| Mesures | 6 | **7** (+ Learning) |
| Projets | liste de 5 lignes | **5 cartes**, en tête de zone |
| Graphique | `h-48`, trait 2px | **`h-36`** (160 px mesurés), trait **1.5px** |
| En-tête | pas de gros header | inchangé |

**Le KPI Learning est mesuré, pas simulé.** `readyForManualTest` était DÉJÀ
calculé par `getDashboardOverview` et n'était affiché nulle part : ce sont les
versions livrées qui attendent une revue humaine. Il porte la discipline du
produit — `null` quand la lecture échoue, jamais un zéro de confort.

**Ce qui a été écarté, et pourquoi.** Les propositions d'amélioration
(`improvement_decision`) auraient été l'autre candidat pour « Learning », mais
l'Aperçu ne les lit pas : elles demandent un scan borné à trente copilots que
seule `/actions` paie. Les afficher aurait exigé une lecture supplémentaire —
hors périmètre d'une mission qui interdit de toucher au backend.

**Les projets passent devant.** Ils étaient sous le pli ; l'issue en fait des
cartes premium, or une carte qu'on ne voit pas ne vaut pas mieux qu'une ligne.
Ils ouvrent la zone en pleine largeur ; flux d'exécution et signaux — deux
lectures denses et courtes — se partagent la rangée dessous.

**Pourquoi une carte ici alors que #94 les a chassées du bandeau.** #94 interdit
la carte comme EMBALLAGE d'un chiffre nu — six boîtes pour six nombres. Une carte
de projet porte un OBJET composite qu'on peut ouvrir : identité, activité,
progression, alerte. C'est le critère que l'issue pose elle-même.

## Données réellement utilisées par chaque graphique

| Bloc | Source | Nature |
|---|---|---|
| Courbe d'activité | `buildHourlyBuckets(overview.windowRuns)` | **LIVE** — runs de la fenêtre 24 h |
| Bandeau (7 mesures) | `overview.kpis` | **LIVE** — `null` propagé quand non mesuré |
| Cartes projet | `overview.projects` | **LIVE** — `runsLast24h`, `passRate`, `activeCount` |
| Flux d'exécution | `buildNamedRuns(overview.windowRuns)` | **LIVE** |
| Événements | `overview.actionItems` | **LIVE** |

**Aucun graphique secondaire n'a été ajouté.** L'issue les autorise « seulement
si les données réelles existent » : latence, erreurs, coût par modèle et
répartition provider ne sont pas dans le contrat de l'Aperçu. Les inventer aurait
violé la règle « aucune donnée simulée ».

**Aucune iframe** — vérifié au rendu : `document.querySelectorAll('iframe')` = 0.

## Une régression trouvée et corrigée

J'ai d'abord câblé `logoUrl`/`imageUrl` sur les cartes, comme le demande
« logo réel ou monogramme propre ». Résultat mesuré : **trois 404** —
`/projects/tradeagent/logo.svg`, `/projects/aigent-builder/cover.png`,
`/projects/bull21/cover.png`.

`public/projects/` **n'existe pas** : ces chemins sont déclarés en base sans
fichier en face, et aucun autre écran ne les consommait — ce qui explique que le
trou n'ait jamais été visible. Un logo cassé dégrade plus qu'un monogramme ne
manque : on rend le monogramme jusqu'à ce que les assets existent. Les champs
restent dans le contrat, prêts à être rebranchés.

## Tests et console navigateur

- **17 gates statiques vertes**
- `typecheck` vert · `lint:fast` vert
- **189 fichiers, 2363 tests, 0 échec** · `build` vert
- **0 erreur console** et **0 requête 404** aux trois viewports
- **0 débordement horizontal** à 1440×900, 1280×800, 375×812
- **Contraste : 114 éléments mesurés au fond composé, 0 échec WCAG AA**
- **0 scroller interne** (seul le scroller de page subsiste)

## Limites restantes

- **La fiche Agent n'est pas scindée.** L'issue liste « Vue générale » et
  « Configuration » comme deux onglets ; la fiche porte les deux dans un seul
  écran, la configuration étant une section de la vue. Les distinguer dans la
  barre promettrait deux écrans là où il y en a un — un onglet est rendu tant que
  la fiche n'est pas réellement scindée.
- **Les onglets ne filtrent pas encore.** `/runs?copilot=…`,
  `/agents?project=…` et `/runs?project=…` transportent le paramètre, mais les
  écrans cibles ne le lisent pas : ils rendent la vue complète. Le lien est
  honnête sur sa destination, pas encore sur son filtre — c'est un travail
  d'écran, hors du périmètre « navigation » de cette mission.
- **`/support` est un alias de la file d'action**, pas une surface d'incidents
  distincte. Elle réutilise la même lecture et le même composant : la matière
  existait, le NOM manquait. Une vraie surface d'incidents demanderait une source
  que le produit n'a pas.
- **La barre d'onglets défile horizontalement à 375 px.** C'est une navigation,
  pas un bloc de dashboard — même compromis que `/runtime` tenait déjà. Les
  replier sur deux lignes ferait sauter la hauteur d'en-tête d'un objet à
  l'autre.
- **Aucun graphique secondaire.** Voir plus haut : les données n'existent pas
  dans le contrat de l'Aperçu.
