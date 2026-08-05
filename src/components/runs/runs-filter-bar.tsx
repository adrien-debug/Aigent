'use client'

/**
 * Barre de filtres de `/runs` — Agent, Projet, et le geste de remise à zéro.
 *
 * POURQUOI CE COMPOSANT EST CLIENT, alors que tout le reste de l'écran est
 * serveur. Un changement de filtre passé par un lien provoquerait une
 * navigation document complète — écran blanc, scroll perdu, sélection de run
 * perdue. `useRouter().push()` fait la même navigation côté client, en
 * conservant l'arbre React monté. Le `Link` kit est branché sur `next/link`
 * (soft nav) ; ici on pousse l'URL pour préserver l'état client local.
 *
 * CE QU'IL NE FAIT PAS. Il ne filtre rien. Il n'a aucune copie de la liste de
 * runs, aucun `useState` de résultats, aucun second `applyRunsFilters`. Il écrit
 * une URL, et c'est le Server Component qui relit cette URL avec l'unique
 * parseur. L'état de filtre vit donc dans l'URL et nulle part ailleurs : un lien
 * collé reproduit exactement la même vue, et le bouton retour du navigateur
 * défait un filtre.
 *
 * FRONTIÈRE RSC. Toutes les props sont sérialisables — des tableaux
 * `{id, name}` et des chaînes. Aucune fonction ne traverse la frontière
 * (`check:rsc-boundary`), et c'est pour cela que l'URL courante est reconstruite
 * ici à partir de l'état reçu plutôt que par un `buildHref` passé du serveur.
 */
import { useId } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import {
  buildRunsHref,
  hasActiveFilters,
  type RunsFilterState,
} from '@/lib/runs-console/runs-filters'

/** Une option de filtre : l'id qui va dans l'URL, le nom qui s'affiche. */
export type FilterOption = Readonly<{ id: string; name: string }>

/**
 * Select Catalyst (`ui/select`) — ordre DESIGN_DOCTRINE §3.
 *
 * Le `<label>` est réel et lié par `htmlFor` : un `placeholder` disparaît à la
 * frappe et ne nomme pas un champ (`DESIGN_DOCTRINE.md` §7).
 */
function FilterSelect({
  label,
  value,
  options,
  emptyLabel,
  onChange,
}: Readonly<{
  label: string
  value: string
  options: readonly FilterOption[]
  /** Ce que dit l'option « pas de filtre » — jamais une chaîne vide muette. */
  emptyLabel: string
  onChange: (next: string) => void
}>) {
  const id = useId()

  /**
   * Une valeur présente dans l'URL mais absente des options rendues est
   * CONSERVÉE comme option explicite, jamais réécrite en « tous ».
   *
   * Le cas est réel : un agent dont aucun run n'est tombé dans la fenêtre de
   * 24 h n'apparaît pas dans les options dérivées des runs. Sans cette ligne, le
   * select afficherait « Tous les agents » pendant que la page filtre bel et
   * bien sur cet agent — l'écran mentirait sur ce qu'il montre.
   */
  const orphan = value !== '' && !options.some((option) => option.id === value)

  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <label htmlFor={id} className="aig-text-faint shrink-0 text-2xs tracking-[0.14em] uppercase">
        {label}
      </label>
      <Select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 max-w-[16ch]"
      >
        <option value="">{emptyLabel}</option>
        {orphan ? <option value={value}>{value} (hors fenêtre)</option> : null}
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </Select>
    </span>
  )
}

export default function RunsFilterBar({
  filters,
  agentOptions,
  projectOptions,
  selectedRunId,
}: Readonly<{
  /** L'état DÉJÀ parsé par le serveur — jamais reparsé ici. */
  filters: RunsFilterState
  agentOptions: readonly FilterOption[]
  projectOptions: readonly FilterOption[]
  /** Sélection courante, préservée à travers un changement de filtre. */
  selectedRunId: string | null
}>) {
  const router = useRouter()
  const active = hasActiveFilters(filters)

  /**
   * Un changement de filtre PRÉSERVE la sélection de run. Elle sera peut-être
   * hors du nouveau sous-ensemble : le panneau de détail le dit alors lui-même
   * (« pas dans la fenêtre chargée ») plutôt que de disparaître sans un mot.
   */
  const go = (patch: Partial<RunsFilterState>) => {
    router.push(buildRunsHref({ ...filters, ...patch }, selectedRunId))
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <FilterSelect
        label="Agent"
        value={filters.agent}
        options={agentOptions}
        emptyLabel="Tous les agents"
        onChange={(agent) => go({ agent })}
      />
      <FilterSelect
        label="Projet"
        value={filters.project}
        options={projectOptions}
        emptyLabel="Tous les projets"
        onChange={(project) => go({ project })}
      />

      {/*
        Le geste de sortie n'apparaît QUE lorsqu'il y a quelque chose à défaire.
        Un bouton « réinitialiser » toujours visible sur une vue non filtrée est
        une affordance qui ne fait rien — le défaut d'affordance que cet écran
        refuse déjà par ailleurs (aucun bouton de mutation inerte).
      */}
      {active ? (
        <Button
          type="button"
          plain
          onClick={() => router.push(buildRunsHref({ ...filters, agent: '', project: '' }, selectedRunId))}
          className="aig-accent text-xs font-medium"
        >
          Voir tous les runs
        </Button>
      ) : null}
    </div>
  )
}
