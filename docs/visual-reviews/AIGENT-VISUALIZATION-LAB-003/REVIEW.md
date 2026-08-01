# AIGENT-VISUALIZATION-LAB-003 — revue

**Route** : `/lab/visualizations` · **Verdict harnais** : `PASS`
**Console** : 0 erreur, 0 avertissement, 0 débordement horizontal

## Le mode retenu, et pourquoi

**`grafana-panel` via `/d-solo/` en iframe.** C'est le seul mode implémenté, et
c'est un choix, pas un défaut de temps.

| Option | Pourquoi écartée |
|---|---|
| Recoder en Recharts/D3 | Duplique la logique des panneaux, diverge au premier changement de dashboard, et fait porter à Aigent une responsabilité qui appartient à Grafana. Explicitement interdit par la mission. |
| Renderer d'image | Exige le plugin `image-renderer`, produit un PNG mort — ni tooltip, ni légende interactive, ni fenêtre temporelle. |
| Spécification Vega | Réécrit les requêtes hors de Grafana : même divergence que le recodage, avec une couche de plus. |
| **`/d-solo/` en iframe** | **Grafana rend ce qu'il sait rendre. Aigent habille. Aucune duplication, aucune divergence possible.** |

Les trois autres valeurs existent dans `VisualizationSourceKind` pour rendre la
frontière d'extension lisible. `isImplementedKind()` les refuse, et une sonde
négative le prouve : **aucun mode non implémenté ne peut atteindre `READY`**.

## Ce qui est embarqué versus préparé

**Réellement embarqué et prouvé** — 4 panneaux du dashboard `aigent-runs` :

| Panneau | id | Ce qu'on voit sur la capture |
|---|---|---|
| Volume de runs | 1 | **38** |
| Taux de succès | 3 | **72,7 %** |
| États terminaux | 6 | donut 24 / 9 / 5 |
| Latence moyenne par agent | 8 | timeseries multi-agents |

**Préparé, non implémenté** : `iframe` générique, `image-renderer`, `vega-spec`.
Aucun n'est présenté comme fonctionnel.

## Aigent versus Grafana

| Aigent possède | Grafana possède |
|---|---|
| titre, description, hiérarchie | la série, les axes, la légende, le tooltip |
| provenance jusqu'au producteur | le thème du contenu |
| état de vérité et son libellé | la fenêtre temporelle appliquée |
| action « Ouvrir dans Grafana » | le rendu, entièrement |
| responsive et densité | |

**Rien n'est superposé au-dessus des données.** Une iframe cross-origin ne peut
pas être restylée depuis Aigent ; poser un calque pour « harmoniser »
masquerait de l'information réelle. Le badge d'état vit dans l'en-tête.

## Les six états

`LOADING` · `CONNECTING` · `EMPTY` · `NOT_CONFIGURED` · `UNAVAILABLE` · `READY`

Ce qu'ils ne font **jamais** : suggérer une valeur, afficher un pourcentage de
progression, dessiner des formes aléatoires ressemblant à des données. Les
barres de `LOADING` ont des largeurs fixes ; le trait de `CONNECTING` pulse sans
jamais se remplir — il n'y a aucun pourcentage à montrer.

Deux distinctions tenues :

- `EMPTY` dit « la lecture a réussi, aucune série ne correspond » — **ce n'est
  pas un zéro** ;
- `NOT_CONFIGURED` dit « aucune adresse renseignée, jamais sondée » — ce n'est
  pas `UNAVAILABLE`, qui signifie « adresse connue, source muette ».

`useReducedMotion()` bascule sur un rendu statique complet. L'état est écrit en
toutes lettres et annoncé par `aria-live="polite"` : ni la couleur ni le
mouvement ne le portent seuls. Les animations s'interrompent quand l'onglet
n'est pas regardé.

`SurfacePlaceholder` n'est **pas** réutilisé : il signifie « route nommée mais
non construite », ce qui n'a rien à voir avec « source momentanément muette ».

## Le défaut le plus instructif de cette mission

La première passe affichait quatre **cadres blancs sous un badge `READY`** quand
la source était coupée. La sonde serveur avait réussi au rendu ; le client n'en
savait rien.

Première tentative de correction : inspecter `contentDocument` de l'iframe.
**Sans effet** — il vaut `null` que le chargement ait réussi ou échoué, la
valeur ne discrimine rien.

Correction retenue : re-sonde **côté serveur** après montage, via
`/api/agent-ops/visualizations/:id`, qui réutilise le même résolveur que le
rendu initial. Le harnais coupe désormais les deux routes — iframe et re-sonde —
et échoue si un panneau live reste `READY` sur une source coupée.

## Sécurité de l'embed

**Deux verrous, pas un** : le client n'envoie qu'un identifiant ; la résolution
en URL se fait côté serveur contre un registre figé ; puis l'URL construite
repasse par l'allowlist d'origines. Aucune URL arbitraire, aucun proxy générique.

Comparaison sur l'**origine normalisée**, jamais sur un préfixe de chaîne — la
sonde négative vérifie que `http://127.0.0.1:3802.evil.tld` est refusé.

Aucun credential ne circule : l'instance locale est en anonymous **Viewer** sur
`127.0.0.1` uniquement. Un `GRAFANA_URL` portant un mot de passe est réduit à
son schéma + hôte avant tout usage — testé.

## Politique GPU1 — à faire, hors de cette PR

Le réglage local (`GF_AUTH_ANONYMOUS_ENABLED=true`, Viewer) **n'est pas
transposable à GPU1**. Il n'est acceptable ici que parce que le port n'est
publié que sur la boucle locale.

Sur GPU1, l'embedding devra passer par un mécanisme **authentifié** : service
account Grafana + jeton court porté côté serveur, ou reverse-proxy portant
l'identité de l'opérateur. Jamais `GF_AUTH_ANONYMOUS_ENABLED`, jamais un jeton
dans une URL.

## Variante recommandée

**Densité « Confortable »**, sous réserve de validation.

Le comparateur permet de basculer entre les deux. « Compact » gagne ~30 % de
hauteur, mais resserre la provenance et la description au point de les rendre
secondaires — or ce sont elles qui rendent un chiffre vérifiable. Sur un cockpit
qu'on lit pour décider, la place gagnée ne compense pas la lisibilité perdue.

À généraliser aux routes produit : l'enveloppe `EmbeddedVisualization` telle
quelle, avec le registre server-only. Ce qui reste à trancher avant
généralisation est la politique d'authentification GPU1, pas l'architecture.

## Limites

1. **Le thème du contenu se règle dans Grafana**, pas depuis Aigent — une iframe
   cross-origin n'est pas restylable. `GF_USERS_DEFAULT_THEME: dark` aligne le
   contenu ; l'enveloppe s'accorde autour.
2. **Aucune fraîcheur par panneau** : `/d-solo/` ne publie pas la date du dernier
   point. `resolvedAt` date la résolution, pas la donnée — et le dit.
3. **`/lab/visualizations` renvoie 404 en production**, comme `/lab`. Live et
   simulations cohabitent : en production, la confusion serait trop coûteuse.
