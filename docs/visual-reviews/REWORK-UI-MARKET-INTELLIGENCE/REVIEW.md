# Revue visuelle — REWORK UI, page Market Intelligence

> Preuves du 2026-08-01, route `/qualification/copilot-market-intelligence`,
> Chromium piloté par Playwright sur le dev local. **Observation datée, pas une
> règle** : ce document dit ce que l'écran montrait, rien d'autre.

## Mesures avant / après

| | avant | après | écart |
|---|---|---|---|
| Hauteur de page — 1440×900 | **3538 px** | **952 px** | −73 % |
| Hauteur de page — 1280×800 | 3826 px | 952 px | −75 % |
| Hauteur de page — 375×812 | **8389 px** | **1960 px** | −77 % |
| Éléments hors écran (laptop) | 1 | **0** | — |
| Éléments hors écran (mobile) | 1 | **0** | — |
| Conteneurs de scroll internes | 11 `overflow-y-auto` | **0** | — |
| Éléments cliquables | 27 | **27** | inchangé |
| Erreurs / warnings console | 0 / 0 | **0 / 0** | inchangé |

Le nombre d'éléments cliquables est **identique** : aucune commande n'a été
supprimée, aucune n'a été dupliquée. Ce qui a changé, c'est où elles sont et
quel poids elles ont.

## Ce que la première vue répond maintenant, à 1440×900

| Question | Où c'est lisible |
|---|---|
| Quelle version est évaluée ? | En-tête — « Candidat évalué : v1.0.0 » |
| Quelle version sert la production ? | En-tête — « En production : v1.0.0 » |
| Pourquoi la promotion est bloquée ? | Colonne de décision — « Cause du blocage : Le candidat est en stade « release candidate » » |
| Quelle est la prochaine action utile ? | Colonne de décision — « Prochaine action », suivie d'une commande |

Les quatre tiennent **au-dessus de la ligne de flottaison**, sans défilement.

## Les défauts traités, un par un

1. **Dix panneaux hétérogènes en `auto-rows-fr`** → un pipeline en cinq lignes,
   plus aucune grille à hauteur forcée. `auto-rows-fr` a disparu de cette page.
2. **Cartes forcées à la même hauteur** → chaque étape occupe la hauteur de son
   contenu. Une étape sans mesure tient sur une ligne.
3. **Scroll global + `overflow-y-auto` imbriqués** → **un seul** conteneur
   défilant, celui de la page. Mesuré : 0 scroll interne.
4. **Aucune hiérarchie** → décision · parcours · secondaire, dans cet ordre de
   poids visuel. Sur mobile la décision passe **en premier**.
5. **14 boutons au même niveau** → chaque commande est dans l'étape qu'elle
   concerne ; les actions avancées et destructrices sont derrière un
   `<details>`.
6. **Actions redondantes** → « Lancer la qualification » et « Avancer d'une
   étape » ne sont plus deux chemins concurrents affichés côte à côte : ils
   vivent dans la zone de décision, sous la prochaine action calculée.
7. **Quatre cartes vides géantes** → Qualification, Shadow, Replay et
   Amélioration ne produisent plus de carte. Shadow et Replay sont des lignes
   « non requis » ; l'amélioration est dans les actions avancées.
8. **Deux gates séparées** → **fusionnées**. Ce n'est pas cosmétique :
   `PromotionGateResult` intègre déjà le rollup de la release gate
   (`rollupReleaseGate`), donc les deux panneaux décrivaient littéralement la
   même décision. La provenance de chaque condition reste tracée
   (`source: 'release' | 'promotion'`).
9. **Informations critiques noyées** → la cause exacte du blocage est en haut
   de la colonne de décision, encadrée.
10. **Mélange FR/EN** → interface **entièrement en français**. Les libellés des
    gates sont traduits à l'affichage (`frenchGateLabel`, `frenchObserved`) :
    les modules serveur restent en anglais, car ils sont partagés avec des
    surfaces non-UI. Un libellé inconnu de la table passe **tel quel**, jamais
    réécrit.

## Défauts trouvés pendant la revue, corrigés avant le commit

La revue a servi à trouver, pas à illustrer :

- **Boutons dupliqués** — les sections de la console regroupent plusieurs
  étapes (« suites » porte tests ET benchmark). Les rendre par étape affichait
  deux fois les mêmes boutons : 33 cliquables au lieu de 27. Chaque section est
  désormais ancrée sur une seule étape.
- **Bande vide sous chaque étape** — mesuré 104 px de conteneur pour 56 px de
  contenu : le `gap-4` de la console comptait sa zone de résultat et son
  `Dialog`, vides au repos.
- **Texte cassé caractère par caractère à 1280 px** — « 5/5 / cas / · / 100 % »
  en colonne, parce que quatre boutons `shrink-0` écrasaient le texte. Les
  commandes passent sous l'étape en dessous de `xl`.
- **Mauvaise prochaine action** — le modèle proposait « relancer la
  qualification » alors que le parcours était complet et que seule la gate
  refusait. Il nomme maintenant la vraie cause.

## Ce que cette revue ne prouve PAS

- **Aucune mutation n'a été déclenchée.** Les commandes sont rendues et
  cliquables ; leur exécution passe par les mêmes routes gardées qu'avant, avec
  le même dialogue de confirmation. Rien de tout cela n'a été exercé ici.
- **Un seul état de données.** Les captures montrent « gate bloquée, étapes
  shadow/replay vides », l'état réel du candidat. Les états « promouvable » et
  « qualification en cours » sont couverts par les tests unitaires
  (`qualification-cockpit-model.test.ts`), pas par une capture.
- **Le rendu au pixel.** Aucune gate ne le mesure ; ces images ont été lues une
  par une par un humain.
