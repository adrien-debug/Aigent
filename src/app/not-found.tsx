import AppShell from '@/components/app-shell'
import { Divider } from '@/components/ui/divider'
import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'
import { Unavailable } from '@/components/cockpit/primitives'

/**
 * 404 DANS le shell — un chemin inconnu ne fait pas sortir de la coquille.
 *
 * Complément de `loading.tsx` (l'attente) et `error.tsx` (le rendu interrompu) :
 * ici, ni l'un ni l'autre. La route n'existe simplement pas. Distinguer les
 * trois compte, parce que « rien ne s'affiche » a trois causes très différentes
 * et une seule d'entre elles justifie de réessayer.
 *
 * Contrairement à `error.tsx`, cet écran GARDE le shell : la navigation reste
 * la sortie évidente, et les dix surfaces sont à un clic. `error.tsx` s'en
 * passe délibérément, parce que la panne peut venir du shell lui-même — ce qui
 * n'est jamais le cas d'un 404.
 *
 * Aucun lien fabriqué vers une route devinée, et surtout pas de `/admin` : la
 * console a été supprimée et `check:no-legacy-front` interdit son retour. La
 * sidebar suffit.
 */
export default function NotFound() {
  return (
    <AppShell>
      <div className="h-full overflow-hidden p-4">
        <section className="aig-panel flex h-full min-h-0 flex-col overflow-hidden">
          <header className="shrink-0">
            <div className="px-6 py-4">
              <Heading level={1}>Page introuvable</Heading>
              <Text className="mt-1">
                Cette adresse ne correspond à aucune surface du plan de contrôle.
              </Text>
            </div>
            <Divider soft />
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <div className="mx-auto flex h-full max-w-xl items-center justify-center">
              <div className="w-full">
                <Unavailable
                  reason="no-data"
                  detail="Aucune lecture n'a échoué et rien n'est en panne : le chemin demandé n'existe pas. Les surfaces réellement disponibles sont dans la navigation."
                />
              </div>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  )
}
