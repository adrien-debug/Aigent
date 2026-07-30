# Spec — interview-api-sentinel

**Statut : `specification`.** Aucun objet agent n'est écrit en base dans
cette passe. La matérialisation réelle est un chantier distinct, ultérieur,
potentiellement facturé (architect LLM) — soumis à l'accord explicite d'Adrien
(`CLAUDE.md` §3) le moment venu.

## 0. Identité

| Champ | Valeur |
|---|---|
| `slug` | `interview-api-sentinel` |
| `projectKey` attendu | `real-estate-agent` (repo `Hearst-Corporation/real-estate-agent`) |
| `runtime` | `langgraph` exclusivement |
| Statut | `specification` |

`projectKey`/`slug` réservés par documentation uniquement — pas d'écriture
base dans cette passe. Le `slug` est conservé même si la décision §1 ci-dessous
range cette mission comme sous-graph plutôt qu'agent top-level — c'est un
identifiant de composant, pas une promesse d'entrée roster indépendante.

## 1. Décision d'architecture — agent autonome vs sous-graph versionné

**Décision tranchée dans cette spec : `interview-api-sentinel` est un
sous-graph versionné de `valuation-agent`, pas un agent autonome au sens
roster (pas d'entrée top-level, pas de déclencheur propre).**

### 1.1 Justification

1. **Unique consommateur** — la sortie de cette mission (état d'entretien
   exploitable : complétude, champs manquants, incohérences détectées,
   session reprise ou non) n'a qu'un seul consommateur dans tout le roster :
   `valuation-agent`, au node `interview` de son graph (cf.
   `valuation-agent.spec.md` §4.1). Aucun autre agent (`prospection-market-agent`,
   `buyer-intelligence-agent`, `crm-next-best-action-agent`) ne lit ni ne
   déclenche cette mission. Un composant à un seul appelant, avec un contrat
   d'appel/retour strict, est structurellement un sous-graph du graph
   appelant, pas un pair du roster.
2. **Pas de déclencheur propre indépendant** — tous les événements
   déclencheurs de cette mission (§3) sont des sous-événements du cycle de
   vie d'un `valuation_request` : une session d'entretien n'existe que parce
   que `valuation-agent` l'a ouverte à son node `interview`. Il n'y a aucun
   scénario où `interview-api-sentinel` démarre de façon indépendante (pas de
   cron, pas de webhook externe, pas de déclenchement manuel opérateur
   séparé). L'absence de déclencheur propre est précisément le critère qui
   distingue un sous-graph d'un agent du roster dans ce cockpit (comparer à
   `prospection-market-agent` : cadence propre + déclenchement manuel propre,
   ou `buyer-intelligence-agent` : signal `buyer_signal` propre).
3. **Cycle de vie couplé** — une session d'entretien n'a de sens que dans le
   contexte d'une demande d'estimation en cours. Il n'y a pas de notion
   d'« entretien orphelin » qui survivrait à l'annulation du
   `valuation_request` parent. Un agent top-level du roster, lui, a un cycle
   de vie et une notion de succès/échec indépendants du run d'un autre agent.
4. **Coût d'un agent autonome non justifié ici** — faire de cette mission un
   agent roster indépendant ajouterait : sa propre entrée `projectKey`/slug
   top-level, son propre cycle de matérialisation/tests/promotion, son
   propre contrat d'appel inter-agent (au lieu d'un simple sous-graph
   invoqué), sans bénéfice fonctionnel — puisque personne d'autre ne
   l'invoque et qu'elle ne peut jamais s'exécuter seule. C'est de la
   complexité roster sans valeur roster.
5. **Ce que ça n'empêche pas** : le sous-graph reste **versionné** et
   **testable indépendamment** (suite de tests dédiée, §16) — le choix
   architectural n'est pas un choix de qualité au rabais, c'est un choix de
   granularité d'entrée roster. La distinction "sous-graph versionné" (pas
   "fonction inline non testée") est le point d'équilibre : rigueur de spec
   et de test identique à un agent top-level, sans fausse indépendance
   d'exécution.

### 1.2 Conséquence pour ce document

Cette spec documente le sous-graph avec le même niveau d'exigence qu'une
spec d'agent top-level (état, nodes, transitions, contrats, HITL, tests) —
seule la position dans l'architecture change (invoqué par `valuation-agent`
au node `interview`, jamais déclenché seul).

## 2. Objectif métier

Surveiller le bon déroulement d'une session d'entretien (collecte
structurée de données sur un bien, menée avec le mandant), détecter en
continu les incohérences et les champs manquants, gérer l'indisponibilité
d'un provider d'entretien (API/canal de collecte), reprendre proprement une
session interrompue, et produire un état d'entretien exploitable
directement par le node `validate_completeness` de `valuation-agent` — sans
jamais inventer une donnée non fournie par le mandant.

## 3. Utilisateurs / appelant

- **Appelant unique** : `valuation-agent`, node `interview` — invoque ce
  sous-graph avec le contexte du bien et reçoit en retour l'état
  d'entretien structuré.
- **Mandant** : répond aux questions de l'entretien (utilisateur final
  humain de la session, mais pas un appelant du graph au sens agentique).
- **Opérateur cockpit** : peut consulter l'état d'une session en cours/
  interrompue en cas d'anomalie signalée, mais n'est pas dans la boucle
  d'exécution normale (pas de HITL sur ce sous-graph, cf. §9).

## 4. Événements déclencheurs

- Invocation par `valuation-agent` au node `interview` (ouverture d'une
  nouvelle session, ou reprise d'une session existante marquée
  `interrupted`).
- Aucun déclencheur indépendant (cf. §1.1 point 2) — pas de cron, pas de
  webhook externe autonome.

## 5. État LangGraph — graph (sous-graph versionné)

```
interview_start
  → resume_or_init_session
  → ask_next_field
  → validate_field_response
  → detect_inconsistency
  → handle_provider_status
  → checkpoint_session
  → interview_complete_check
```

### 5.1 Nodes — rôle et contrat

| Node | Rôle | Note |
|---|---|---|
| `interview_start` | Reçoit l'invocation (contexte bien + `sessionId` si reprise) | Idempotent par `sessionId` |
| `resume_or_init_session` | Si `sessionId` existant `interrupted` → recharge l'état ; sinon crée une nouvelle session | Aucune donnée déjà collectée n'est redemandée au mandant |
| `ask_next_field` | Détermine et pose la prochaine question nécessaire | Ordre piloté par les champs manquants, pas une séquence figée |
| `validate_field_response` | Valide la réponse reçue (type, plausibilité, format) | Réponse invalide → reboucle sur `ask_next_field` pour clarification, ne force jamais une valeur |
| `detect_inconsistency` | Compare la réponse au contexte déjà connu (contradiction avec une réponse antérieure ou avec `collect_property_context` de `valuation-agent`) | Incohérence détectée → marquée explicitement dans l'état, jamais résolue silencieusement |
| `handle_provider_status` | Vérifie la disponibilité du provider d'entretien (canal API) à chaque tour | Indisponible → session marquée `interrupted`, checkpoint immédiat, jamais de question perdue |
| `checkpoint_session` | Persiste l'état courant (réponses collectées, position, incohérences) | Exécuté après chaque champ validé et à toute interruption |
| `interview_complete_check` | Évalue si tous les champs requis sont couverts | Incomplet → reboucle sur `ask_next_field` ; complet ou provider indisponible → retourne à l'appelant |

### 5.2 Transitions

- Nominal : `interview_start → resume_or_init_session → ask_next_field →
  validate_field_response → detect_inconsistency → checkpoint_session →
  interview_complete_check`, puis reboucle sur `ask_next_field` tant qu'il
  reste des champs requis (cf. §5.3).
- `validate_field_response` invalide → retour à `ask_next_field` (reformule/
  clarifie), sans passer par `checkpoint_session` (rien de nouveau à
  persister).
- `handle_provider_status` indisponible, à tout moment du tour → court-
  circuite vers `checkpoint_session` puis retourne à l'appelant avec statut
  `interrupted` (pas d'`interview_complete_check`, rien à évaluer).
- `interview_complete_check` complet → retourne à l'appelant avec statut
  `complete`.

### 5.3 Boucles

- **Boucle de collecte** : `ask_next_field → validate_field_response →
  detect_inconsistency → checkpoint_session → interview_complete_check →
  (ask_next_field)` jusqu'à couverture complète des champs requis ou
  interruption provider.
- **Boucle de clarification** : `ask_next_field → validate_field_response`
  bornée (nombre max de tentatives de clarification par champ, config) —
  au-delà, le champ est marqué `unresolved`, le sous-graph continue sur les
  champs suivants plutôt que de bloquer toute la session sur un seul champ.

### 5.4 Interruptions — au sens session, pas HITL

- Ce sous-graph n'a **pas** de point d'interruption HITL au sens
  `approval`/confirmation opérateur (cf. §9) — sa seule forme
  d'« interruption » est la **suspension de session** (`interrupted`) sur
  indisponibilité provider ou abandon mandant, avec **reprise garantie** :
  `resume_or_init_session` recharge exactement l'état persisté par le
  dernier `checkpoint_session`, aucune question déjà répondue n'est reposée.

## 6. Inputs typés

```ts
type InterviewSessionInput = {
  sessionId?: string;            // fourni si reprise d'une session interrompue
  valuationRunId: string;        // runId du valuation-agent appelant
  tenantId: string;
  propertyId: string;
  requiredFields: string[];      // champs déterminés manquants par validate_completeness
  knownContext: Record<string, string>; // ce qui est déjà connu, jamais redemandé
};
```

## 7. Outputs typés

```ts
type InterviewSessionOutput = {
  sessionId: string;
  status: 'complete' | 'interrupted' | 'blocked_provider_unavailable';
  collectedFields: Record<string, {
    value: string;
    source: 'mandant_declared';
    collectedAt: string;
  }>;
  unresolvedFields: string[];     // champs non couverts après borne de clarification
  inconsistencies: Array<{
    field: string;
    conflictingValue: string;
    previousValue: string;
    detectedAt: string;
  }>;
  providerStatus: 'available' | 'unavailable';
  completeness: number;           // 0-1, consommé par valuation-agent.confidence_review
};
```

## 8. Outils autorisés

- Provider d'entretien (canal de collecte — API/formulaire structuré côté
  mandant) — lecture/écriture de session uniquement, jamais un accès à
  d'autres systèmes.
- Lecture du contexte déjà connu transmis par `valuation-agent`
  (`knownContext`) — jamais un accès base direct hors ce que l'appelant
  fournit.

## 9. Actions interdites / politique HITL

- **Aucune donnée n'est jamais inventée** pour combler un champ manquant ou
  une clarification non obtenue — un champ non répondu reste dans
  `unresolvedFields`, jamais rempli par une valeur plausible générée.
- **Aucune décision de fond** (accepter une valeur incohérente, trancher une
  contradiction) n'est prise par ce sous-graph — `detect_inconsistency`
  signale, ne résout pas ; la résolution appartient à `valuation-agent`
  (potentiellement via son propre `approval`) ou à l'opérateur.
- **Pas de point HITL propre** : ce sous-graph n'interrompt jamais pour
  validation opérateur directe — c'est le graph appelant (`valuation-agent`)
  qui porte la responsabilité HITL globale du dossier (cf. sa spec §9). Une
  incohérence détectée ici remonte dans l'output et devient un signal
  d'entrée pour la décision HITL de l'appelant, pas une décision HITL locale.

## 10. Tenant et utilisateur

- `tenantId` + `propertyId` + `valuationRunId` obligatoires — une session
  d'entretien appartient strictement au run `valuation-agent` qui l'a
  ouverte, pas de session flottante inter-tenant ou inter-run.

## 11. Idempotence, budgets, timeouts, retry, reprise après erreur

- **Idempotence** : `sessionId` est la clé d'idempotence de la session — une
  invocation avec un `sessionId` déjà `complete` retourne l'état existant
  sans rejouer l'entretien.
- **Budgets** : plafond de tentatives de clarification par champ (config,
  cf. §5.3) ; plafond de tours totaux par session (évite une session sans
  fin si le mandant ne répond jamais de façon exploitable).
- **Timeouts** : timeout par tour d'attente de réponse mandant ; au-delà,
  checkpoint + statut `interrupted` (pas d'échec silencieux, pas de perte de
  progression).
- **Retry** : retry borné sur `handle_provider_status` (panne transitoire du
  canal) avant de déclarer `blocked_provider_unavailable`.
- **Reprise après erreur** : c'est la fonction centrale de ce sous-graph
  (§1.1, §5.4) — toute interruption (provider, timeout, abandon) checkpoint
  immédiatement ; `resume_or_init_session` restaure exactement l'état
  persisté, ne redemande jamais un champ déjà collecté.

## 12. Budgets (paramètres configurables)

- Nombre max de tentatives de clarification par champ.
- Nombre max de tours par session avant `unresolved` global.

## 13. Timeouts (indicatifs, à fixer en config projet)

- Timeout d'attente de réponse mandant par tour.
- Timeout global de session avant checkpoint forcé + retour `interrupted` à
  l'appelant.

## 14. Télémétrie

- Par session : `sessionId`, `valuationRunId`, tenant, nombre de tours,
  nombre de champs collectés/non résolus, nombre d'incohérences détectées,
  nombre d'interruptions/reprises, statut provider à chaque tour.
- Chaque reprise de session loggée avec la durée écoulée depuis la dernière
  interruption — mesure la qualité de la continuité de service.

## 15. Critères de succès

- Zéro champ inventé : `collectedFields` ne contient que des valeurs
  `source: 'mandant_declared'`.
- Une session interrompue reprend sans reposer une question déjà répondue.
- Une indisponibilité provider produit `blocked_provider_unavailable` ou
  `interrupted` — jamais un `complete` fabriqué.
- Toute incohérence détectée apparaît dans `inconsistencies`, jamais résolue
  silencieusement par le sous-graph lui-même.
- L'état retourné est directement consommable par
  `valuation-agent.validate_completeness` sans transformation supplémentaire.

## 16. Tests

- **Reprise de session** : session checkpointée à mi-parcours, provider
  remis disponible, `resume_or_init_session` restaure l'état exact, ne
  reredemande aucun champ déjà collecté.
- **Provider indisponible** : bascule vers `blocked_provider_unavailable` /
  `interrupted` sans perte de progression, checkpoint vérifié.
- **Incohérence** : réponse contredisant `knownContext` ou une réponse
  antérieure → apparaît dans `inconsistencies`, ne modifie jamais
  silencieusement `collectedFields`.
- **Non-invention** : champ non résolu après borne de clarification →
  `unresolvedFields`, jamais une valeur par défaut fabriquée dans
  `collectedFields`.
- **Idempotence** : rejouer une invocation sur un `sessionId` `complete`
  retourne l'état existant sans nouveau tour d'entretien.
- **Intégration `valuation-agent`** : le contrat de sortie de ce sous-graph
  est consommé sans adaptation par `validate_completeness` /
  `confidence_review` côté `valuation-agent` (test de contrat croisé entre
  les deux specs).

## 17. Conditions de promotion

Ce sous-graph n'a pas de cycle de promotion `draft`/`production` indépendant
au sens roster (cf. §1) — sa promotion est **liée à celle de
`valuation-agent`** : il est matérialisé, testé et versionné dans le même
mouvement que le graph parent, jamais déployé seul. Condition de sortie du
statut `specification` : matérialisation conjointe avec `valuation-agent`,
tests §16 (y compris le test de contrat croisé) au vert, aucun run réel
avant cette matérialisation conjointe.
