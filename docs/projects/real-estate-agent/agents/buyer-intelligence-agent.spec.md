# Spec — buyer-intelligence-agent

**Statut : `specification`.** Aucun objet agent n'est écrit en base dans
cette passe. La matérialisation LangGraph réelle (compilation du graph,
provisioning du copilot) est un chantier distinct, ultérieur, potentiellement
facturé (architect LLM) — soumis à accord §8 le moment venu.

## 0. Identité

| Champ | Valeur |
|---|---|
| `slug` | `buyer-intelligence-agent` |
| `projectKey` attendu | `real-estate-agent` (repo `Hearst-Corporation/real-estate-agent`) |
| `runtime` | `langgraph` exclusivement |
| Zone initiale | Antibes / Alpes-Maritimes (06) |
| Statut | `specification` |

`projectKey`/`slug` réservés par documentation uniquement — pas d'écriture
base dans cette passe.

## 1. Objectif métier

Construire et maintenir, pour chaque acquéreur suivi, un **profil pondéré de
préférences et de contraintes** à partir de tout signal disponible
(déclaratif, comportemental, révisé au fil des interactions), et exposer ce
profil aux agents consommateurs (`prospection-market-agent`,
`valuation-agent`) sous une forme structurée, expliquée, et jamais modifiée
silencieusement sur un critère engageant.

## 2. Utilisateurs

- **Opérateur cockpit** — saisit/valide les signaux acquéreur, approuve les
  changements de profil proposés par l'agent.
- **Acquéreur** — source indirecte des signaux (déclarations en entretien,
  retours sur des biens proposés), jamais utilisateur direct de l'agent.
- **Agents consommateurs** — `prospection-market-agent` (scoring),
  `valuation-agent` (contexte de continuité CRM), lisent le profil via son
  contrat de sortie versionné, jamais un accès base direct.

## 3. Événements déclencheurs

- `buyer_signal` — tout signal entrant : déclaration explicite (« je veux 3
  chambres minimum »), signal implicite (temps passé sur une annonce,
  biens ignorés de façon répétée), retour explicite sur une proposition
  (accepté/rejeté + raison), mise à jour issue d'un entretien
  (`valuation-agent`/`interview-api-sentinel` côté vendeur n'alimente pas ce
  graph — seul un signal *acquéreur* déclenche ce graph).
- Déclenchement manuel opérateur (relecture/correction directe d'un profil).

## 4. État LangGraph — graph (repris tel quel)

```
buyer_signal
  → extract_preferences
  → classify_constraints
  → update_weighted_profile
  → compare_market
  → build_shortlist
  → explain_changes
  → approval                (interruption HITL conditionnelle)
  → persist_recommendation
```

### 4.1 Nodes — rôle et contrat

| Node | Rôle | Note |
|---|---|---|
| `buyer_signal` | Ingestion du signal brut (source, type, contenu, horodatage) | Toujours daté et sourcé, jamais anonyme |
| `extract_preferences` | Extrait les préférences candidates du signal (structuré) | N'écrit rien encore dans le profil |
| `classify_constraints` | Classe chaque préférence candidate selon l'échelle §5 | Classification **expliquée**, pas un label opaque |
| `update_weighted_profile` | Fusionne les préférences classées dans le profil pondéré existant | Voir §8 (jamais silencieux sur un critère engageant) |
| `compare_market` | Compare le profil mis à jour à l'état de marché courant (biens disponibles/récents) | Lecture seule marché, pas d'écriture |
| `build_shortlist` | Construit une shortlist de biens cohérents avec le profil à jour | Bornée en taille (config, pas en dur) |
| `explain_changes` | Génère l'explication lisible humain de ce qui a changé dans le profil et pourquoi | Toujours produit, même si aucun changement engageant |
| `approval` | **Interruption HITL conditionnelle** — uniquement si un critère impératif/important a changé sans preuve suffisante | Voir §9 |
| `persist_recommendation` | Persiste le profil + la shortlist + les changements approuvés | Écriture finale, idempotente |

### 4.2 Transitions

- Nominal : `buyer_signal → extract_preferences → classify_constraints →
  update_weighted_profile → compare_market → build_shortlist →
  explain_changes → approval → persist_recommendation`.
- Si `classify_constraints` ne produit aucun changement de niveau
  impératif/important (uniquement préférence/bonus/signal implicite mis à
  jour) → `approval` est **sautée** (auto-approve implicite, cf. §9) → va
  direct à `persist_recommendation`.
- Si le signal est jugé **incertain** (information non fiable, contradictoire
  avec un signal antérieur plus fort) → `classify_constraints` le marque
  `uncertain`, il progresse dans le graph mais n'affecte jamais un critère
  engageant sans passer par `approval`.

### 4.3 Boucles

- **Boucle de révision continue** : chaque nouveau `buyer_signal` réexécute
  le graph sur le profil existant (pas de recalcul from-scratch) — le graph
  est conçu pour être rejoué à chaque signal, pas seulement à l'onboarding.
- **Boucle de contradiction** : si un signal contredit un critère impératif
  déjà validé, le graph ne l'écrase pas automatiquement — boucle vers
  `approval` avec les deux versions (ancienne/nouvelle) présentées.

### 4.4 Interruptions (HITL)

`approval` est conditionnelle (cf. §9), pas systématique — mais **jamais
sautée** quand un critère impératif ou important est modifié sans preuve
solide (confirmation explicite de l'acquéreur, ou signal répété et cohérent
au-delà d'un seuil de confiance configurable).

## 5. Échelle de classification des critères

Distinction stricte, portée par `classify_constraints` :

| Niveau | Définition | Exemple | Effet sur écriture |
|---|---|---|---|
| **Impératif** | Rédhibitoire si non respecté — élimine un bien du shortlist | « budget max 450k€ » | Jamais modifié sans preuve ou validation HITL |
| **Important** | Fort impact sur le score, non éliminatoire seul | « proche école » | Jamais modifié silencieusement sans preuve ou validation HITL |
| **Préférence** | Pondère le score, mineur | « exposition sud » | Modifiable sans HITL si signal cohérent |
| **Bonus** | Avantage marginal, jamais négatif si absent | « piscine » | Modifiable librement |
| **Signal implicite** | Déduit du comportement, jamais déclaré | temps passé sur une annonce | Alimente uniquement préférence/bonus, jamais impératif/important directement |
| **Information incertaine** | Fiabilité insuffisante ou contradictoire | déclaration ambiguë/contradictoire | N'écrit rien seule ; nécessite confirmation ou passage `approval` avant tout impact engageant |

## 6. Inputs typés

```ts
type BuyerSignalInput = {
  runId: string;                 // idempotence, cf. §10
  tenantId: string;
  buyerProfileId: string;
  signal: {
    source: 'declared' | 'interview' | 'behavioral' | 'feedback_on_listing';
    content: string;             // texte brut ou structuré selon source
    listingId?: string;          // si feedback sur un bien précis
    observedAt: string;          // ISO8601
    confidence?: number;         // 0-1, si source behavioral
  };
};
```

## 7. Outputs typés

```ts
type BuyerIntelligenceOutput = {
  runId: string;
  buyerProfileId: string;
  status: 'persisted' | 'needs_confirmation' | 'rejected';
  changes: Array<{
    criterion: string;
    level: 'imperative' | 'important' | 'preference' | 'bonus';
    previousValue?: string;
    newValue: string;
    evidence: string[];          // preuves/signaux à l'appui, jamais vide sur impératif/important
    requiresApproval: boolean;
  }>;
  shortlist: Array<{
    listingId: string;
    matchScore: number;          // 0-100
    matchExplanation: string[];
  }>;
  uncertainSignals: Array<{
    criterion: string;
    reason: string;              // pourquoi jugé incertain
  }>;
};
```

## 8. Règle de non-modification silencieuse

**Règle non négociable de cet agent** : un critère de niveau `impératif` ou
`important` n'est jamais réécrit sans que l'une des deux conditions suivantes
soit vraie :

1. **Preuve suffisante** — déclaration explicite et non ambiguë de
   l'acquéreur (source `declared` ou `interview`, confidence implicite
   maximale), ou signal `behavioral` répété au-delà du seuil de confiance
   configuré (§12) ET non contredit par un signal plus récent de niveau
   supérieur.
2. **Validation HITL** — passage par `approval`, décision opérateur explicite.

Un signal `uncertain` ou `behavioral` sous le seuil n'écrit jamais directement
un critère impératif/important — il alimente `uncertainSignals` en sortie et
reste en attente de confirmation.

## 9. Politique HITL

- `approval` déclenchée uniquement si `update_weighted_profile` a produit au
  moins un `change` de niveau `imperative`/`important` avec `evidence`
  insuffisante au sens §8, ou en cas de contradiction avec une valeur
  précédente validée.
- Un run qui ne touche que préférence/bonus/signal implicite ne déclenche
  jamais `approval` — cadence opérateur non polluée par du bruit mineur.
- Décision opérateur : approve (applique le changement), reject (garde
  l'ancienne valeur, journalise le rejet), edit (fixe une valeur différente
  des deux proposées).
- Timeout d'attente (§13) : run reste `needs_confirmation`, ancien profil
  reste seul valide en attendant — jamais de merge partiel silencieux.

## 10. Tenant et utilisateur

- `tenantId` + `buyerProfileId` obligatoires sur tout run.
- Un `buyerProfileId` appartient à un seul tenant — pas de fuite
  cross-tenant, vérifiée avant tout accès profil.

## 11. Idempotence, budgets, timeouts, retry, reprise après erreur

- **Idempotence** : `runId` clé d'idempotence de traitement de signal — un
  signal déjà traité (même `runId`) ne réapplique pas ses changements deux
  fois. Un signal *dupliqué mais avec un nouveau `runId`* (ex. répétition
  légitime d'une déclaration) est traité normalement — la dédup de contenu
  identique est une décision de `extract_preferences`, pas de la couche
  idempotence.
- **Budgets** : plafond de taille de shortlist (config), plafond d'appels
  marché (`compare_market` s'appuie sur le contrat de sortie de
  `prospection-market-agent`/lecture marché, jamais un accès direct
  fournisseur).
- **Timeouts** : timeout par node ; timeout global de run.
- **Retry** : retry borné sur les lectures externes (`compare_market`) ; les
  nodes de classification/fusion ne retry pas (erreur = bug, pas panne
  transitoire).
- **Reprise après erreur** : un échec sur `compare_market` ou `build_shortlist`
  ne perd pas les changements déjà classifiés — le run peut reprendre à partir
  de `update_weighted_profile` sans recommencer l'extraction/classification.

## 12. Budgets (paramètres configurables)

- Seuil de confiance pour qu'un signal `behavioral` répété devienne éligible
  à modifier un critère impératif/important sans HITL forcée.
- Taille max de shortlist.
- Fenêtre de récence pour qu'un signal antérieur soit considéré « toujours
  valide » vs. « à reconfirmer ».

## 13. Timeouts (indicatifs, à fixer en config projet)

- Timeout par node.
- Timeout global de run.
- Timeout d'attente d'approbation HITL avant re-notification opérateur (pas
  d'auto-approve sur critère engageant, jamais).

## 14. Télémétrie

- Par run : `runId`, `buyerProfileId`, tenant, nombre de changements par
  niveau, nombre de signaux incertains, décision HITL le cas échéant, durée.
- Historique des changements de profil conservé (audit trail) — chaque
  changement engageant porte ses preuves, consultable a posteriori.

## 15. Critères de succès

- Zéro modification silencieuse d'un critère impératif/important sans preuve
  ni validation (vérifiable par audit du champ `evidence`).
- Une déclaration explicite acquéreur est reflétée dans le profil au run
  suivant.
- Un signal comportemental isolé n'écrase jamais un critère impératif déclaré.
- Toute shortlist produite est accompagnée d'une explication par bien.

## 16. Tests

- **Classification** : couverture des 6 niveaux (impératif à information
  incertaine), cas limites (signal ambigu, contradictoire).
- **Non-régression silencieuse** : un signal `behavioral` seul ne modifie
  jamais un critère impératif en base — test qui échoue si ce garde-fou est
  contourné.
- **Idempotence** : rejouer le même `runId` ne double pas les changements.
- **HITL conditionnelle** : run préférence/bonus seul ne déclenche jamais
  `approval` ; run impératif sans preuve la déclenche toujours.
- **Reprise après erreur** : échec simulé sur `compare_market`, vérifier que
  la classification déjà faite n'est pas reperdue/recalculée.

## 17. Conditions de promotion

Reste `specification` tant que : graph non matérialisé, tests §16 absents,
aucun run réel exécuté. Promotion `draft` : après matérialisation +
tests verts + revue humaine d'un échantillon de classifications réelles.
Promotion `production` : après un cycle d'observation sans incident sur la
règle §8 (zéro modification silencieuse détectée en audit).
