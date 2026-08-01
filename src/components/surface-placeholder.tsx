/**
 * Surface NOMMÉE mais NON CONSTRUITE — l'état honnête d'une route de PR 1.
 *
 * Ces pages existent pour une seule raison : remplacer les entrées de
 * navigation inertes (`<SidebarItem disabled>`) par de vrais liens. Une route
 * qui existe et qui dit « je ne lis rien » est meilleure qu'un bouton grisé qui
 * ne dit rien du tout — l'opérateur voit la carte du produit ET peut y aller.
 *
 * CE QUE CE COMPOSANT NE FAIT PAS, ET NE DOIT JAMAIS FAIRE
 * -------------------------------------------------------
 * Il ne lit AUCUNE donnée. Pas de KPI, pas de compteur, pas de graphique, pas
 * de squelette de cartes suggérant un contenu à venir. Un placeholder qui
 * esquisse des tuiles vides laisse croire qu'une lecture a eu lieu et a rendu
 * zéro — exactement le faux zéro que `AGENTS.md` § Vérité des données interdit.
 * Il affiche : le nom de la surface, ce qu'elle portera, le fait qu'elle n'est
 * pas branchée, et la PR qui la branchera.
 *
 * Il rend l'état `not-configured` de `SurfaceState` — celui dont le blueprint
 * dit « le branchement manque », et non « la lecture a échoué » (`unavailable`)
 * ni « la lecture a abouti sur rien » (`empty`). C'est exactement la troisième
 * situation : aucune lecture n'a été TENTÉE. L'état porte donc la nuance dans
 * son geste ET dans son texte, au lieu de la laisser au seul paragraphe.
 */
import { Text } from '@/components/ui/text'
import { PageBody, PageHeader } from '@/components/app-shell'
import SurfaceState from '@/components/surface-state'

export default function SurfacePlaceholder({
  title,
  purpose,
  plannedIn,
}: Readonly<{
  /** Le libellé EXACT de l'entrée de navigation — jamais une variante. */
  title: string
  /** Ce que la surface portera une fois construite. */
  purpose: string
  /** La PR de la restauration produit qui la branchera. */
  plannedIn: string
}>) {
  return (
    // L'en-tête et la gouttière viennent du shell (`PageHeader`/`PageBody`) :
    // cet écran n'a plus de géométrie à lui.
    <>
      <PageHeader title={title} description={purpose} />
      <PageBody>
        <section className="aig-panel flex flex-col">
          {/*
           * `not-configured` PLUTÔT QUE `loading` OU `empty`.
           *
           * Le blueprint dit la bonne chose : le branchement MANQUE, il n'est
           * pas cassé et rien n'est en cours. Un état de chargement ici
           * laisserait croire qu'une lecture est partie ; un état vide
           * laisserait croire qu'elle a abouti sur zéro. C'est la troisième
           * situation — aucune lecture n'a été TENTÉE.
           */}
          <SurfaceState
            kind="not-configured"
            detail="Cette surface est nommée, pas encore construite. Aucune lecture n'a été tentée : ce que vous voyez n'est pas un état vide de la flotte, c'est l'absence d'écran."
          />
          <Text className="pb-8 text-center">
            Branchement prévu par <strong className="font-medium">{plannedIn}</strong> de la
            restauration produit.
          </Text>
        </section>
      </PageBody>
    </>
  )
}
