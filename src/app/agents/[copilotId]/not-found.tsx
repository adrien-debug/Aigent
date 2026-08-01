import AppShell from '@/components/app-shell'
import { Link } from '@/components/ui/link'
import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'

/**
 * 404 de la fiche d'agent — un copilotId qui ne résout vers AUCUNE ligne.
 *
 * C'est un état distinct de « indisponible » : ici la lecture a RÉUSSI et elle
 * n'a rien trouvé. Le dire franchement évite qu'un identifiant erroné se lise
 * comme une panne de backend, et inversement.
 */
export default function NotFound() {
  return (
    <AppShell>
      <div className="h-full p-4">
        <div className="aig-panel flex h-full items-center justify-center">
          <div className="max-w-md px-6 text-center">
            <Heading level={1}>Agent inconnu</Heading>
            <Text className="mt-2">
              Aucun copilot ne porte cet identifiant. La lecture a abouti — il n’y a réellement pas
              de ligne, ce n’est pas une panne de lecture.
            </Text>
            <Text className="mt-4">
              <Link href="/agents" className="underline">
                Retour au roster
              </Link>
            </Text>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
