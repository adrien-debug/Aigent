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
 * Il est composé à partir du kit `ui/` (`Heading`, `Text`, `Divider`) plus
 * `Unavailable`, l'objet métier qui encode déjà la distinction
 * « lecture échouée » / « rien à mesurer ». Ici c'est la troisième situation —
 * ni l'une ni l'autre : aucune lecture n'a été TENTÉE. `reason="no-data"` est le
 * plus proche (pas d'échec de backend à signaler) et le texte lève l'ambiguïté
 * explicitement, plutôt que d'inventer une quatrième raison dans le kit métier.
 */
import { Divider } from '@/components/ui/divider'
import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'
import { Unavailable } from '@/components/cockpit/primitives'

export default function SurfacePlaceholder({
  title,
  purpose,
  plannedIn,
}: {
  /** Le libellé EXACT de l'entrée de navigation — jamais une variante. */
  title: string
  /** Ce que la surface portera une fois construite. */
  purpose: string
  /** La PR de la restauration produit qui la branchera. */
  plannedIn: string
}) {
  return (
    // `h-full overflow-hidden` : la page ne pousse jamais le shell hors du
    // viewport. Le contenu tient largement ; le `overflow-y-auto` interne est le
    // repli sur un viewport très court, et il défile DANS la boîte.
    <div className="h-full overflow-hidden p-4">
      <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-white shadow-xs ring-1 ring-zinc-950/5 dark:bg-zinc-900 dark:ring-white/10">
        <header className="shrink-0">
          <div className="px-6 py-4">
            <Heading level={1}>{title}</Heading>
            <Text className="mt-1">{purpose}</Text>
          </div>
          <Divider soft />
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="mx-auto flex h-full max-w-xl items-center justify-center">
            <div className="w-full">
              <Unavailable
                reason="no-data"
                detail="Cette surface est nommée, pas encore construite. Aucune lecture n'a été tentée : ce que vous voyez n'est pas un état vide de la flotte, c'est l'absence d'écran."
              />
              <Text className="mt-4 text-center">
                Branchement prévu par <strong className="font-medium">{plannedIn}</strong> de la
                restauration produit.
              </Text>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
