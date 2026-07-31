# Revue visuelle — AIGENT-SUPERVISION-LEARNING-001

> Preuves datées du 2026-08-01, capturées sur le dev local (`http://127.0.0.1:3987`)
> avec Chromium piloté par Playwright. **Ce document est une observation, pas une
> règle** : il dit ce que les écrans montraient à ce SHA, rien d'autre.
>
> Aucune gate visuelle n'est réintroduite par cette mission. `docs/visual-reviews/`
> sort de la liste des répertoires interdits de `check:no-legacy-front` sur
> demande explicite de l'issue #64 — une capture est une preuve, pas une doctrine
> esthétique. `check:legacy-design-doctrine` reste vert.

## Ce qui a été capturé

| Fichier | Route | Viewport | État |
|---|---|---|---|
| `desktop-1440x900.png` | `/learning` | 1440×900 | Obsidian non configuré · Learning Runtime non connecté |
| `laptop-1280x800.png` | `/learning` | 1280×800 | idem |
| `mobile-375x812.png` | `/learning` | 375×812 | idem |
| `learning-runtime-unavailable-1440x900.png` | `/learning` | 1440×900 | **Runtime injoignable** + Obsidian **configuré** |
| `obsidian-bridge-state-1440x900.png` | `/learning` | 1440×900 | Obsidian non configuré (message d'aide) |
| `actions-desktop-1440x900.png` | `/actions` | 1440×900 | File réelle, 2 lignes en lecture seule |
| `actions-mobile-375x812.png` | `/actions` | 375×812 | idem |
| `actions-mobile-nav-open-375x812.png` | `/actions` | 375×812 | **Navigation mobile ouverte** (11 entrées) |

## Ce que les captures prouvent

**La distinction absence / zéro tient à l'écran.** Sur `/learning`, les quatre
compteurs affichent `0` — et la ligne au-dessus dit « Lecture réussie … : 0 run(s)
dans la fenêtre. Un 0 ci-dessous est une mesure, pas une absence de lecture. »
Vérifié en base : `agent_runs` contient des lignes, aucune dans la fenêtre 24 h.
C'est donc un zéro MESURÉ. Si la lecture échouait, les mêmes emplacements
porteraient le badge « Indisponible » et sa raison — deux rendus visuellement
différents, jamais confondus.

**Les quatre états du Learning Runtime sont distincts et lisibles.**
`learning-runtime-unavailable-1440x900.png` montre l'état `unavailable` : badge
rouge, latence réelle (25 ms), endpoint affiché **sans jeton**, raison attribuée
(« network error »), et capacités marquées « Non mesuré » — pas une liste vide.
Les autres captures montrent `not_configured`, avec un message qui nomme la
variable à renseigner.

**Aucun bouton factice.** Sur `/actions`, chaque ligne sans mutation sûre porte
le badge « lecture seule » et n'offre que « Ouvrir le contexte ». Aucun bouton
grisé, aucune action suggérée qui n'existerait pas.

**Le pont Obsidian produit des URI correctement encodées.** Relevé dans le DOM,
vault configuré avec un espace dans son nom :

```
obsidian://open?vault=Aigent%20Supervision
obsidian://search?vault=Aigent%20Supervision&query=aigent%20review
obsidian://open?vault=Aigent%20Supervision&file=Supervision%2FFlotte.canvas
```

Et le corps d'une note de review, décodé depuis l'URI réelle (715 caractères,
sous la limite de 1800) : identifiants stables, statut, contexte borné, liens de
preuve. **Aucune clé, aucun prompt, aucun payload** — contrôle par expression
régulière sur `sk-`, `Bearer`, `password`, `api_key`, `SERVICE_ROLE` : aucun
résultat.

## Défauts trouvés et corrigés pendant la revue

La revue n'a pas servi qu'à illustrer — elle a trouvé quatre défauts réels, tous
corrigés avant ces captures finales :

1. **Débordement horizontal en mobile (47 éléments hors viewport).** Cause
   racine : `min-width: auto` sur les items de grille CSS, qui refusent de
   rétrécir sous la largeur de leur contenu — les panneaux tenaient 496 px dans
   une grille de 343. Corrigé par `[&>*]:min-w-0`. Cause secondaire : les slots
   `hint`/`actions` de `Panel` sont `shrink-0`. Mesure finale : **0 élément en
   débordement** à 360 px.
2. **Erreur d'hydratation React sur `/actions`.** `window.location.origin` lu
   dans un composant rendu des deux côtés produisait deux URI différentes.
   L'origine est désormais résolue côté serveur (`headers()`) et passée en prop.
3. **Titre masqué par le bouton de navigation mobile** (tous deux en 16,16).
   Gouttière `pl-10` réservée sous `lg`.
4. **Texte de la zone Évaluations centré sur ~34 caractères**, illisible pour un
   paragraphe. Le badge « Aucune mesure » est conservé, la raison passe en texte
   aligné à gauche.

## Console

**0 erreur, 0 warning** sur `/learning` et `/actions`, mesuré sur des
chargements frais après redémarrage complet du serveur. Le HTML rendu côté
serveur ne contient aucun marqueur d'erreur de rendu.

## Ce que ces captures ne prouvent PAS

- **Rien sur Obsidian lui-même.** Aigent construit des chaînes `obsidian://` ;
  il n'ouvre aucun vault et n'écrit aucun fichier. Que l'URI soit correctement
  formée est prouvé ; que l'application Obsidian l'honore ne l'est pas — elle
  n'est pas installée sur cette machine.
- **Rien sur le Learning Runtime réel.** L'état `unavailable` a été obtenu en
  pointant vers un port fermé. Le moteur H-Supervised n'existe pas encore : les
  états `live` et `partial` ne sont prouvés que par les tests unitaires.
- **Rien sur la reprise d'un run.** Aucun run `needs-confirmation` n'existait
  dans la fenêtre au moment des captures, donc le chemin mutant n'a pas été
  déclenché en vrai. Son modèle est couvert par les tests unitaires, et la route
  sous-jacente est celle qui existait déjà.
- **Rien sur les pixels.** Aucune gate ne mesure le rendu ; ces images sont lues
  par un humain (et l'ont été, une par une, avant ce document).
