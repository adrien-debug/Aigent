import AppShell from '@/components/app-shell'
import ActionQueue from '@/components/cockpit/action-queue'
import CockpitOverview from '@/components/cockpit/overview-screen'
import TopBar from '@/components/cockpit/topbar'
import { Unavailable } from '@/components/cockpit/primitives'
import { Text } from '@/components/ui/text'
import { getDashboardOverview } from '@/lib/agent-mission-control/dashboard-overview'

// Le cockpit lit l'état vivant de la flotte : jamais de cache statique.
export const dynamic = 'force-dynamic'

/**
 * L'instant est capturé HORS du rendu : `Date.now()` appelé pendant le rendu est
 * impur (react-hooks/purity) et rendrait le composant non idempotent. Le même
 * instant sert à la lecture et aux séries, pour que KPI et graphes décrivent
 * exactement la même fenêtre.
 */
async function loadCockpit() {
  const nowMs = Date.now()
  try {
    return { nowMs, overview: await getDashboardOverview(nowMs), failure: null as string | null }
  } catch (err) {
    return {
      nowMs,
      overview: null,
      failure: err instanceof Error ? err.message : 'lecture impossible',
    }
  }
}

export default async function HomePage() {
  const { nowMs, overview, failure } = await loadCockpit()

  // Backend muet : l'écran ne dégrade pas en zéros, il DIT qu'il ne sait pas.
  // La barre d'état disparaît avec lui — elle n'a rien de réel à afficher.
  if (overview === null) {
    return (
      <AppShell>
        <div className="h-full p-4">
          <div className="flex h-full items-center justify-center rounded-lg bg-white shadow-xs ring-1 ring-zinc-950/5 dark:bg-zinc-900 dark:ring-white/10">
            <div className="max-w-md px-6 text-center">
              <Unavailable
                reason="unread"
                detail="Le backend n'a pas répondu. Aucun chiffre n'est affiché — un cockpit qui invente des valeurs est plus dangereux qu'un cockpit vide."
              />
              {failure ? <Text className="mt-3">{failure}</Text> : null}
            </div>
          </div>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell
      topbar={<TopBar overview={overview} />}
      aside={<ActionQueue items={overview.actionItems} />}
    >
      <CockpitOverview overview={overview} nowMs={nowMs} />
    </AppShell>
  )
}
