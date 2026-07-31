# Learning Runtime & pont Obsidian — le contrat

> Document propriétaire de **deux contrats d'intégration** introduits le
> 2026-08-01 par la mission AIGENT-SUPERVISION-LEARNING-001 : le client du futur
> moteur H-Supervised, et le pont vers Obsidian.
>
> Il décrit ce qui est CÂBLÉ. L'état produit (branché / partiel / absent) vit
> dans `docs/current-capabilities.md`, les manques dans `docs/known-gaps.md`.
> Ce n'est pas de la doctrine : les règles sont dans `CLAUDE.md` et `AGENTS.md`.

## 1. Pourquoi deux moteurs séparés, et une seule plateforme visible

Décision produit acquise à l'ouverture de la mission :

- **une seule plateforme web visible : Aigent.** H-Supervised ne gagne pas de
  frontend ; son front juridique actuel reste où il est, hors de ce dépôt.
- **H-Supervised devient un moteur `Supervision & Learning` séparé**, atteint
  par API depuis Aigent.
- **Obsidian reste le workspace humain éditable.** Ce n'est pas une base
  runtime : Aigent n'y lit rien et n'y écrit rien.
- **LangGraph reste l'unique runtime produit.** Rien ici ne le remplace.

Conséquence d'architecture : Aigent ne dépend NI du Supabase de H-Supervised, NI
de son front. Le seul couplage est un client HTTP typé, server-only, en lecture
seule.

## 2. Learning Runtime — `src/lib/agent-mission-control/learning-runtime.ts`

### Configuration

| Variable | Rôle |
|---|---|
| `AIGENT_LEARNING_RUNTIME_URL` | Base du moteur. Absente ⇒ `not_configured`. |
| `AIGENT_LEARNING_RUNTIME_TOKEN` | Jeton dédié, **server-only**. |

Le jeton est propre à cette surface : il n'est jamais partagé avec `AMC_API_KEY`,
`AIGENT_RUNTIME_TELEMETRY_TOKEN` ni `AIGENT_RUNTIME_API_TOKEN` — la règle des
trois frontières de confiance d'`AGENTS.md` s'étend ici à une quatrième, sortante
celle-là.

### Les quatre états, et ce qu'ils veulent dire

```
not_configured  →  aucune URL. AUCUN appel réseau n'est tenté.
unavailable     →  appel tenté, échoué : timeout, réseau, ou HTTP non-2xx.
                   La raison est attribuée (les trois cas sont distingués).
partial         →  réponse 2xx mais payload incomplet ou hors-schéma.
live            →  réponse 2xx complète, capacités réelles.
```

Règles tenues, et testées :

- **une absence de configuration n'est pas une panne**, et une panne n'est
  jamais transformée en liste vide ;
- `capabilities` vaut `null` tant que rien ne l'a mesuré — **jamais `[]`**, qui
  se lirait « le moteur n'a aucune capacité » ;
- le **jeton n'apparaît nulle part** : ni dans `endpoint`, ni dans `detail`, ni
  dans un log ;
- timeout strict et borné ; le payload distant est validé par Zod, un schéma
  cassé donne `partial` et non une exception.

### Ce que le contrat NE fait pas

Aucune écriture vers H-Supervised — pas de `POST`, `PUT`, `PATCH` ni `DELETE`.
Cette mission n'expose que `health` et `capabilities`. Datasets, évaluations par
lot, jobs d'entraînement et registre de modèles viendront **derrière ce même
contrat**, sans toucher au shell ni créer une seconde identité d'agent.

## 3. Pont Obsidian — `src/lib/agent-mission-control/obsidian-bridge.ts`

### Configuration

| Variable | Rôle |
|---|---|
| `AIGENT_OBSIDIAN_VAULT` | **Nom** du vault (pas un chemin). Absent ⇒ `not_configured`. |
| `AIGENT_OBSIDIAN_CANVAS_PATH` | Chemin relatif au vault du Canvas de supervision. |

Aucun chemin absolu machine dans le code. Le nom de vault n'est pas un secret.

### Les URI produites

D'après <https://obsidian.md/help/uri> :

```
obsidian://open?vault=<vault>&file=<chemin relatif>
obsidian://new?vault=<vault>&file=<chemin>&content=<corps>&append=true
obsidian://search?vault=<vault>&query=<requête>
```

Trois décisions à connaître :

1. **`file`, jamais `name`** en création — `name` dépose la note dans un « default
   location » qui est une préférence utilisateur invisible pour nous.
2. **`append=true`, jamais `overwrite`** — écraser détruirait une note écrite par
   l'opérateur, qu'Aigent n'a pas produite.
3. **Le Canvas n'est pas une action à part.** Un `.canvas` est un fichier du
   vault (format JSON Canvas), donc on l'ouvre avec `open`. Inventer
   `obsidian://canvas` produirait une URI silencieusement ignorée. Même
   conclusion pour les Bases. **Aucun plugin communautaire n'est requis.**

### Ce qui ne peut pas entrer dans une URI

Le contenu est **filtré avant encodage** — l'ordre compte : `sk-abc`
percent-encodé ne ressemblerait plus à une clé. Le filtre **refuse**, il ne
tronque pas : une troncature silencieuse cacherait qu'un secret a failli fuiter.
Il couvre les formes de clés des grands fournisseurs, les blocs `PRIVATE KEY`,
les en-têtes `Bearer`, les JWT par forme, les assignations `password:` /
`api_key=`, les interpolations `${VAR}` et `process.env.X`, les noms de jetons
Aigent, plus deux détecteurs d'entropie.

Un refus **nomme la règle, jamais le contenu** : le message dit
`provider-api-key`, pas la clé — sinon l'erreur ré-introduirait la fuite.

Le contenu d'une note est donc volontairement pauvre : **identifiants stables,
statut, synthèse bornée, URLs de preuve**. Jamais un prompt, jamais un payload
d'outil, jamais un `output_summary` brut. Le reste vit dans Aigent et se rejoint
par lien — recopier l'analyse dans le vault en ferait une seconde source de
vérité qui dérive.

L'URI totale est bornée à **1800 caractères** (et non 2000) : la marge couvre le
re-wrapping par le handler d'OS et le coût du percent-encodage d'un caractère
accentué. Les OS tronquent **silencieusement**, et une note coupée au milieu d'un
échappement `%` corromprait le vault.

### Aucun accès disque

Ce module ne construit que des chaînes. Il **n'ouvre aucun vault**, ne lit ni
n'écrit aucun fichier, et le serveur n'accède jamais au disque du vault. Un
bouton ne s'affiche que si son URI est constructible : le type de retour
(`{ ok: true; uri } | { ok: false; reason; detail }`) force la vérification
avant d'atteindre `.uri`, donc aucun `href` ne peut recevoir un échec. Il n'y a
ni bouton grisé, ni `'#'`.

### Templates

Quatre templates versionnés dans `docs/templates/obsidian/` : `agent-review`,
`run-incident`, `evaluation-decision`, `improvement-proposal`. Frontmatter YAML,
identifiants stables, liens vers les routes Aigent, variables `{{nom}}`. Aucun
champ n'est prévu pour recevoir un prompt brut ou un payload complet.

## 4. Ce que ces contrats ne prouvent pas

- **Obsidian n'est pas installé** sur la machine de développement : la bonne
  formation des URI est prouvée (tests + relevé DOM sur un vault au nom accentué
  et espacé), leur ouverture réelle ne l'est pas.
- **Aucun moteur H-Supervised ne répond** aujourd'hui : `live` et `partial` ne
  sont prouvés que par les tests unitaires, `unavailable` l'a été contre un port
  fermé.
- **Aucune gate ne vérifie ces deux contrats en continu.** Ils tiennent par
  leurs tests unitaires et par la discipline, comme le reste des invariants de
  vérité des données (`AGENTS.md` § Vérité des données).
