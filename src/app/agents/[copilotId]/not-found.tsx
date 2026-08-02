import AppShell from '@/components/app-shell'
import { navEntry } from '@/components/navigation'
import { SurfaceNotFound } from '@/components/surface-shell'
import { Link } from '@/components/ui/link'

/**
 * 404 de la fiche d'agent — un copilotId qui ne résout vers AUCUNE ligne.
 *
 * C'est un état distinct de « indisponible » : ici la lecture a RÉUSSI et elle
 * n'a rien trouvé. Le dire franchement évite qu'un identifiant erroné se lise
 * comme une panne de backend, et inversement.
 */
const ENTRY = navEntry('/agents')

export default function NotFound() {
  return (
    <AppShell>
      <SurfaceNotFound
        title={ENTRY.name}
        description={ENTRY.purpose}
        detail="Aucun copilot ne porte cet identifiant. La lecture a abouti — il n’y a réellement pas de ligne, ce n’est pas une panne de lecture."
      >
        <Link href="/agents" className="underline">
          Retour au roster
        </Link>
      </SurfaceNotFound>
    </AppShell>
  )
}
