/**
 * L'écran du laboratoire — la vitrine des patterns d'interaction.
 *
 * Server Component : il ne lit rien, il compose. Les seuls modules clients sont
 * les patterns eux-mêmes, parce que Motion mesure le DOM. Aucune prop fonction
 * ne descend vers eux (`check:rsc-boundary`).
 *
 * CE QUE CHAQUE FICHE DIT, ET POURQUOI
 * ------------------------------------
 * Un pattern n'est pas jugé sur son effet mais sur son COÛT et sa
 * CONTREPARTIE. Une vitrine qui ne montrerait que le mouvement pousserait à
 * adopter des interactions dont personne n'a mesuré le prix — c'est ainsi
 * qu'on se retrouve avec un système de jetons que plus aucun écran ne consomme.
 * Chaque fiche porte donc les deux, et l'état `adopted` porte en plus le chemin
 * du consommateur réel, pour être vérifiable plutôt que cru.
 */
import { Badge } from '@/components/ui/badge'
import { Divider } from '@/components/ui/divider'
import { Heading } from '@/components/ui/heading'
import { Strong, Text } from '@/components/ui/text'
import { Panel } from '@/components/cockpit/primitives'
import {
  LAB_PATTERNS,
  PATTERN_STATUS_LABEL,
  PATTERN_STATUS_MEANING,
  countByStatus,
  type LabPattern,
} from './registry'
import PatternCluster from './pattern-cluster'
import PatternMorph from './pattern-morph'

const STATUS_COLOR: Record<LabPattern['status'], 'emerald' | 'sky' | 'zinc'> = {
  adopted: 'emerald',
  candidate: 'sky',
  exploration: 'zinc',
}

/** Le rendu d'un pattern : sa démo, puis ce qu'il en coûte. */
function PatternCard({
  pattern,
  children,
}: Readonly<{ pattern: LabPattern; children?: React.ReactNode }>) {
  return (
    <Panel
      title={pattern.name}
      hint={PATTERN_STATUS_LABEL[pattern.status]}
      className="scroll-mt-4"
      padded={false}
    >
      <div className="px-4 pt-3 pb-1">
        <Text className="text-sm">{pattern.purpose}</Text>
      </div>

      {children ? (
        <div className="mx-4 mt-3 overflow-hidden rounded-lg bg-zinc-950/2.5 dark:bg-white/5">
          {children}
        </div>
      ) : (
        <div className="mx-4 mt-3 rounded-lg border border-dashed border-zinc-950/10 px-4 py-6 text-center dark:border-white/10">
          <Text className="text-xs">
            Pas de démo ici — ce pattern se regarde dans le produit, à l’endroit où il sert.
          </Text>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-2 px-4 pb-4">
        <Divider soft />
        <div className="flex items-start gap-2 pt-1">
          <Badge color={STATUS_COLOR[pattern.status]} title={PATTERN_STATUS_MEANING[pattern.status]}>
            {PATTERN_STATUS_LABEL[pattern.status]}
          </Badge>
          {pattern.usedBy ? (
            <Text className="min-w-0 font-mono text-2xs break-all">{pattern.usedBy}</Text>
          ) : null}
        </div>

        <div>
          <Strong className="block text-xs uppercase">Coût</Strong>
          <Text className="text-sm">{pattern.cost}</Text>
        </div>

        <div>
          <Strong className="block text-xs uppercase">Contrepartie</Strong>
          <Text className="text-sm">{pattern.caveat}</Text>
        </div>
      </div>
    </Panel>
  )
}

export default function LabScreen() {
  const counts = countByStatus()
  const byId = new Map(LAB_PATTERNS.map((p) => [p.id, p]))

  const morph = byId.get('morph')
  const cluster = byId.get('folder')
  const indicator = byId.get('indicator')
  const stagger = byId.get('stagger')

  return (
    <div className="shell-page-document max-lg:pl-14">
      <header className="pb-4">
        <Heading level={1}>Laboratoire d’interaction</Heading>
        <Text className="mt-1">
          Un banc d’essai pour les patterns d’interaction, avant qu’ils entrent — ou non — dans une
          surface produit.
        </Text>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge color="emerald">{counts.adopted} en production</Badge>
          <Badge color="sky">{counts.candidate} candidat(s)</Badge>
          <Badge color="zinc">{counts.exploration} exploration(s)</Badge>
        </div>
        <Divider soft className="mt-4" />
      </header>

      <div className="flex flex-col gap-4 pb-4">
        <Panel title="Ce que cette page est, et n’est pas" padded>
          <div className="flex flex-col gap-2">
            <Text className="text-sm">
              Les données affichées ici sont <Strong>inventées</Strong> — aucun appel réseau, aucune
              lecture de la flotte. Un banc d’essai qui interrogerait la production mentirait deux
              fois : sur la charge qu’il crée, et sur ce que l’écran montre.
            </Text>
            <Text className="text-sm">
              Cette page n’est pas dans la navigation et n’a pas vocation à y entrer. Elle ne pose
              aucune règle : rien de ce qui est montré ici n’est imposé à un écran produit.
            </Text>
          </div>
        </Panel>

        <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
          <div className="flex flex-col gap-4">
            {morph ? (
              <PatternCard pattern={morph}>
                <PatternMorph />
              </PatternCard>
            ) : null}
            {indicator ? <PatternCard pattern={indicator} /> : null}
          </div>

          <div className="flex flex-col gap-4">
            {cluster ? (
              <PatternCard pattern={cluster}>
                <PatternCluster />
              </PatternCard>
            ) : null}
            {stagger ? <PatternCard pattern={stagger} /> : null}
          </div>
        </div>
      </div>
    </div>
  )
}
