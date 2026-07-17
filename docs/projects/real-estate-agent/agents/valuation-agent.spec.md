# Spec — valuation-agent

**Statut : `specification`.** Aucun objet agent n'est écrit en base dans
cette passe. La matérialisation LangGraph réelle est un chantier distinct,
ultérieur, potentiellement facturé (architect LLM) — soumis à accord §8 le
moment venu.

## 0. Identité

| Champ | Valeur |
|---|---|
| `slug` | `valuation-agent` |
| `projectKey` attendu | `real-estate-agent` (repo `Hearst-Corporation/real-estate-agent`) |
| `runtime` | `langgraph` exclusivement |
| Zone initiale | Antibes / Alpes-Maritimes (06) |
| Statut | `specification` |

`projectKey`/`slug` réservés par documentation uniquement — pas d'écriture
base dans cette passe.

## 1. Objectif métier

Produire une **estimation de valeur** documentée et expliquée pour un bien
(généralement côté vendeur/mandat), en combinant un entretien structuré de
collecte, des sources officielles, une comparaison de marché, et des
ajustements traçables — avec une revue de confiance avant publication et
approbation humaine avant tout rapport final. Prépare aussi la continuité
CRM pour la suite du dossier.

## 2. Utilisateurs

- **Opérateur cockpit** — pilote l'entretien, valide/ajuste l'estimation
  avant publication.
- **Vendeur/mandant** — répond aux questions de l'entretien (via
  `interview-api-sentinel`, cf. son spec), reçoit le rapport final après
  approbation.
- **Agents consommateurs** — `crm-next-best-action-agent` (à terme) lit le
  contrat `prepare_crm_continuity` en sortie.

## 3. Événements déclencheurs

- `valuation_request` — création d'une demande d'estimation (nouveau mandat,
  ou ré-estimation d'un bien déjà suivi).

## 4. État LangGraph — graph (repris tel quel)

```
valuation_request
  → collect_property_context
  → interview
  → validate_completeness
  → gather_official_sources
  → compare_market
  → compute_adjustments
  → confidence_review
  → generate_valuation
  → approval                    (interruption HITL)
  → publish_report
  → prepare_crm_continuity
```

### 4.1 Nodes — rôle et contrat

| Node | Rôle | Note |
|---|---|---|
| `valuation_request` | Initialise le dossier d'estimation (bien, mandant, contexte) | Idempotent par `runId` |
| `collect_property_context` | Rassemble le contexte connu du bien (données déjà en base, historique) | Ne réinterroge pas ce qui est déjà fiable/frais |
| `interview` | Sous-graph structuré de collecte des données manquantes auprès du mandant | Délègue la surveillance de session à `interview-api-sentinel` (cf. sa spec — décision sous-graph versionné) |
| `validate_completeness` | Vérifie que les champs requis pour une estimation fiable sont présents | Champ manquant bloquant → ne progresse pas vers `gather_official_sources` sans le signaler |
| `gather_official_sources` | Interroge les sources officielles (cadastre, DVF/transactions publiques, etc.) | Lecture seule, sources publiques/officielles uniquement |
| `compare_market` | Compare aux biens comparables du marché courant | S'appuie sur le contrat de sortie de `prospection-market-agent`, jamais un accès direct fournisseur dupliqué |
| `compute_adjustments` | Calcule les ajustements (état, exposition, travaux, spécificités) par rapport aux comparables | Chaque ajustement porte sa justification et son montant, jamais un ajustement opaque |
| `confidence_review` | Évalue le niveau de confiance global de l'estimation (couverture de données, dispersion des comparables) | Peut renvoyer vers `interview` si confiance insuffisante et donnée manquante identifiable |
| `generate_valuation` | Produit la fourchette d'estimation + valeur centrale + rapport détaillé | Toujours accompagné de la méthodologie et des sources |
| `approval` | **Interruption HITL** — validation opérateur avant publication | Voir §9 |
| `publish_report` | Publie/rend disponible le rapport final au mandant | Jamais avant `approval` |
| `prepare_crm_continuity` | Prépare le paquet de continuité pour le CRM (statut mandat, prochaine étape) | Écrit uniquement ce qui a été approuvé |

### 4.2 Transitions

- Nominal : `valuation_request → collect_property_context → interview →
  validate_completeness → gather_official_sources → compare_market →
  compute_adjustments → confidence_review → generate_valuation → approval →
  publish_report → prepare_crm_continuity`.
- `validate_completeness` incomplet et bloquant → retour vers `interview`
  (boucle, cf. §4.3) plutôt que de progresser avec des trous.
- `confidence_review` en confiance insuffisante ET donnée manquante
  identifiable et récupérable → retour vers `interview` (une seule boucle de
  ce type par run, cf. §4.3, pour éviter une boucle infinie).
- `confidence_review` en confiance insuffisante SANS donnée récupérable
  supplémentaire → progresse quand même vers `generate_valuation` mais avec
  un flag `low_confidence` explicite, jamais caché à l'opérateur en
  `approval`.
- `gather_official_sources` en échec partiel (source officielle
  indisponible) → progresse avec les sources disponibles, journalise le trou
  dans `errors`, n'invente jamais une valeur cadastrale/officielle absente.

### 4.3 Boucles

- **Boucle interview ↔ validate_completeness** : bornée à N itérations
  (config, pas en dur) — au-delà, le run progresse avec l'incomplétude
  documentée plutôt que de bloquer indéfiniment le mandant.
- **Boucle confidence_review → interview** : au plus une occurrence par run
  (évite un aller-retour perpétuel entre confiance et entretien).

### 4.4 Interruptions (HITL)

- `approval` : point de pause unique et obligatoire avant `publish_report`.
  Aucun rapport n'atteint le mandant sans validation opérateur explicite,
  même en cas de confiance élevée.
- L'`interview` sous-jacente peut elle-même être interrompue/reprise (session
  incomplète, mandant indisponible) — c'est la responsabilité de
  `interview-api-sentinel` (voir sa spec), pas un second point HITL du graph
  `valuation-agent`.

## 5. Inputs typés

```ts
type ValuationRequestInput = {
  runId: string;                 // idempotence, cf. §10
  tenantId: string;
  propertyId: string;
  requestedBy: 'operator' | 'mandate_renewal';
  knownContext?: {
    surfaceM2?: number;
    propertyType?: 'apartment' | 'house' | 'villa' | 'land';
    address?: string;
  };
};
```

## 6. Outputs typés

```ts
type ValuationRunOutput = {
  runId: string;
  propertyId: string;
  status: 'completed' | 'needs_confirmation' | 'blocked_incomplete';
  confidence: 'high' | 'medium' | 'low';
  valuation?: {
    centralValueEur: string;     // decimal string, jamais float
    rangeLowEur: string;
    rangeHighEur: string;
    methodology: string;
    comparables: Array<{ listingId: string; adjustedValueEur: string }>;
    adjustments: Array<{ label: string; amountEur: string; justification: string }>;
    officialSourcesUsed: Array<{ source: string; asOf: string }>;
  };
  interviewState?: {
    completeness: number;        // 0-1
    missingFields: string[];
  };
  errors: Array<{ node: string; message: string; recoverable: boolean }>;
};
```

## 7. Outils autorisés

- Sources officielles publiques (cadastre, transactions publiques type DVF)
  — lecture seule.
- Contrat de sortie `prospection-market-agent` (comparables marché) — lecture
  contractualisée, jamais un accès direct fournisseur redondant.
- Sous-graph `interview-api-sentinel` — collecte structurée auprès du
  mandant.
- Publication de rapport (canal cockpit) — uniquement après `approval`.

## 8. Actions interdites

- Aucune publication de rapport avant `approval`.
- Aucune valeur officielle (cadastre/DVF) inventée en cas de source
  indisponible — trou documenté, jamais comblé par une estimation déguisée
  en donnée officielle.
- Aucun ajustement sans justification et montant explicites.
- Aucune écriture CRM hors de ce qui a été explicitement approuvé.

## 9. Politique HITL

- `approval` obligatoire avant `publish_report`, sans exception, y compris
  en confiance `high`.
- L'opérateur voit : la fourchette, la méthodologie, les ajustements, le
  niveau de confiance, et tout flag `low_confidence`/incomplétude.
- Décision : approve (publie tel quel), edit (ajuste la valeur/le rapport
  avant publication, ajustement journalisé comme override humain), reject
  (retour en amont — reprise sur `interview` ou `compute_adjustments` selon
  la raison du rejet).
- Timeout d'attente : run reste `needs_confirmation`, aucune publication par
  défaut au-delà du délai.

## 10. Tenant et utilisateur

- `tenantId` + `propertyId` obligatoires. Un `propertyId` appartient à un
  seul tenant, vérifié avant tout accès.

## 11. Idempotence, budgets, timeouts, retry, reprise après erreur

- **Idempotence** : `runId` clé d'idempotence de la demande d'estimation. Un
  `runId` déjà `completed` retourne l'output existant, ne relance pas
  l'entretien ni les sources officielles.
- **Budgets** : plafond d'itérations `interview↔validate_completeness` (§4.3),
  plafond d'appels sources officielles par run.
- **Timeouts** : timeout par node ; timeout global de run ; timeout de
  session d'entretien délégué à `interview-api-sentinel`.
- **Retry** : retry borné sur `gather_official_sources` (source
  officielle transitoirement indisponible) ; pas de retry sur les nodes de
  calcul pur (`compute_adjustments`, `confidence_review`).
- **Reprise après erreur** : un échec sur `gather_official_sources` ou
  `compare_market` ne perd pas le contexte déjà collecté et l'entretien déjà
  mené — reprise à partir du node en échec, pas depuis `valuation_request`.

## 12. Budgets (paramètres configurables)

- Nombre max d'itérations interview↔validate_completeness.
- Plafond d'appels sources officielles par run.
- Seuil de confiance pour classer `high`/`medium`/`low`.

## 13. Timeouts (indicatifs, à fixer en config projet)

- Timeout par node.
- Timeout global de run.
- Timeout de session d'entretien (délégué, cf. spec `interview-api-sentinel`).
- Timeout d'attente d'approbation opérateur.

## 14. Télémétrie

- Par run : `runId`, `propertyId`, tenant, durée totale, durée par node,
  nombre d'itérations interview↔validate_completeness consommées, niveau de
  confiance final, décision HITL, sources officielles utilisées avec `asOf`.
- Traçabilité complète des ajustements (montant + justification) pour audit.

## 15. Critères de succès

- Toute estimation publiée a une méthodologie et des comparables explicites.
- Zéro publication sans `approval`.
- Un trou de donnée officielle est toujours visible dans le rapport
  (`officialSourcesUsed` incomplet documenté), jamais silencieusement comblé.
- Confiance `low` toujours visible à l'opérateur avant décision.

## 16. Tests

- **Complétude** : `validate_completeness` bloque correctement sur champ
  requis manquant, boucle vers `interview`, respecte la borne d'itérations.
- **Confiance** : `confidence_review` classe correctement selon dispersion
  des comparables et couverture de données ; boucle vers `interview` une
  seule fois max.
- **Sources officielles indisponibles** : le run progresse avec trou
  documenté, jamais de valeur inventée.
- **Idempotence** : rejouer le même `runId` ne relance ni entretien ni appels
  sources officielles.
- **HITL** : aucun chemin de test ne peut atteindre `publish_report` sans
  passer par une décision `approval` explicite.
- **Intégration `interview-api-sentinel`** : reprise d'une session interview
  interrompue produit un état exploitable sans redemander les champs déjà
  collectés.

## 17. Conditions de promotion

Reste `specification` tant que : graph non matérialisé, sous-graph
`interview-api-sentinel` non matérialisé, tests §16 absents, aucun run réel.
Promotion `draft` : après matérialisation des deux graphs + tests verts +
revue humaine d'une estimation réelle de bout en bout. Promotion
`production` : après un cycle d'observation sans incident sur la règle
§8/§9 (zéro publication sans approbation, zéro valeur officielle inventée).
