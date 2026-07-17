# Spec — crm-next-best-action-agent

**Statut : `specification`.** Copilot **draft + tests minimum** dans cette
passe — aucun objet agent n'est écrit en base. Ce document sert de squelette
minimal, à étoffer une fois le gateway métier `crm.*` disponible.

## 0. Identité

| Champ | Valeur |
|---|---|
| `slug` | `crm-next-best-action-agent` |
| `projectKey` attendu | `real-estate-agent` (repo `Hearst-Corporation/real-estate-agent`) |
| `runtime` | `langgraph` exclusivement |
| Statut | `specification` |
| Dépendance bloquante | gateway métier **`crm.*` — UNAVAILABLE** |

`projectKey`/`slug` réservés par documentation uniquement — pas d'écriture
base dans cette passe.

## 1. Objectif métier (cible, non implémentable aujourd'hui)

Proposer, pour chaque dossier CRM actif (vendeur, acquéreur, mandat), la
**prochaine meilleure action** (relance, envoi de shortlist, planification
d'une visite, ré-estimation, etc.), en s'appuyant sur l'état du dossier et les
sorties des autres agents du roster (`prospection-market-agent`,
`buyer-intelligence-agent`, `valuation-agent`). Copilot **d'assistance à la
décision**, pas d'exécution automatique — toute action reste proposée à
l'opérateur.

**Bloqué** : cet objectif suppose un accès en lecture au gateway métier
`crm.*` (état des dossiers, historique d'interactions) qui n'existe pas
encore dans ce cockpit. Tant que `crm.*` est `UNAVAILABLE`, cet agent ne peut
produire aucune sortie fondée — voir §8.

## 2. Utilisateurs (cible)

- **Opérateur cockpit** — consulte les suggestions de prochaine action,
  approuve/rejette/reporte.

## 3. Événements déclencheurs (cible)

- Événement CRM (changement de statut dossier) — dépend de `crm.*`.
- Cadence planifiée de relecture des dossiers actifs.
- Sortie d'un autre agent du roster pertinente pour un dossier donné
  (nouvelle opportunité prospection, changement profil acquéreur, estimation
  publiée).

## 4. État LangGraph — graph (squelette, non affiné tant que `crm.*` UNAVAILABLE)

```
crm_event
  → load_dossier_context      (BLOQUÉ — nécessite crm.*)
  → aggregate_agent_signals
  → rank_candidate_actions
  → explain_recommendation
  → approval                  (interruption HITL)
  → persist_recommendation
```

Ce graph est un **squelette de cadrage**, pas une spec détaillée nœud par
nœud (contrairement aux 3 autres agents) — l'affinage (transitions, boucles,
gestion d'erreur par node) est reporté à la disponibilité de `crm.*`, pour
éviter de spécifier des contrats contre une donnée qui n'existe pas encore.

## 5. Inputs typés (squelette, sujet à révision)

```ts
type NextBestActionInput = {
  runId: string;
  tenantId: string;
  dossierId: string;           // identifiant CRM — type précis dépend de crm.*
  triggeredBy: 'crm_event' | 'schedule' | 'agent_signal';
};
```

## 6. Outputs typés (squelette, sujet à révision)

```ts
type NextBestActionOutput = {
  runId: string;
  dossierId: string;
  status: 'blocked_unavailable' | 'completed' | 'needs_confirmation';
  recommendations: Array<{
    action: string;
    rationale: string[];
    priority: number;
  }>;
  errors: Array<{ node: string; message: string; recoverable: boolean }>;
};
```

Tant que `crm.*` est `UNAVAILABLE`, tout run doit produire `status:
'blocked_unavailable'` avec `recommendations: []` — jamais de recommandation
fondée sur une donnée CRM absente ou simulée.

## 7. Outils autorisés (cible)

- Gateway métier `crm.*` (lecture dossier, historique) — **actuellement
  UNAVAILABLE**, aucun accès possible.
- Contrats de sortie des 3 autres agents du roster (lecture, une fois
  eux-mêmes matérialisés).

## 8. Actions interdites

- Aucune écriture CRM directe (ce copilot recommande, il n'exécute rien).
- Aucune recommandation produite tant que `crm.*` est `UNAVAILABLE` — pas de
  fallback, pas de donnée simulée présentée comme réelle. Le statut
  `blocked_unavailable` est le seul comportement valide en son absence.
- Aucune action irréversible sans `approval`.

## 9. Politique HITL

- `approval` obligatoire avant `persist_recommendation`, dès que le gateway
  `crm.*` existera et que ce copilot dépasse le statut `specification`.
- En attendant, aucune décision HITL n'est pertinente : le seul chemin
  d'exécution valide est le blocage immédiat.

## 10. Tenant et utilisateur

- `tenantId` + `dossierId` obligatoires, cross-tenant interdit — même
  contrainte que les autres agents du roster, à faire respecter dès la
  première implémentation réelle.

## 11. Idempotence, budgets, timeouts, retry, reprise après erreur

- **Idempotence** : `runId` clé d'idempotence, comme les autres agents du
  roster — un run `blocked_unavailable` rejoué reste `blocked_unavailable`
  sans effet de bord.
- **Budgets/timeouts/retry** : non pertinents tant que `crm.*` est
  `UNAVAILABLE` — le graph squelette n'appelle rien de coûteux ; à définir à
  l'affinage post-`crm.*`.
- **Reprise après erreur** : non applicable au statut actuel — un run
  bloqué n'a pas d'état partiel à reprendre.

## 12. Budgets

Non applicables tant que `crm.*` est `UNAVAILABLE`. À définir à l'affinage.

## 13. Timeouts

Non applicables tant que `crm.*` est `UNAVAILABLE`. À définir à l'affinage.

## 14. Télémétrie

- Par run : `runId`, `dossierId`, tenant, `status`. Le cas
  `blocked_unavailable` doit être télémétré distinctement (compteur dédié)
  pour mesurer la dépendance bloquante tant qu'elle n'est pas levée — permet
  de justifier objectivement la priorité de câblage du gateway `crm.*`.

## 15. Critères de succès (à ce stade)

- Tout run produit `blocked_unavailable` de façon systématique et honnête —
  zéro recommandation fabriquée en l'absence de `crm.*`.
- Le squelette de graph documente clairement la dépendance bloquante pour
  quiconque reprend ce chantier.

## 16. Tests (minimum, ce qui est actuellement vérifiable)

- **Statut bloqué systématique** : tout appel du graph avec `crm.*` absent
  retourne `status: 'blocked_unavailable'`, `recommendations: []`, jamais
  d'exception non gérée.
- **Idempotence du blocage** : rejouer le même `runId` en état bloqué ne
  produit aucun effet de bord et retourne le même statut.
- **Aucun test de recommandation réelle** n'est écrit dans cette passe — cela
  nécessiterait un `crm.*` fonctionnel, hors périmètre.

## 17. Conditions de promotion

- Reste `specification` de façon **prolongée et attendue**, contrairement aux
  3 autres agents du roster : le blocage n'est pas un simple retard de
  matérialisation, c'est une dépendance externe (gateway `crm.*`) hors du
  contrôle de ce chantier.
- Promotion vers `draft` : impossible avant que `crm.*` sorte de l'état
  `UNAVAILABLE` (implémentation du gateway métier CRM, hors périmètre de
  cette spec).
- Une fois `crm.*` disponible : réaffiner le graph nœud par nœud (au niveau
  de détail des 3 autres specs de ce dossier), écrire la suite de tests
  complète, puis suivre le même chemin de promotion `draft → production`
  (matérialisation, tests verts, shadow run, validation opérateur).
