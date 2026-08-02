/**
 * Démonstrateur du système de surfaces — AIGENT-DS-SURFACES-001.
 *
 * CE QUE CETTE PAGE EST. Une planche de contrôle du LANGAGE VISUEL : les six
 * rangs de surface, les rangs de texte, l'accent, les états de sévérité et les
 * états d'interaction, posés côte à côte sur une seule page pour qu'un écart
 * se voie sans avoir à ouvrir trois écrans produit.
 *
 * CE QU'ELLE N'EST PAS. Ni une gate, ni un Storybook, ni une doctrine
 * (`AGENTS.md` § Frontend). Elle n'impose rien : elle MONTRE. Si un rang de
 * surface cesse d'être distinguable de son voisin, cette page est l'endroit où
 * on s'en aperçoit — pas un test qui rougit.
 *
 * Elle vit sous `/lab`, donc hors de `NAVIGATION` et hors des surfaces
 * produit : aucune donnée réelle, aucun appel réseau.
 */
import type { ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import { SeverityChip, type SeverityTone } from '@/components/surface-primitives'
import { NotMeasured, Unavailable } from '@/components/cockpit/primitives'

function Row({ title, hint, children }: Readonly<{ title: string; hint?: string; children: ReactNode }>) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="aig-line-soft flex items-baseline justify-between gap-3 border-b pb-2">
        <h2 className="aig-text text-sm font-semibold tracking-[-0.01em]">{title}</h2>
        {hint ? <p className="aig-text-muted text-2xs uppercase tracking-[0.1em]">{hint}</p> : null}
      </div>
      {children}
    </section>
  )
}

/** Un rang de surface, avec le jeton qui le porte — le nom fait partie de la preuve. */
function SurfaceSwatch({
  label,
  token,
  className,
  note,
}: Readonly<{ label: string; token: string; className: string; note: string }>) {
  return (
    <div className={`${className} flex min-h-24 min-w-0 flex-col justify-between rounded-lg p-3`}>
      <div>
        <p className="aig-text text-xs font-semibold">{label}</p>
        <code className="aig-text-muted text-3xs">{token}</code>
      </div>
      <p className="aig-text-muted text-3xs leading-4">{note}</p>
    </div>
  )
}

const TONES: SeverityTone[] = ['good', 'running', 'warn', 'blocked', 'bad', 'neutral']
const TONE_LABEL: Record<SeverityTone, string> = {
  good: 'Terminé',
  running: 'En cours',
  warn: 'À confirmer',
  blocked: 'Bloqué',
  bad: 'Échoué',
  neutral: 'Neutre',
}

export default function SurfaceCatalog() {
  return (
    <div className="aig-subtle min-h-svh w-full overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-9 px-6 py-8">
        <header className="min-w-0">
          <p className="aig-text-muted text-2xs uppercase tracking-[0.18em]">
            Lab · démonstrateur
          </p>
          <h1 className="aig-display mt-1 text-2xl font-semibold">Système de surfaces</h1>
          <p className="aig-text-muted mt-1.5 max-w-2xl text-sm">
            Direction claire : navigation noire, body blanc cassé, texte graphite, accent cuivre
            réservé aux actions et aux états qui appellent un geste. Les rangs se séparent par la
            clarté et le liseré — pas par l&apos;ombre portée.
          </p>
        </header>

        <Row title="Rangs de surface" hint="six niveaux">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <SurfaceSwatch
              label="Surface 0 — canvas"
              token="--aig-subtle"
              className="aig-subtle aig-line-soft border"
              note="Le fond du document."
            />
            <SurfaceSwatch
              label="Surface 1 — contenu"
              token="--aig-base"
              className="aig-base aig-line-soft border"
              note="La zone qui porte le travail."
            />
            <SurfaceSwatch
              label="Surface 2 — panneau"
              token="aig-surface-elevated"
              className="aig-surface-elevated"
              note="Un panneau fonctionnel, séparé par son liseré."
            />
            <SurfaceSwatch
              label="Surface 3 — creux"
              token="aig-inset"
              className="aig-inset"
              note="Descend au lieu de monter : zone de saisie, console."
            />
            <SurfaceSwatch
              label="Overlay"
              token="aig-overlay"
              className="aig-overlay"
              note="Dialog, menu, drawer — le seul rang qui flotte."
            />
            <div className="dark aig-dark aig-subtle aig-line flex min-h-24 min-w-0 flex-col justify-between rounded-lg border p-3">
              <div>
                <p className="aig-text text-xs font-semibold">Sidebar — îlot sombre</p>
                <code className="aig-text-muted text-3xs">.aig-dark</code>
              </div>
              <p className="aig-text-muted text-3xs leading-4">
                Surface indépendante : l&apos;échelle graphite entière survit ici.
              </p>
            </div>
          </div>
        </Row>

        <Row title="Texte" hint="trois rangs, tous ≥ 4.5:1">
          <div className="aig-surface-elevated flex flex-col gap-2 rounded-lg p-4">
            <p className="aig-text text-sm">
              Principal — <code className="text-2xs">--aig-text</code> — porte la donnée.
            </p>
            <p className="aig-text-muted text-sm">
              Secondaire — <code className="text-2xs">--aig-text-muted</code> — situe et qualifie.
            </p>
            <p className="aig-text-muted text-2xs uppercase tracking-[0.1em]">
              Libellé — même jeton, capitales espacées
            </p>
            <p className="aig-accent text-sm">
              Accent — <code className="text-2xs">--aig-accent</code> — action ou état à traiter.
            </p>
          </div>
        </Row>

        <Row title="Sévérité" hint="aplat clair, encre foncée">
          <div className="aig-surface-elevated flex flex-wrap items-center gap-2 rounded-lg p-4">
            {TONES.map((tone) => (
              <SeverityChip key={tone} tone={tone}>
                {TONE_LABEL[tone]}
              </SeverityChip>
            ))}
          </div>
          <p className="aig-text-muted text-2xs">
            Chaque statut voyage TOUJOURS avec son libellé écrit : la teinte seule ne code jamais un
            statut (voir <code>src/lib/cockpit/status.ts</code>).
          </p>
        </Row>

        <Row title="Actions" hint="hover et focus au clavier">
          <div className="aig-surface-elevated flex flex-wrap items-center gap-3 rounded-lg p-4">
            <Button className="aig-btn-accent">Action principale</Button>
            <Button outline>Secondaire</Button>
            <Button plain>Tertiaire</Button>
            <Button disabled className="aig-btn-accent">
              Désactivée
            </Button>
            <a href="#surface-catalog" className="aig-link-accent text-sm">
              Lien accentué
            </a>
          </div>
        </Row>

        <Row title="Formulaire" hint="champs et badges du kit">
          <div className="aig-surface-elevated flex flex-col gap-3 rounded-lg p-4 sm:flex-row sm:items-center">
            <Input aria-label="Champ de démonstration" placeholder="Saisie…" className="sm:max-w-xs" />
            <Input aria-label="Champ désactivé" placeholder="Désactivé" disabled className="sm:max-w-xs" />
            <div className="flex flex-wrap gap-2">
              <Badge>neutre</Badge>
              <Badge color="lime">succès</Badge>
              <Badge color="amber">attention</Badge>
              <Badge color="red">erreur</Badge>
            </div>
          </div>
        </Row>

        <Row title="Absence de mesure" hint="jamais un faux zéro">
          <div className="aig-surface-elevated flex flex-col gap-3 rounded-lg p-4">
            <div className="flex items-baseline gap-2">
              <span className="aig-text-muted text-2xs uppercase tracking-[0.1em]">Coût 24 h</span>
              <NotMeasured why="Aucun run mesuré sur la fenêtre." />
            </div>
            <Unavailable reason="no-data" detail="La lecture a réussi : il n'y avait rien à mesurer." />
            <Unavailable reason="unread" detail="La lecture a échoué — ce n'est pas un zéro." />
            <div className="aig-empty-well">
              <Text className="text-xs">Puits vide — un cadre pointillé, pas un panneau.</Text>
            </div>
          </div>
        </Row>

        <Row title="Séparateurs" hint="filets, pas ombres">
          <div className="aig-surface-elevated flex flex-col gap-4 rounded-lg p-4">
            <div className="aig-hairline" />
            <div className="aig-callout">
              <Text className="text-xs">Encadré — un filet à gauche suffit à mettre à part.</Text>
            </div>
          </div>
        </Row>
      </div>
    </div>
  )
}
