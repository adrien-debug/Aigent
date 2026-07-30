# Spec — prospection-market-agent

**Statut : `specification`.** Aucun objet agent n'est écrit en base dans cette
passe. Ce fichier documente le comportement attendu ; la matérialisation
LangGraph (compilation du graph, provisioning du copilot, tools réels) est un
chantier distinct, ultérieur, et — s'il consomme un LLM Anthropic pour
générer le manifest via l'architect — soumis à l'accord préalable §8.

## 0. Identité

| Champ | Valeur |
|---|---|
| `slug` | `prospection-market-agent` |
| `projectKey` attendu | `real-estate-agent` (repo `Hearst-Corporation/real-estate-agent`) |
| `runtime` | `langgraph` exclusivement |
| Zone initiale | Antibes / Alpes-Maritimes (06) |
| Statut | `specification` |

Le `projectKey`/`slug` ci-dessus sont réservés par documentation, pas par
écriture en base. Avant toute matérialisation future, re-vérifier l'absence
de doublon (`grep` sur `projectKey`/table `projects`) dans le repo cible au
moment où on y touche — cette passe ne l'a pas fait pour `real-estate-agent`
car ce repo n'est pas Aigent.

## 1. Objectif métier

Surveiller en continu les sources de marché immobilier de la zone Antibes /
Alpes-Maritimes, détecter les événements pertinents pour les acquéreurs
suivis par le cockpit (nouvelle annonce, modification, baisse de prix,
retrait), les scorer contre les profils acquéreurs actifs, et proposer des
alertes classées par pertinence — sans jamais publier ou contacter qui que ce
soit sans validation humaine explicite (HITL).

Cet agent est un **radar de marché**, pas un agent transactionnel : il ne
négocie rien, ne contacte aucun vendeur/agence, n'écrit dans aucun CRM externe
sans passage par `update_crm` en sortie de boucle approuvée.

## 2. Utilisateurs

- **Opérateur cockpit** (agent immobilier privé, single-tenant initial) —
  consulte les alertes, approuve/rejette, ajuste seuils et cadence.
- **Acquéreurs suivis** — jamais utilisateurs directs de l'agent ; leurs
  profils (via `buyer-intelligence-agent`) sont la donnée d'entrée du scoring.
  Aucun contact acquéreur sortant depuis cet agent.

## 3. Événements déclencheurs

- Cadence planifiée (cron interne, configurable — cf. §12 Budgets).
- Déclenchement manuel opérateur (« scanner maintenant »).
- Reprise après échec fournisseur (retry planifié, cf. §11).

Cet agent n'a pas de déclencheur « signal entrant » type webhook dans cette
version — Apify est interrogé en pull, jamais en push.

## 4. État LangGraph — graph (repris tel quel)

```
trigger
  → collect_market_sources
  → normalize_listings
  → deduplicate
  → detect_changes
  → score_against_buyers
  → rank_opportunities
  → prepare_alerts
  → approval                (interruption HITL)
  → dispatch_or_store
  → update_crm
  → report
```

### 4.1 Nodes — rôle et contrat

| Node | Rôle | Note |
|---|---|---|
| `trigger` | Initialise l'état de run (zone, filtres, cadence appelante) | Idempotent par `run_id` |
| `collect_market_sources` | Interroge Apify (outil de collecte **uniquement**) pour la zone Antibes/06 | Ne fait AUCUN calcul métier |
| `normalize_listings` | Normalise le format brut Apify → schéma `ListingNormalized` interne | Prix en décimal lossless, jamais float |
| `deduplicate` | Fusionne les doublons inter-sources (même bien publié par plusieurs portails/agences) | Clé de dédup = fingerprint (adresse normalisée + surface + prix ± tolérance) |
| `detect_changes` | Compare au dernier état connu : nouvelle annonce / modifiée / baisse de prix / retrait | Toute comparaison référence la fraîcheur (`asOf`) des deux côtés |
| `score_against_buyers` | Score chaque changement contre chaque profil acquéreur actif (multi-acquéreurs) | Score **expliqué** (raisons listées, pas un nombre opaque) |
| `rank_opportunities` | Classe les opportunités par score décroissant, par acquéreur | Seuil minimum configurable (cf. §12) |
| `prepare_alerts` | Construit le paquet d'alertes (texte + données structurées) prêt à approbation | Ne dispatch rien encore |
| `approval` | **Interruption HITL** — pause le graph, attend décision opérateur | Voir §9 |
| `dispatch_or_store` | Si approuvé : dispatch (canal notif) ; si rejeté/partiel : stocke pour audit sans notifier | Jamais de dispatch sans passage par `approval` |
| `update_crm` | Journalise l'opportunité retenue dans le CRM (si connecté) | Écrit uniquement ce qui a été approuvé |
| `report` | Résumé de run (compteurs, latence, coûts, erreurs) | Toujours exécuté, même sur échec partiel |

### 4.2 Transitions

- Linéaire nominal : `trigger → collect_market_sources → normalize_listings →
  deduplicate → detect_changes → score_against_buyers → rank_opportunities →
  prepare_alerts → approval → dispatch_or_store → update_crm → report`.
- `collect_market_sources` échec total (Apify indisponible) → saute
  directement à `report` avec statut `provider_failure` (pas de partiel
  fabriqué). Voir §11.
- `detect_changes` sans aucun changement détecté → saute `score_against_buyers`
  … `prepare_alerts` et va directement à `report` (`no_changes`), pas
  d'`approval` déclenchée pour rien.
- `approval` rejet total → `dispatch_or_store` en mode « store only » →
  `update_crm` skip (rien d'approuvé) → `report`.

### 4.3 Boucles

- **Boucle de cadence** : le graph entier est une itération ; la boucle vit à
  l'extérieur (scheduler), pas comme un cycle interne au graph — évite un
  graph qui tourne indéfiniment sans checkpoint.
- **Boucle de retry fournisseur** : `collect_market_sources` retry interne
  borné (cf. §11) avant de déclarer `provider_failure`.
- **Boucle de cooldown par opportunité** : une opportunité déjà alertée et
  rejetée ne redéclenche pas `approval` avant expiration du cooldown
  (configurable, cf. §12), sauf changement matériel (nouvelle baisse de prix
  ⇒ redéclenche même sous cooldown, car c'est un nouvel événement).

### 4.4 Interruptions (HITL)

Un seul point d'interruption formel : `approval`, avant tout `dispatch_or_store`.
Le graph pause, persiste l'état `needs-confirmation`, et reprend via la route
de resume dédiée une fois la décision opérateur reçue (approve / reject /
edit-and-approve). Aucune alerte n'est envoyée à un tiers avant cette étape.

## 5. Inputs typés

```ts
type ProspectionRunInput = {
  runId: string;               // idempotence, cf. §10
  tenantId: string;
  triggeredBy: 'schedule' | 'manual' | 'retry';
  zone: {
    label: 'antibes-alpes-maritimes';
    postalCodes: string[];     // ex. ['06600', '06160', ...]
  };
  filters?: {
    propertyTypes?: Array<'apartment' | 'house' | 'villa' | 'land'>;
    minSurfaceM2?: number;
    maxPriceEur?: string;      // decimal string, jamais float
  };
  buyerProfileIds: string[];   // profils actifs à scorer (depuis buyer-intelligence-agent)
  cooldownOverride?: boolean;  // ignore le cooldown pour ce run (debug/opérateur)
};
```

## 6. Outputs typés

```ts
type ProspectionRunOutput = {
  runId: string;
  status: 'completed' | 'no_changes' | 'provider_failure' | 'partial';
  scannedAt: string;           // ISO8601
  sourcesQueried: Array<{ source: string; ok: boolean; itemCount: number }>;
  changesDetected: Array<{
    listingId: string;
    changeType: 'new' | 'modified' | 'price_drop' | 'withdrawn';
    priceDeltaEur?: string;    // decimal string
    detectedAt: string;
  }>;
  opportunities: Array<{
    listingId: string;
    buyerProfileId: string;
    score: number;             // 0-100
    scoreExplanation: string[]; // raisons listées, pas de boîte noire
    thresholdMet: boolean;
  }>;
  alertsPrepared: number;
  alertsApproved: number;
  alertsRejected: number;
  crmUpdated: number;
  errors: Array<{ node: string; message: string; recoverable: boolean }>;
};
```

## 7. Outils autorisés

- **Apify** — collecte uniquement (`collect_market_sources`). Jamais utilisé
  pour écrire, publier, ou contacter un tiers.
- Lecture profils acquéreurs (via le contrat de sortie de
  `buyer-intelligence-agent`, jamais un accès direct non contractualisé).
- Notification/dispatch interne (canal cockpit, ex. email/notif opérateur) —
  uniquement après `approval`.
- Écriture CRM interne cockpit — uniquement dans `update_crm`, uniquement sur
  ce qui a été approuvé.

## 8. Actions interdites

- Aucun contact direct vendeur/agence/portail (pas de message, pas de
  candidature, pas de formulaire soumis).
- Aucune écriture sur une plateforme d'annonce tierce.
- Aucun dispatch d'alerte à un acquéreur sans passage par `approval`.
- Aucune fabrication de score ou de donnée en cas de source indisponible —
  un `changeType`/score sans preuve n'est pas produit (mieux vaut `provider_failure`
  qu'un chiffre inventé).
- Aucun accès en écriture au compte/ordre/marché (hors périmètre total —
  cet agent n'a aucune notion de compte ou d'ordre).

## 9. Politique HITL

- `approval` est un point de pause obligatoire avant tout dispatch externe
  (au sens : visible par l'acquéreur ou toute action irréversible).
- `update_crm` (interne, réversible, journalisé) peut être englobé dans la
  même décision d'approbation que le dispatch — pas de second point de pause
  séparé, pour ne pas multiplier les frictions opérateur sur une action
  purement interne et journalisée.
- L'opérateur peut approuver partiellement (sous-ensemble des opportunités
  proposées) — `dispatch_or_store` traite le sous-ensemble approuvé
  uniquement, le reste part en `store only`.
- Timeout d'attente d'approbation (cf. §13) : au-delà, le run est marqué
  `needs-confirmation` persistant, repris à la prochaine action opérateur ou
  au prochain cycle planifié (pas d'auto-approve, jamais).

## 10. Tenant et utilisateur

- `tenantId` obligatoire sur tout run — pas de run cross-tenant.
- `triggeredBy` distingue schedule/manual/retry pour l'audit, mais ne change
  pas les autorisations (même politique HITL dans tous les cas).
- Zone initiale fixée au niveau config projet (`antibes-alpes-maritimes`),
  extensible par tenant plus tard — hors scope de cette spec.

## 11. Idempotence, budgets, timeouts, retry, reprise après erreur

- **Idempotence** : `runId` est la clé d'idempotence du run entier. Un
  `runId` déjà `completed` ne se ré-exécute pas — retourne l'output existant.
  Au niveau opportunité, la clé est `(listingId, buyerProfileId, changeType,
  detectedAt)` — évite un doublon d'alerte pour le même événement.
- **Déduplication** (`deduplicate` node) : fingerprint composite
  (adresse normalisée + surface ± 2 % + prix ± 3 %) ; collision → merge des
  sources, garde la plus fraîche comme référence d'affichage.
- **Fraîcheur** : chaque listing normalisé porte un `asOf`. Une donnée plus
  vieille que le TTL configuré (cf. §12) est traitée comme `STALE`, exclue du
  scoring, journalisée dans `report.errors` (non bloquant pour le reste du run).
- **Budgets** : plafond d'appels Apify par run (configurable, défaut
  raisonnable à fixer en configuration projet, pas en dur dans le graph) ;
  plafond de coût run journalisé dans `report`.
- **Cadence / cooldown** : cadence de scan configurable par zone ; cooldown
  par opportunité rejetée (cf. §4.3) pour éviter le spam de la même
  suggestion.
- **Opt-out** : un acquéreur en opt-out (flag sur son profil, propagé par
  `buyer-intelligence-agent`) est exclu de `score_against_buyers` — jamais
  scoré, jamais alerté, même si son profil est présent dans `buyerProfileIds`.
- **Timeouts** : timeout par node réseau (`collect_market_sources`) distinct
  du timeout global de run ; un timeout node déclenche le retry borné avant
  d'échouer le run.
- **Retry** : retry exponentiel borné (nombre max de tentatives fixé en
  config) sur `collect_market_sources` uniquement — les nodes de calcul pur
  (normalize/dedupe/score/rank) ne retry pas, une erreur y est un bug à
  corriger, pas une panne transitoire.
- **Reprise après erreur** : un `provider_failure` planifie un retry au
  prochain cycle (pas de retry immédiat en boucle serrée) ; l'état partiel
  (listings déjà normalisés avant la panne) n'est PAS perdu — persisté pour
  reprise, jamais recalculé depuis zéro si évitable.

## 12. Budgets (paramètres configurables — pas de nombre en dur)

Tous les seuils suivants sont des **paramètres de configuration projet**, pas
des constantes codées en dur dans le graph :

- Cadence de scan (ex. toutes les N minutes/heures).
- Seuil de score minimum pour générer une alerte.
- Cooldown par opportunité rejetée.
- TTL de fraîcheur listing avant `STALE`.
- Plafond d'appels Apify / plafond de coût par run.
- Nombre max de tentatives de retry.

## 13. Timeouts (valeurs indicatives, à fixer en config projet)

- Timeout réseau par appel Apify.
- Timeout global de run (au-delà : run marqué `timed_out`, état partiel
  persisté, reprise au cycle suivant).
- Timeout d'attente d'approbation opérateur avant re-notification (pas
  d'auto-approve).

## 14. Télémétrie

- Par run : `runId`, `tenantId`, durée totale, durée par node, compteurs
  (sources interrogées, listings collectés, doublons fusionnés, changements
  détectés, opportunités générées, alertes approuvées/rejetées), coût
  (appels Apify), statut final.
- Par node : succès/échec, latence, retries consommés.
- Événements HITL : décision opérateur (approve/reject/partial/timeout),
  horodatage, opérateur.
- Aucune donnée acquéreur sensible en clair dans les logs bruts — référence
  par `buyerProfileId`, pas de PII dans les logs de télémétrie technique.

## 15. Critères de succès

- Un changement réel (nouvelle annonce / modif / baisse de prix / retrait)
  publié sur une source suivie est détecté au plus tard au cycle de scan
  suivant sa publication.
- Zéro alerte dupliquée pour le même événement (idempotence §11 respectée).
- Zéro dispatch sans passage par `approval`.
- Score toujours accompagné d'une explication non vide.
- Un échec fournisseur ne bloque pas les cycles suivants (reprise automatique
  au prochain cycle planifié).
- Un acquéreur en opt-out ne reçoit strictement aucune alerte issue de cet
  agent.

## 16. Tests

- **Unitaires par node** : normalize (formats de sources hétérogènes),
  deduplicate (fingerprint, faux positifs/négatifs), detect_changes (les 4
  types d'événements), score_against_buyers (scoring expliqué, multi-profils),
  cooldown (respect / override justifié).
- **Intégration graph** : run nominal complet ; run avec échec Apify
  (provider_failure, pas de fabrication) ; run avec `no_changes` (chemin
  court) ; run avec rejet partiel HITL (dispatch partiel correct).
- **Idempotence** : rejouer le même `runId` ne double pas les alertes ni les
  écritures CRM.
- **Opt-out** : profil opt-out jamais présent dans `opportunities` en sortie,
  quel que soit le score théorique.
- **Fraîcheur** : listing `STALE` exclu du scoring, présent dans
  `report.errors`, jamais silencieusement ignoré.
- **Sécurité/permissif** : aucune action Apify hors lecture n'est appelable
  (surface d'outils bornée au niveau contrat, pas seulement au niveau prompt).

## 17. Conditions de promotion

Cet agent reste au statut `specification` tant que :

1. Le graph LangGraph n'est pas matérialisé en copilot réel (roster →
   manifest → provisioning), étape distincte et potentiellement facturée
   (architect LLM) — nécessite l'accord explicite d'Adrien le moment venu (`CLAUDE.md` §3).
2. La suite de tests §16 n'existe pas encore et ne tourne pas en vert.
3. Aucun run réel (`agent_runs`) n'a été exécuté.

Promotion vers `draft` autorisée seulement après : graph matérialisé, tests
unitaires + intégration au vert, revue humaine du scoring expliqué sur un
échantillon réel de la zone Antibes/06. Promotion vers `production` :
uniquement après un cycle de shadow run (observation sans dispatch réel) sans
incident, et validation opérateur explicite du taux de faux positifs
d'alertes.
