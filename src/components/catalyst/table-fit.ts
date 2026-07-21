// Classe à passer à <Table className={FIT_TABLE}> pour qu'un tableau LARGE
// tienne dans sa colonne sans JAMAIS défiler latéralement (règle absolue).
//
// La primitive Table enveloppe dans `overflow-x-auto whitespace-nowrap` et donne
// `min-w-full` à la table : un tableau à nombreuses colonnes déborde donc et
// scrolle. Ici on force la table à `w-full table-fixed` (colonnes de largeur
// égale, bornées à la largeur du conteneur) et on rend l'espacement `normal`
// pour que les cellules et les en-têtes passent à la ligne au lieu de pousser.
//
// À réserver aux tableaux réellement larges (5+ colonnes) : sur un tableau
// étroit, `table-fixed` gaspillerait l'espace.
export const FIT_TABLE =
  '[&_table]:w-full [&_table]:table-fixed [&_th]:whitespace-normal [&_td]:whitespace-normal [&_td]:break-words [&_td]:align-top'
