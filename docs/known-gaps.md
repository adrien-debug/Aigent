# Known gaps — ce qui manque honnêtement

> Compagnon de `docs/current-capabilities.md`. Ce fichier-là dit dans quel état
> est chaque capacité ; celui-ci dit pourquoi l'écart compte et ce que le combler
> impliquerait. Rien ici n'est de la spéculation — chaque manque a été établi en
> lisant le code.
>
> **Ce fichier n'est pas de la doctrine** : c'est un constat daté. Les règles
> vivent dans `CLAUDE.md` et `AGENTS.md`.

## 1. Il n'y a aucune interface — et c'est délibéré

Le front a été entièrement supprimé. Aigent est aujourd'hui une plateforme
**API-only** : tout le cycle de vie (créer, tester, benchmarker, qualifier,
promouvoir, améliorer, livrer) est atteignable par HTTP sous
`/api/agent-ops/**`, et par rien d'autre.

Ce n'est pas un manque à combler en urgence, c'est l'état choisi par la mission
`frontend-reset`. Ce qui EST un vrai manque tant que ça dure :

- **aucune lecture humaine de la flotte** — les agrégations existent et sont
  testées (`dashboard-overview.ts`, `agent-detail.ts`, `telemetry-health.ts`,
  `src/lib/runs-console/`) mais **plus personne ne les appelle**. C'est du code
  vivant sans lecteur, pas du code mort : il attend le nouveau front ;
- **aucune approbation humaine ergonomique** — les runs qui s'arrêtent en
  `needs-confirmation` sont reprenables uniquement par un `POST` manuel sur la
  route de resume.

Le futur front sera livré en blocs séparés et en free design : aucun kit,
palette ni système de tokens n'est décidé, et aucune gate visuelle n'existe.

## 2. Le canal de retour consommateur n'a jamais porté de trafic réel

L'ingestion est solide : jeton dédié, payload traité comme hostile (plafond
16 Ko, schéma Zod strict, scan de motifs de secrets, aucun écho en réponse), une
table unique pour deux sources.

Mais **zéro ligne de `runtime_telemetry_events` ne provient d'un agent déployé à
l'extérieur** : tout ce qui est stocké vient du runner interne d'Aigent ou d'un
événement de cycle de vie. La boucle
`create → qualify → ship → execute → telemetry → improve` n'a donc jamais été
bouclée de bout en bout par un vrai consommateur. L'endpoint accepte ; personne
n'a encore prouvé qu'il émet.

Corollaire honnête : « Aigent apprend des runs de ses agents déployés » décrit
une capacité **construite**, pas une capacité **exercée**.

## 3. Le shipping est doublement verrouillé par défaut

`push-agent` n'écrit dans un vrai repo GitHub que si **les deux** verrous sont
levés : `confirm: true` dans le corps **et** `GITHUB_PUSH_ENABLED=1` dans
l'environnement. Sinon, dry-run.

C'est le bon défaut pour une écriture distante destructive — mais ça veut dire
que la jambe « livraison » de la boucle n'est pas exercée en fonctionnement
normal, et que « Aigent livre des agents » parle d'un chemin éteint tant que
personne ne l'allume délibérément.

## 4. Le tool builder ne construit qu'un outil

La machinerie de build-mission (`tool_build_missions`) est générale ; la
couverture en sandbox ne l'est pas — un seul outil en dispose. Un outil construit
sans sandbox ne peut pas être certifié par exécution.

## 5. `mistral` est déclaré et non câblé

Il lève une erreur typée plutôt que de retomber silencieusement sur un autre
provider — c'est le bon échec. Mais toute doc ou config qui le liste comme option
liste quelque chose qui ne peut pas tourner. C'est le **seul** provider dans ce
cas : `openai`, `google` (tool-use inclus) et `local` (vLLM, opt-in) exécutent
réellement.

## 6. La dérive de version ne peut pas être calculée

La trace de cycle de vie (`agent-lifecycle-trace.ts`) devrait comparer la
dernière version LIVRÉE à la dernière version auto-déclarée par la télémétrie et
signaler l'écart. Elle ne peut pas : la forme de lecture d'un `DeliveryEvent`
(`delivery-events-store.ts`) ne porte pas de `versionId` — seule l'entrée
d'écriture l'a — donc il n'existe aucune jointure d'une ligne de livraison vers
un label de version.

La trace le rapporte honnêtement (`versionDrift.state: 'unknown'` + un détail qui
nomme le manque) plutôt que de deviner une correspondance. Combler ça demande soit
d'ajouter `version_id` au SELECT et au type de lecture, soit de persister un label
de version sur la ligne.

## 7. « Actif chez le consommateur » est inconnaissable par conception

Contrairement au §6, ce n'est pas un TODO. `agent-lifecycle-trace.ts` fixe l'étape
`active_in_consumer` à `reached: 'unknown'` parce qu'Aigent **n'a aucun canal de
lecture** vers l'état d'activation d'un workspace consommateur (`AGENTS.md` :
« Après provisioning, Aigent ne fait que POUSSER des agents »).
`scripts/check-lifecycle-truth.mjs` impose que ça reste le littéral `'unknown'` et
que ce ne soit jamais déduit d'un événement de livraison.

Une vraie réponse ici exige un canal de lecture côté consommateur — une décision
produit, pas un branchement de données.

## 8. Les gates de vérité sont plus étroites que leur réputation

À énoncer tel quel, parce que l'inverse a déjà été cru dans ce repo :

- `check:lifecycle-truth` ne scanne **qu'un seul fichier**.
- `check:agent-truth` vérifie qu'aucun roster n'est *importé* et qu'aucun
  provider/modèle n'est codé en dur dans le contrat canonique — pas que ce qui
  est servi est **exécutable**.
- `check:render-truth` ne couvre que `src/lib/runs-console/`.
- **Aucune gate ne scanne les agrégations** de `dashboard-overview.ts` /
  `agent-detail.ts` / `data.ts`, là où la règle « une valeur non mesurée reste
  `null` » compte le plus. Elle y tient par discipline humaine.
- **Aucune gate ne détecte un assistant LangGraph manquant** — le symptôme
  documenté (agent d'apparence saine, `tool_call_count = 0`, « pas de données »)
  reste possible avec toutes les gates vertes.

## 9. La dérive documentaire est le mode de défaillance récurrent ici

Ce fichier a déjà menti sur lui-même : sa version précédente s'ouvrait sur un §
intitulé « la dérive documentaire est un mode de défaillance récurrent » tout en
décrivant, une passe plus tard, une console de six écrans et quinze endpoints
cliquables qui n'existaient plus depuis le reset.

Il n'existe **aucune gate qui confronte un document au code**. Tant qu'il n'y en a
pas, ce fichier et `docs/current-capabilities.md` ne valent que par la dernière
personne qui a lu la source. Deux réflexes en découlent :

1. quand un document et le code se contredisent, **le code a raison** ;
2. les rapports de mission de `docs/` portent un bandeau d'archive et sont des
   **observations datées**, jamais des règles.

## Non vérifié dans cette passe

- Si le backend GPU1 live détient le roster documenté dans l'état décrit. Aucun
  compte d'agents n'est figé dans la doctrine précisément pour cette raison.
- Si les produits consommateurs déployés émettent effectivement de la télémétrie
  (§2 dit ce qui est stocké, pas ce qui est émis ailleurs).
- Le comportement runtime au sens large : cette passe a lu la source et exécuté
  les gates, elle n'a pas lancé d'agent.
