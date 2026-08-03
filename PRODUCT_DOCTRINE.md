# PRODUCT_DOCTRINE.md — ce qu'est Aigent

> **Autorité produit du repository.** Ce fichier dit ce qu'Aigent est, pour qui,
> et comment ses pièces s'articulent. Il ne contient aucun état volatil : ni
> compte d'agents, ni liste d'écrans, ni « ce qui marche aujourd'hui ». Cet état
> vit dans `docs/CURRENT_FUNCTIONAL_CHECKLIST.md`, et lui seul.
>
> — Invariants techniques → `AGENTS.md`
> — Méthode de travail → `CLAUDE.md`
> — Design des surfaces → `DESIGN_DOCTRINE.md`
> — État réel, daté, prouvé → `docs/CURRENT_FUNCTIONAL_CHECKLIST.md`

## 1. La phrase

**Aigent est le plan de contrôle où des agents LLM sont créés, qualifiés,
exécutés, livrés et observés — et le runtime gouverné qui les exécute.**

Aigent n'est pas le produit que touche l'utilisateur final. Les produits
**consommateurs** offrent l'expérience ; ils appellent Aigent pour exécuter un
agent, et Aigent garde la preuve de ce qui s'est passé.

## 2. Qui l'utilise

Un **opérateur** — la personne qui possède la flotte. Pas un marketplace, pas un
libre-service multi-tenant, pas un produit grand public. Le catalogue d'agents
est celui de son propriétaire.

Deux autres appelants existent, et ce sont des **machines**, pas des humains :

- un **produit consommateur**, qui lit le catalogue et demande des exécutions ;
- une **automatisation d'Aigent**, qui pilote le cycle de vie.

Chacun a son identité et sa frontière. Aucun ne se confond avec l'opérateur.

## 3. Décision d'architecture runtime — une seule autorité

> **Aigent est le control plane ET le runtime gouverné canonique.**
> **Les produits consommateurs appellent le runtime d'Aigent.**

C'est la décision qui tranche, et elle remplace toute lecture antérieure.

Historiquement, deux architectures ont coexisté dans ce repository : un
**artefact autonome** poussé chez le consommateur, qui aurait exécuté l'agent
lui-même et renvoyé de la télémétrie ; et un **runtime hébergé**, où le
consommateur appelle Aigent. Les deux ont été construits partiellement. Aucune
n'était complète. Elles se contredisaient — la première suppose qu'Aigent n'est
pas un hôte d'exécution, la seconde qu'il l'est.

Maintenir deux architectures contradictoires coûte plus cher que d'en choisir
une, et produit surtout une qualification qui ne prouve rien : ce qui est testé
et ce qui est livré ne sont pas le même objet.

**Conséquences directes, et elles sont normatives :**

- Le chemin d'exécution qui fait autorité est l'**API runtime d'Aigent**. C'est
  lui qui monte les vrais outils, applique les vraies gardes, tient le
  human-in-the-loop et persiste le run.
- Un agent **qualifié** et un agent **exécuté** sont désormais le **même objet**.
  La qualification a donc une valeur probante ; c'était le défaut central de
  l'architecture précédente.
- La télémétrie de retour depuis un artefact autonome n'est **plus le mécanisme
  d'observation principal**. Un run exécuté par Aigent est observé nativement,
  parce qu'il a eu lieu chez Aigent.
- **L'export autonome reste une capacité future**, pas l'autorité actuelle. Le
  code qui la prépare peut vivre, à condition d'être déclaré comme tel dans la
  checklist et de ne jamais être présenté comme le chemin de production.

Cette décision est **révisable**, mais seulement par une nouvelle mission de
gouvernance. Elle ne se contourne pas au fil d'une mission de code.

## 4. Séparation des plans

```
┌──────────────────────── AIGENT ───────────────────────┐
│                                                       │
│  CONTROL PLANE            RUNTIME GOUVERNÉ            │
│  authoring · qualification   exécution · outils       │
│  release · promotion         gardes · HITL · preuve   │
│                                                       │
└───────────────────────────┬───────────────────────────┘
                            │  API runtime (jeton propre)
                            ▼
                 ┌──────────────────────┐
                 │ PRODUIT CONSOMMATEUR │
                 │ expérience · données │
                 └──────────────────────┘
```

**Control plane** — décide ce qui existe, ce qui est prouvé, ce qui a le droit de
tourner. Il ne s'exécute pas lui-même.

**Runtime gouverné** — exécute, et seulement ce que le control plane a autorisé.
Il n'invente aucune permission.

**Produit consommateur** — possède l'utilisateur, l'interface et les données
métier. Il ne possède ni l'identité de l'agent, ni son cycle de vie, ni sa
preuve.

## 5. La boucle

```
create → qualify → execute → observe → improve
   ↑                                       │
   └───────────────────────────────────────┘
```

1. **Create** — un opérateur décrit un agent en langage naturel ; l'architecte
   produit un **manifeste structuré** (prompt, outils, routes, actions
   interdites, politique de confirmation, plafond de coût). Pas de la prose.
2. **Qualify** — tests, benchmarks, shadow, replay, release gate. Un agent
   devient actif parce qu'un run réel l'a prouvé, jamais parce qu'on a écrit
   « actif ».
3. **Execute** — le runtime gouverné exécute l'agent, avec ses outils réels et
   ses gardes réelles, à la demande d'un produit consommateur ou d'un opérateur.
4. **Observe** — le run est persisté avec sa provenance : ce qui a tourné, avec
   quel modèle, à quel coût, avec quel résultat. Une valeur non mesurée reste
   absente ; elle ne devient pas zéro.
5. **Improve** — Aigent lit cet historique et propose une **V2 gouvernée** :
   analyser → proposer → matérialiser un brouillon → comparer → **décision
   humaine**. Une V2 ne s'auto-promeut jamais.

## 6. Ce qui appartient à Aigent, ce qui appartient au consommateur

| Aigent | Produit consommateur |
|---|---|
| l'identité de l'agent et sa version | l'utilisateur final et son expérience |
| le manifeste : outils, gardes, plafonds | les données métier |
| la preuve : tests, benchmarks, gates | la décision d'appeler un agent, et quand |
| l'exécution gouvernée et sa trace | l'affichage et l'usage du résultat |
| la promotion et le rollback | son propre cycle de déploiement |

**Aigent ne lit jamais l'état interne d'un consommateur.** Ce qu'il ne peut pas
observer, il le déclare inconnu — jamais faux, jamais zéro, jamais supposé.

## 7. Ce qu'Aigent n'est pas

- **Pas un produit de chat pour utilisateur final.**
- **Pas un marketplace.** Le catalogue est la flotte de son propriétaire.
- **Pas un mock.** Il n'existe aucun chemin fixture pour l'authoring ni pour un
  run de production : sans backend et sans credentials, ces chemins échouent
  franchement plutôt que d'inventer une réponse.
- **Pas un hôte d'exécution pour du code consommateur.** Aigent exécute des
  **agents qu'il gouverne**, pas du code arbitraire d'un tiers.

## 8. La règle qui gouverne toutes les autres

**Aigent existe pour dire ce qu'un agent fait réellement.** Toute décision de
conception se tranche par cette question : *est-ce que ça rend le système plus
capable de dire la vérité sur lui-même ?*

Une fonctionnalité qui produit un chiffre rassurant mais non mesuré est une
régression, même si elle passe toutes les gates. L'application concrète de cette
règle — `null` plutôt que `0`, absence déclarée plutôt que défaut fabriqué — est
un **invariant technique** et vit dans `AGENTS.md`.
