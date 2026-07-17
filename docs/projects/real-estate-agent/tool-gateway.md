# Real Estate Agent — Tool Gateway (contrat, `UNAVAILABLE`)

Contrat documenté des interfaces que les agents **Real Estate Agent** devront
appeler pour toute lecture ou écriture métier sur le cockpit immobilier
(listings, acheteurs, matching, alertes, valorisations, CRM). Aucun agent
n'accède **jamais** directement au rôle service-role Postgres ni aux tables du
cockpit immobilier — tout passe par une **gateway** (14 interfaces nommées
`domaine.action`) qui porte l'auth, le scoping tenant/utilisateur, l'audit et
l'idempotence.

> **Statut de ce document : contrat en attente.** Le cockpit immobilier
> consommateur (le produit qui expose réellement ces 14 interfaces) **n'existe
> pas encore** dans ce repo. Les 14 entrées ci-dessous sont donc **toutes
> marquées `UNAVAILABLE`** : aucune implémentation, aucun endpoint, aucune
> réponse simulée. Ce fichier fixe la **forme** du contrat (schémas, timeout,
> idempotence, audit, scopes) pour que la future Real Estate Agent Factory et
> le futur cockpit s'alignent dessus sans redécouverte ad hoc — à l'image de
> `docs/trading-agent-factory.md` pour AIG-TRADE-001, mais **avant** le socle,
> pas après.

## 1. Principe — pourquoi une gateway et pas un accès direct

- **Aucun agent Real Estate Agent ne détient de credentials Postgres
  service-role.** Aucun agent ne construit de requête SQL, ne lit ni n'écrit
  une table du cockpit immobilier directement.
- Toute action métier (lire un listing, mettre à jour les préférences d'un
  acheteur, créer un lead CRM…) passe par l'une des **14 interfaces gateway**
  listées en §3, chacune un contrat d'entrée/sortie fermé (schéma validé,
  jamais de passthrough de payload brut).
- La gateway est le **seul point** qui porte : authentification
  service-to-service, scoping tenant, scoping utilisateur, audit, idempotence,
  timeout, rate-limit. Un agent qui veut un effet de bord côté cockpit
  immobilier ne peut l'obtenir qu'en respectant ce contrat.
- Ce découplage est ce qui permet à la Real Estate Agent Factory (roster,
  outils, tests, benchmark — même famille de socle que AIG-TRADE-001) d'être
  bâtie et testée **avant** que le cockpit immobilier réel existe : les 8
  outils market de TradeAgent avaient un provider HTTP concret dès le départ ;
  ici, tant que le cockpit n'existe pas, chaque interface **doit** retourner
  `UNAVAILABLE` plutôt que d'être court-circuitée ou mockée en dur.

## 2. Champs communs à TOUTES les interfaces

Chaque entrée du contrat (§3) documente ces neuf dimensions. Elles sont
listées une fois ici pour éviter la répétition ; les sections suivantes ne
notent que ce qui est spécifique à l'interface.

| Dimension | Règle commune |
|---|---|
| **Schéma d'entrée** | Objet validé (Zod côté implémentation future) — type, bornes, enums explicites. Jamais de `as T` sur un payload non validé. Un champ hors schéma → rejet, jamais de coercion silencieuse. |
| **Schéma de sortie** | Objet versionné, discriminé par un champ `kind` propre à l'interface, portant toujours un statut de vérité (voir §4). Une interface qui ne peut pas répondre retourne un objet `UNAVAILABLE` typé — jamais `null`, jamais un objet vide, jamais une exception non gérée. |
| **Timeout** | Budget explicite par interface (§3), aligné sur la nature de l'appel (lecture simple vs calcul/normalisation lourde vs écriture CRM). Dépassement → `UNAVAILABLE` avec raison `TIMEOUT`, jamais un retry silencieux illimité côté agent. |
| **Idempotence** | Toute interface d'écriture exige une clé d'idempotence fournie par l'appelant (agent) et portée bout en bout ; un même appel rejoué avec la même clé ne produit pas un second effet. Les interfaces de lecture sont naturellement idempotentes (aucune clé requise). |
| **Audit** | Chaque appel (lecture ou écriture) est journalisé côté gateway : interface, tenant, utilisateur, agent appelant, horodatage, statut de sortie, id de corrélation. Aucun contournement possible — l'audit est porté par la gateway, pas par l'agent. |
| **Scopes** | Permission fine-grained requise pour invoquer l'interface (ex. `listings:read`, `crm:write:lead`). Un agent sans le scope exact reçoit un refus **avant** tout accès donnée — fail-closed, jamais un scope implicite ni hérité par défaut. |
| **Token service-to-service** | Jeton signé, à durée de vie courte, porté par l'appel gateway (pas par l'agent lui-même) ; distinct de tout token utilisateur final. Rotation et émission = responsabilité du futur cockpit, hors périmètre de ce contrat. |
| **Tenant** | Chaque appel est scopé à un tenant unique et explicite (id transmis dans l'entrée) ; aucune interface ne peut lire ou écrire cross-tenant. Absence de tenant valide → rejet, jamais un tenant par défaut. |
| **Utilisateur** | Chaque appel porte l'identité de l'utilisateur final au nom duquel l'agent agit (ou `system` pour un job autonome explicitement autorisé) ; utilisé pour l'audit et pour tout owner-check applicatif côté cockpit. |

## 3. Les 14 interfaces

Regroupées par domaine métier. Chaque interface : rôle en une ligne, puis les
neuf dimensions du §2 appliquées, statut **`UNAVAILABLE`** dans tous les cas
(le cockpit consommateur n'existe pas — voir §5).

### 3.1 Domaine `listings` — inventaire de biens

#### `listings.collect`
Rôle : ingérer un lot de biens bruts depuis une ou plusieurs sources externes
(flux MLS/portails/agences) vers le cockpit immobilier.
- **Entrée** : id source, fenêtre temporelle ou curseur de pagination, filtres
  de collecte (zone, type de bien) — jamais de credentials source en clair
  dans le payload agent.
- **Sortie** : nombre de biens collectés/rejetés, liste d'ids créés, statut de
  vérité, raisons de rejet le cas échéant.
- **Timeout** : long (opération de collecte par lot) — budget dédié, distinct
  des lectures unitaires.
- **Idempotence** : requise (clé = source + fenêtre) — un re-run sur la même
  fenêtre ne duplique aucun bien.
- **Audit** : oui — source, volume, tenant.
- **Scopes** : `listings:write:collect`.
- **Statut** : **`UNAVAILABLE`** — aucune source de collecte n'est câblée, aucun
  cockpit consommateur.

#### `listings.normalize`
Rôle : normaliser un ou plusieurs biens bruts (unités, devise, adresse
structurée, taxonomie interne) vers le schéma canonique du cockpit.
- **Entrée** : ids de biens bruts à normaliser (ou payload brut direct), règles
  de normalisation applicables (locale, devise cible).
- **Sortie** : biens normalisés (schéma canonique), liste des champs
  non-normalisables avec raison, statut de vérité.
- **Timeout** : moyen (calcul, pas d'E/S externe lente).
- **Idempotence** : requise — normaliser deux fois le même bien source produit
  le même résultat, jamais un doublon.
- **Audit** : oui — ids traités, tenant.
- **Scopes** : `listings:write:normalize`.
- **Statut** : **`UNAVAILABLE`**.

### 3.2 Domaine `buyers` — profils acheteurs

#### `buyers.list`
Rôle : lister les acheteurs du tenant, avec pagination et filtres (statut,
zone recherchée, budget).
- **Entrée** : filtres, curseur de pagination, taille de page bornée.
- **Sortie** : page de résumés acheteur (jamais le profil complet), curseur
  suivant, total si connu, statut de vérité.
- **Timeout** : court (lecture paginée).
- **Idempotence** : lecture — non applicable.
- **Audit** : oui — filtres appliqués, tenant, utilisateur.
- **Scopes** : `buyers:read:list`.
- **Statut** : **`UNAVAILABLE`**.

#### `buyers.get_profile`
Rôle : lire le profil complet d'un acheteur identifié (préférences, historique
de recherche, mandats liés).
- **Entrée** : id acheteur, tenant.
- **Sortie** : profil complet ou `NOT_FOUND` explicite, statut de vérité.
- **Timeout** : court (lecture unitaire).
- **Idempotence** : lecture — non applicable.
- **Audit** : oui — id acheteur consulté (donnée personnelle → audit
  systématique, pas optionnel).
- **Scopes** : `buyers:read:profile`.
- **Statut** : **`UNAVAILABLE`**.

#### `buyers.update_preferences`
Rôle : mettre à jour les préférences de recherche d'un acheteur (budget, zones,
critères) suite à une interaction avec l'agent.
- **Entrée** : id acheteur, delta de préférences (jamais un remplacement total
  implicite — chaque champ modifié est explicite), clé d'idempotence.
- **Sortie** : profil de préférences résultant, champs effectivement modifiés,
  statut de vérité.
- **Timeout** : court (écriture unitaire).
- **Idempotence** : requise — clé fournie par l'agent, un rejeu ne réapplique
  pas le delta une seconde fois.
- **Audit** : oui — champs avant/après, agent appelant, utilisateur.
- **Scopes** : `buyers:write:preferences`.
- **Statut** : **`UNAVAILABLE`**.

### 3.3 Domaine `matching` — appariement biens / acheteurs

#### `matching.compute`
Rôle : calculer le score d'appariement entre un ensemble de biens et un ou
plusieurs profils acheteur, sans persister le résultat.
- **Entrée** : id(s) acheteur, périmètre de biens (filtre ou liste d'ids),
  paramètres de scoring (poids critères) si le cockpit les expose.
- **Sortie** : liste de paires (bien, acheteur) avec score borné, facteurs
  explicatifs séparés du score brut, statut de vérité — **jamais** un score
  sans justification (même exigence que "no bare signal" côté trading).
- **Timeout** : moyen à long selon volume — budget dédié au calcul.
- **Idempotence** : lecture pure (aucune écriture) — non applicable.
- **Audit** : oui — périmètre calculé, tenant.
- **Scopes** : `matching:read:compute`.
- **Statut** : **`UNAVAILABLE`**.

#### `matching.persist`
Rôle : persister un résultat de matching (déjà calculé via `matching.compute`)
comme association durable bien/acheteur dans le cockpit.
- **Entrée** : résultat de matching à persister (référence au calcul, pas de
  recalcul implicite), clé d'idempotence.
- **Sortie** : id(s) d'association créés/mis à jour, statut de vérité.
- **Timeout** : court (écriture).
- **Idempotence** : requise — persister deux fois le même résultat ne crée pas
  deux associations.
- **Audit** : oui — association créée, agent appelant, tenant, utilisateur.
- **Scopes** : `matching:write:persist`.
- **Statut** : **`UNAVAILABLE`**.

### 3.4 Domaine `alerts` — alertes acheteurs

#### `alerts.prepare`
Rôle : préparer le contenu d'une alerte (nouveau bien correspondant, baisse de
prix) pour un acheteur, sans l'envoyer.
- **Entrée** : id acheteur, événement déclencheur (id bien, type d'événement).
- **Sortie** : contenu d'alerte structuré (jamais de texte libre non
  structuré), canal cible proposé, statut de vérité.
- **Timeout** : court.
- **Idempotence** : requise — préparer deux fois la même alerte pour le même
  événement retourne le même contenu, pas un doublon en file.
- **Audit** : oui — événement source, acheteur ciblé.
- **Scopes** : `alerts:write:prepare`.
- **Statut** : **`UNAVAILABLE`**.

#### `alerts.dispatch`
Rôle : envoyer une alerte préparée (`alerts.prepare`) sur le canal de
l'acheteur (email/push/SMS selon ce qu'expose le cockpit).
- **Entrée** : id d'alerte préparée, clé d'idempotence.
- **Sortie** : statut d'envoi (accepté par le canal / échec / différé), statut
  de vérité.
- **Timeout** : court à moyen selon le canal.
- **Idempotence** : requise — critique ici : un rejeu ne doit **jamais**
  ré-envoyer une notification déjà délivrée à un acheteur.
- **Audit** : oui — canal, destinataire (id, pas contenu PII en clair dans le
  log), horodatage d'envoi.
- **Scopes** : `alerts:write:dispatch`.
- **Statut** : **`UNAVAILABLE`**.

### 3.5 Domaine `valuations` — estimations de valeur

#### `valuations.get`
Rôle : lire l'estimation de valeur courante d'un bien (déjà calculée côté
cockpit), avec sa provenance.
- **Entrée** : id bien, tenant.
- **Sortie** : valeur estimée, fourchette, méthode, statut de vérité (une
  estimation sans source fiable est `UNAVAILABLE`, jamais une valeur par
  défaut ou un placeholder numérique).
- **Timeout** : court (lecture).
- **Idempotence** : lecture — non applicable.
- **Audit** : oui — bien consulté, tenant.
- **Scopes** : `valuations:read:get`.
- **Statut** : **`UNAVAILABLE`**.

#### `valuations.update_interview`
Rôle : enregistrer les réponses d'un entretien de valorisation (questions
posées au propriétaire/vendeur par l'agent) qui alimentent l'estimation.
- **Entrée** : id bien, réponses structurées de l'entretien (schéma fermé de
  questions, pas de texte libre non catégorisé), clé d'idempotence.
- **Sortie** : entretien enregistré (id), statut de vérité, indication si
  l'estimation doit être recalculée en aval (signal, pas déclenchement direct
  d'un recalcul par cette interface).
- **Timeout** : court (écriture).
- **Idempotence** : requise — un rejeu ne duplique pas l'entretien enregistré.
- **Audit** : oui — bien, agent appelant, utilisateur.
- **Scopes** : `valuations:write:interview`.
- **Statut** : **`UNAVAILABLE`**.

### 3.6 Domaine `crm` — création d'entités CRM

#### `crm.create_lead`
Rôle : créer un lead CRM à partir d'une interaction agent (acheteur ou vendeur
potentiel identifié).
- **Entrée** : données de contact minimales requises par le schéma CRM,
  source de l'interaction, clé d'idempotence.
- **Sortie** : id de lead créé (ou id existant si idempotence a matché),
  statut de vérité.
- **Timeout** : court (écriture unitaire).
- **Idempotence** : requise — même clé (ex. interaction source) → un seul
  lead, jamais de doublon CRM.
- **Audit** : oui — source de l'interaction, agent appelant, tenant.
- **Scopes** : `crm:write:lead`.
- **Statut** : **`UNAVAILABLE`**.

#### `crm.create_property`
Rôle : créer une fiche propriété CRM (distincte du listing normalisé —
l'entité CRM porte le suivi commercial, pas les données marché).
- **Entrée** : référence au bien (id listing si disponible) ou données saisies
  directement, clé d'idempotence.
- **Sortie** : id de fiche propriété créée, statut de vérité.
- **Timeout** : court.
- **Idempotence** : requise.
- **Audit** : oui — bien référencé, tenant.
- **Scopes** : `crm:write:property`.
- **Statut** : **`UNAVAILABLE`**.

#### `crm.create_visit`
Rôle : créer une visite planifiée entre un acheteur/lead et un bien.
- **Entrée** : id lead ou acheteur, id propriété/bien, créneau proposé, clé
  d'idempotence.
- **Sortie** : id de visite créée, statut de confirmation (planifiée /
  en attente), statut de vérité.
- **Timeout** : court.
- **Idempotence** : requise — un rejeu ne crée pas deux visites pour le même
  couple lead/bien/créneau.
- **Audit** : oui — participants, créneau, agent appelant.
- **Scopes** : `crm:write:visit`.
- **Statut** : **`UNAVAILABLE`**.

#### `crm.create_mandate`
Rôle : créer un mandat (mandat de vente ou de recherche) liant un client à une
mission de l'agence.
- **Entrée** : type de mandat, partie prenante (id lead/acheteur/vendeur),
  périmètre (bien ou critères de recherche), clé d'idempotence.
- **Sortie** : id de mandat créé, statut de vérité — création d'un engagement
  contractuel : **aucune** valeur par défaut inventée sur les clauses, un
  champ requis manquant est un rejet, pas une valeur devinée.
- **Timeout** : court à moyen (peut impliquer une validation métier côté
  cockpit).
- **Idempotence** : requise — critique : un mandat ne doit jamais être créé en
  double par un rejeu réseau.
- **Audit** : oui — type de mandat, parties, agent appelant, utilisateur,
  horodatage — piste d'audit contractuelle, non optionnelle.
- **Scopes** : `crm:write:mandate`.
- **Statut** : **`UNAVAILABLE`**.

## 4. Statut de vérité — convention partagée

Comme pour AIG-TRADE-001, chaque sortie de gateway porte un statut de vérité
explicite plutôt qu'une absence de donnée silencieuse :

| Statut | Sens ici |
|---|---|
| `AVAILABLE` | la gateway a répondu avec une donnée/effet réel du cockpit. |
| `UNAVAILABLE` | la gateway (ou l'interface visée) n'existe pas encore, ou la source manque — **jamais une valeur fabriquée ou un défaut silencieux**. |
| `DENIED` | scope, tenant ou token invalide — refus avant tout accès donnée (fail-closed). |
| `TIMEOUT` | budget de temps dépassé — pas de résultat partiel présenté comme complet. |

**À la date de ce document, les 14 interfaces retournent exclusivement
`UNAVAILABLE`** : il n'existe aucun cockpit immobilier consommateur à
appeler, donc aucune des quatre autres valeurs n'est jamais atteignable. Toute
implémentation future qui ferait retourner `AVAILABLE` sans cockpit réel
derrière serait une fabrication de donnée — interdite par ce contrat.

## 5. Ce que ce document N'EST PAS

- Ce n'est **pas** une implémentation : aucun fichier `.ts`, aucune route,
  aucun schéma Zod exécutable n'accompagne ce contrat.
- Ce n'est **pas** une simulation : aucune des 14 interfaces ne retourne de
  données métier plausibles à titre d'exemple — uniquement la forme du
  contrat et le statut `UNAVAILABLE`.
- Ce n'est **pas** un scaffold de la Real Estate Agent Factory : le roster
  d'agents, les outils Zod réels, les tests et le benchmark viendront dans un
  chantier séparé, une fois ce contrat gateway validé et le cockpit
  immobilier consommateur démarré.
- Prochaine étape naturelle (hors périmètre de ce document) : le cockpit
  immobilier implémente ces 14 interfaces derrière une gateway HTTP interne
  (à la manière de `HttpMarketProvider` pour TradeAgent en §1 de
  `docs/trading-agent-factory.md`), puis la Real Estate Agent Factory câble
  ses outils dessus.
