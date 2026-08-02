import AppShell, { PageBody, PageHeader } from '@/components/app-shell'
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
      <PageHeader
        title="Page introuvable"
        description="Cette adresse ne correspond à aucune surface du plan de contrôle."
      />
      <PageBody>
        <Unavailable
          block
          reason="no-data"
          detail="Aucune lecture n'a échoué et rien n'est en panne : le chemin demandé n'existe pas. Les surfaces réellement disponibles sont dans la navigation."
        />
      </PageBody>
    </AppShell>
  )
}
