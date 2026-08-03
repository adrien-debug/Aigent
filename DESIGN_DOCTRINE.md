# DESIGN_DOCTRINE.md — les surfaces d'Aigent

> **Autorité design du repository.** Ce fichier remplace la doctrine « free
> design » qui gouvernait jusqu'ici. Ce changement est **délibéré** : le front
> a été reconstruit, il est en production, et une surface de production sans
> autorité visuelle produit des écrans qui se contredisent entre eux.
>
> Portée : les **surfaces de production**. Les zones d'exploration ont leur
> propre régime, énoncé au §9.

## 1. Le Design System est obligatoire en production

Sur toute surface de production, le Design System d'Aigent **s'applique**. Ce
n'est pas une recommandation, et « je trouvais ça plus joli » n'est pas une
dérogation.

**Pourquoi.** Un plan de contrôle se lit en diagonale, sous pression, pour
décider si un agent a le droit de tourner. Deux écrans qui peignent le même
statut différemment ne sont pas un détail esthétique : ils obligent le lecteur à
retraduire à chaque écran, et c'est exactement là que naissent les erreurs de
lecture qu'Aigent existe pour empêcher.

## 2. Autorité des couleurs — les jetons `--aig-*`

Les jetons `--aig-*` sont **l'autorité sémantique unique** des surfaces de
production.

- Un **statut métier** s'exprime par un jeton sémantique, jamais par une couleur
  utilitaire brute ni par une palette de composant.
- La **gravité** se décline par assombrissement d'un accent unique, jamais par
  changement de teinte. Une échelle de gravité qui change de couleur oblige à
  mémoriser un code ; une échelle qui s'assombrit se lit sans légende.
- Les jetons `-ink` existent pour le **texte** ; un jeton de fond utilisé comme
  couleur de texte casse le contraste et ne doit pas apparaître.
- **Une seule autorité de statut par écran.** Deux vocabulaires visuels décrivant
  le même état sur la même page est un défaut, pas un style.

Cette autorité est **actuelle**, pas éternelle : elle évolue par mission dédiée.

## 3. Réutiliser avant de créer

Ordre de préemption, strict :

1. une **primitive du kit UI local** (`src/components/ui/`) ;
2. une primitive **Catalyst** disponible ;
3. **seulement ensuite**, un composant maison — et il rejoint le kit.

Le kit est **du code du repository** : il se modifie, il s'étend. Ce qui est
interdit, c'est de le **contourner** en réécrivant à côté une variante
divergente, puis une troisième. Une primitive dupliquée est une dette qui se
paie à chaque changement de thème.

## 4. Direction visuelle

- **Sidebar noire**, **body clair**.
- **Graphite** pour la structure et la hiérarchie.
- **Cuivre** en accent, **limité** : c'est un accent, pas une couleur de fond. Un
  accent partout n'accentue rien.
- **Surfaces architecturales** : la hiérarchie est portée par le liseré, le
  niveau et l'espacement.
- **Pas de grosses cartes SaaS.** Une carte qui enferme trois chiffres dans une
  boîte ombrée consomme l'écran sans ajouter de sens.
- **KPI plats.** Un chiffre, son libellé, son état. Ni jauge décorative, ni
  dégradé, ni mini-graphique inline dans une carte ou une table.
- **Aucun iframe d'outil externe** sur une surface de production. Un outil tiers
  encadré dans une page ne partage ni le thème, ni l'authentification, ni la
  vérité des données — et il ment sur son appartenance au produit.

## 5. Densité et responsive

Les surfaces sont **utilisables en desktop et en mobile**. Le responsive n'est
pas un ajout tardif : une colonne masquée sous un point de rupture ne doit jamais
faire disparaître une information d'état. Cacher un statut sur petit écran, c'est
livrer un écran qui ment par omission.

**Une box ne s'agrandit pas avec ses données.** Une zone à hauteur bornée dont le
contenu défile à l'intérieur ; jamais une page qui s'allonge indéfiniment parce
qu'une liste a grandi.

## 6. États obligatoires

Toute surface qui lit des données traite **quatre états distincts**, et ne les
confond jamais :

| État | Signification | Ce qu'il ne faut pas faire |
|---|---|---|
| **chargement** | la lecture est en cours | afficher un zéro en attendant |
| **vide prouvé** | la lecture a réussi, il n'y a rien | dire « indisponible » |
| **indisponible** | la lecture a échoué | afficher `0`, `—` ou `100 %` |
| **non configuré** | la source n'existe pas ici | dire « erreur » |

« La source n'a pas répondu » est un fait sur le monde. « Le rendu a levé » est un
fait sur nous. Les deux ne se rendent pas de la même façon.

## 7. Accessibilité — non négociable

- **Focus visible** sur tout élément interactif, avec un contraste réel. Un
  anneau présent mais invisible ne compte pas.
- **`disabled`** est explicite, et la raison du blocage est lisible quelque part.
- **Cibles tactiles** suffisantes en contexte tactile.
- **`aria-current`** sur la navigation : « vous êtes ici » ne peut pas être
  uniquement visuel.
- **Libellés réels** sur les champs. Un `placeholder` n'est pas un label : il
  disparaît à la frappe.
- **Régions vivantes annoncées** : un flux qui progresse sans `aria-live` est
  invisible à un lecteur d'écran.
- **Structure sémantique** : un titre par page, hiérarchie de titres continue,
  tables avec en-têtes réels, listes de définition pour les paires libellé/valeur.

## 8. Preuves visuelles obligatoires

**Toute modification d'une surface de production s'accompagne d'une preuve
visuelle.** Pas d'exception, y compris pour « un petit ajustement ».

- On **ouvre l'écran** et on **regarde** — un typecheck vert ne prouve rien sur
  un rendu. Ce repository a déjà eu un composant mort en runtime avec toutes les
  gates au vert.
- La preuve couvre les **points de rupture réellement supportés**, et l'état de
  la donnée qui a changé (vide, indisponible, plein).
- Une preuve est **datée** et rattachée à la mission.

Aucune gate ne mesure des pixels. C'est précisément pourquoi la preuve est
humaine et obligatoire.

## 9. Exploration — Composer, Lab, Prototype

Ces zones sont **libres** : palettes locales, gradients, composants
expérimentaux, visualisations, animations.

Deux conditions, toutes deux dures :

1. Elles sont **isolées de la production** — non atteignables depuis la
   navigation de production, et leurs données déclarées comme fabriquées quand
   elles le sont.
2. **Aucune exploration ne devient production sans mission explicite.** Une
   trouvaille visuelle n'est jamais promue par glissement. Le passage
   exploration → production est une décision, pas une conséquence.

## 10. Ce qui est interdit

- **Pas de refonte globale non demandée.** Si on demande un bouton, on ne
  redessine pas la page. Une refonte est une mission, pas un effet de bord.
- **Pas de « free design » sur les écrans de production.** L'exploration libre a
  ses zones ; la production a une autorité.
- **Pas de doctrine visuelle importée d'un autre projet.** Les contraintes
  frontend d'Aigent sont validées **dans ce repository**. Une préférence
  esthétique extérieure n'est pas une contrainte produit.
- **Pas de valeur inventée à l'écran.** Une donnée absente se dit absente. C'est
  un invariant produit (`AGENTS.md`) autant qu'une règle de design.

## 11. Doctrine design historique — non applicable

Une ancienne doctrine a gouverné ce repository : zéro-scroll obligatoire,
viewport lock, densité imposée, gates `check:ds` / `check:catalyst`, agent
« Design System Guardian ». **Elle ne gouverne plus Aigent** et ne doit pas
revenir par un document, un agent ou une gate.

Ce fichier ne la restaure pas. Il impose une **autorité sémantique et des
invariants de lecture** ; elle imposait un layout et une densité. La différence
est le §12.

Les documents qui la décrivent encore sont des **archives** et portent un
bandeau. Une archive ne se cite jamais comme règle.

## 12. Ce que ce fichier ne fige pas

Cette doctrine décrit une **direction et des invariants de lecture**. Elle ne
gèle ni un layout précis, ni une typographie, ni une grille, ni une valeur
hexadécimale. Une gate de gouvernance peut vérifier que la doctrine existe et
qu'elle est appliquée comme autorité ; **aucune gate ne doit figer une palette ou
un layout** — ce serait transformer une direction en prison, et empêcher toute
évolution légitime.

