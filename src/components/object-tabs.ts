/**
 * Les onglets des fiches Agent et Projet — donnée pure, aucun rendu.
 *
 * AIGENT-UX-IA-001 (#93). Ce fichier est la table de correspondance entre les
 * anciennes entrées globales et leur nouveau contexte. Il vit à part du rendu
 * pour la même raison que `navigation.ts` : une page serveur doit pouvoir
 * nommer un onglet sans importer un composant client.
 *
 * CHAQUE `href` EST UNE ROUTE QUI EXISTE DÉJÀ. Aucun onglet n'invente d'écran :
 * « Qualification » sur une fiche Agent mène à `/qualification/:id`, qui porte
 * déjà tout le contenu. On rattache, on ne réimplémente pas — c'est ce qui
 * permet de passer de onze entrées à six sans perdre une capacité.
 *
 * Les liens restent une donnée pure partagée par les pages serveur.
 */

export type ObjectTab = {
  id: string
  name: string
  href: string
  purpose: string
}

/* ─────────────────────────────── Fiche Agent ─────────────────────────────── */

/**
 * Sept onglets, dans l'ordre du cycle de vie d'un agent : ce qu'il est
 * (Vue générale, Configuration), ce qu'il fait (Runtime), ce qu'il vaut
 * (Qualification, Learning), ce qu'on en livre (Livraisons), et ce qu'il a fait
 * (Historique).
 *
 * `Vue générale` et `Configuration` partagent la même route : la fiche porte
 * déjà les deux, la seconde étant une section de la première. Les distinguer
 * dans la barre serait promettre deux écrans là où il y en a un — on garde donc
 * un seul onglet tant que la fiche n'est pas scindée.
 */
export function agentTabs(copilotId: string): readonly ObjectTab[] {
  return [
    {
      id: 'overview',
      name: 'Vue générale',
      href: `/agents/${copilotId}`,
      purpose: "L'état de service, la configuration résolue et l'activité récente.",
    },
    {
      id: 'runtime',
      name: 'Runtime',
      href: '/runtime',
      purpose: 'Le canal de télémétrie et les événements remontés par les agents déployés.',
    },
    {
      id: 'qualification',
      name: 'Qualification',
      href: `/qualification/${copilotId}`,
      purpose: 'Tests, benchmarks, release gate et promotion de version.',
    },
    {
      id: 'learning',
      name: 'Learning',
      href: '/learning',
      purpose: "File de revue, état des évaluations et boucle d'amélioration.",
    },
    {
      id: 'delivery',
      name: 'Livraisons',
      href: `/delivery/${copilotId}`,
      purpose: 'Poussées vers les dépôts consommateurs, PR ouvertes, sandbox.',
    },
    {
      id: 'runs',
      name: 'Historique',
      // `agent=` est le nom canonique du filtre (`runs-filters.ts`). L'ancien
      // `copilot=` reste accepté par le parseur — les liens déjà partagés
      // continuent de marcher — mais on n'en émet plus de nouveaux.
      href: `/runs?agent=${encodeURIComponent(copilotId)}`,
      purpose: 'Les exécutions de cet agent : statut, latence, coût, outils appelés.',
    },
  ] as const
}
/* ─────────────────────────────── Fiche Projet ────────────────────────────── */

/**
 * Six onglets. « Agents liés » et « Activité » vivent dans la fiche elle-même ;
 * « Runs », « Livraisons » et « Support » mènent aux surfaces qui portent déjà
 * ces vues, filtrées sur le projet quand la route le permet.
 */
export function projectTabs(projectId: string): readonly ObjectTab[] {
  return [
    {
      id: 'overview',
      name: 'Vue projet',
      href: `/projects/${projectId}`,
      purpose: "L'identité du projet, son dépôt cible et son activité.",
    },
    {
      id: 'agents',
      name: 'Agents liés',
      href: `/agents?project=${encodeURIComponent(projectId)}`,
      purpose: 'Les copilotes rattachés à ce projet et leur santé.',
    },
    {
      id: 'runs',
      name: 'Runs',
      href: `/runs?project=${encodeURIComponent(projectId)}`,
      purpose: 'Les exécutions rattachées à ce projet.',
    },
    {
      id: 'builder',
      name: 'Builder',
      href: `/builder/${projectId}`,
      purpose: "Conversation d'authoring : architecte, manifeste, matérialisation.",
    },
    {
      id: 'delivery',
      name: 'Livraisons',
      href: '/delivery',
      purpose: 'Poussées vers les dépôts consommateurs et PR ouvertes.',
    },
    {
      id: 'support',
      name: 'Support',
      href: '/support',
      purpose: 'Ce qui demande une intervention sur la flotte.',
    },
  ] as const
}
