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
import { ErrorMessage, Field, Label } from '@/components/ui/fieldset'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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

/*
 * Décor de démonstration — inerte et assumé comme tel.
 *
 * Aucun de ces contenus ne prétend être une mesure : ils existent pour que les
 * surfaces aient quelque chose à porter. Les noms restent volontairement
 * génériques afin qu'on ne les confonde jamais avec un agent réel du catalogue.
 */
const DEMO_ROWS: ReadonlyArray<{ agent: string; tone: SeverityTone; duration: string }> = [
  { agent: 'Agent de démonstration A', tone: 'good', duration: '4,3 s' },
  { agent: 'Agent de démonstration B', tone: 'running', duration: '12,1 s' },
  { agent: 'Agent de démonstration C', tone: 'bad', duration: '0,9 s' },
]

const DEMO_PROJECTS: ReadonlyArray<{
  name: string
  agents: number
  note: string
  tone: SeverityTone
}> = [
  { name: 'Projet de démonstration', agents: 4, note: 'Une carte se justifie ici : elle groupe un titre, un compte et une action.', tone: 'good' },
  { name: 'Projet en attente', agents: 2, note: 'Le liseré suffit à séparer — aucune ombre portée.', tone: 'warn' },
  { name: 'Projet vide', agents: 0, note: 'Un compte à zéro est une mesure réelle, pas une absence.', tone: 'neutral' },
]

/** Tracé fixe : une forme, jamais une série de mesures. */
const DEMO_LINE =
  'M0,96 L75,84 L150,88 L225,58 L300,66 L375,38 L450,46 L525,22 L600,30'

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
            <Button>Action principale</Button>
            <Button outline>Secondaire</Button>
            <Button plain>Tertiaire</Button>
            <Button disabled>
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

        <Row title="Tableau" hint="filets horizontaux, zéro zébrure">
          <div className="aig-surface-elevated overflow-x-auto rounded-lg p-1.5">
            <Table dense>
              <TableHead>
                <TableRow>
                  <TableHeader>Agent</TableHeader>
                  <TableHeader>Statut</TableHeader>
                  <TableHeader className="text-right">Durée</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {DEMO_ROWS.map((row) => (
                  <TableRow key={row.agent}>
                    <TableCell className="font-medium">{row.agent}</TableCell>
                    <TableCell>
                      <SeverityChip tone={row.tone}>{TONE_LABEL[row.tone]}</SeverityChip>
                    </TableCell>
                    <TableCell className="aig-text-muted text-right tabular-nums">
                      {row.duration}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="aig-text-muted text-2xs">
            Sur fond clair, une zébrure ajoute un troisième gris qui n&apos;informe de rien : la
            lecture ligne à ligne tient au filet horizontal seul.
          </p>
        </Row>

        <Row title="Cartes projet" hint="une carte quand elle porte une fonction">
          <div className="grid gap-3 sm:grid-cols-3">
            {DEMO_PROJECTS.map((project) => (
              <div key={project.name} className="aig-surface-elevated flex flex-col gap-2 rounded-lg p-3.5">
                <div className="flex min-w-0 items-baseline justify-between gap-2">
                  <p className="aig-text truncate text-sm font-semibold">{project.name}</p>
                  <span className="aig-text-muted shrink-0 text-3xs tabular-nums">
                    {project.agents} agents
                  </span>
                </div>
                <p className="aig-text-muted text-2xs leading-4">{project.note}</p>
                <div className="aig-hairline" />
                <div className="flex items-center justify-between gap-2">
                  <SeverityChip tone={project.tone}>{TONE_LABEL[project.tone]}</SeverityChip>
                  <span className="aig-link-accent text-2xs">Ouvrir →</span>
                </div>
              </div>
            ))}
          </div>
        </Row>

        <Row title="Graphique" hint="cuivre, aplat dégradé, pas de grille lourde">
          {/*
            Une courbe INERTE et nommée comme telle : ces points sont une forme
            de démonstration, pas une mesure. Un graphique de lab qui ressemble
            à une donnée réelle est exactement le genre de faux zéro que
            `check:render-truth` interdit ailleurs dans le produit.
          */}
          <figure className="aig-surface-elevated rounded-lg p-4">
            <svg
              viewBox="0 0 600 120"
              role="img"
              aria-label="Courbe de démonstration — forme inerte, aucune mesure"
              className="h-28 w-full"
            >
              <defs>
                <linearGradient id="catalog-area" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="var(--aig-accent)" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="var(--aig-accent)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={`${DEMO_LINE} L600,120 L0,120 Z`} fill="url(#catalog-area)" />
              <path
                d={DEMO_LINE}
                fill="none"
                stroke="var(--aig-accent)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <figcaption className="aig-text-muted mt-2 text-2xs">
              Forme de démonstration — aucune donnée réelle n&apos;est tracée ici.
            </figcaption>
          </figure>
        </Row>

        <Row title="Chargement" hint="squelette, jamais un zéro affiché">
          {/*
            Le squelette existe pour que l'attente ne s'écrive PAS « 0 ». Un
            compteur à zéro pendant le chargement est une mesure fausse ; un
            aplat neutre ne dit rien, ce qui est exact.
          */}
          <div className="aig-surface-elevated flex flex-col gap-3 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="aig-skeleton-bar h-9 w-9 shrink-0 rounded-md" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="aig-skeleton-bar h-3 w-2/5 rounded-sm" />
                <div className="aig-skeleton-bar h-2.5 w-1/4 rounded-sm" />
              </div>
            </div>
            <div className="aig-skeleton-bar h-2.5 w-full rounded-sm" />
            <div className="aig-skeleton-bar h-2.5 w-4/5 rounded-sm" />
            <p className="aig-text-muted text-2xs">
              Aucun chiffre pendant l&apos;attente : une valeur non lue ne s&apos;affiche jamais.
            </p>
          </div>
        </Row>

        <Row title="Erreur" hint="deux registres, jamais confondus">
          {/*
            DEUX ERREURS DIFFÉRENTES, et les confondre coûte cher.

            · L'ÉCHEC DE LECTURE dit « je n'ai pas pu savoir ». Il ne se rend
              jamais en rouge vif : rien n'est cassé côté opérateur, et le
              peindre comme un incident déclencherait des gestes inutiles.
              C'est `Unavailable reason="unread"` — le même composant que
              partout ailleurs dans le produit.

            · L'ERREUR DE SAISIE dit « corrige ceci ». Elle est actionnable,
              donc elle porte la sévérité `bad` en variante ENCRE
              (`--aig-severity-bad-ink`) : la teinte nue est calibrée pour
              émettre sur graphite et tombe à 2.79:1 sur fond clair.

            Le liseré du champ passe lui aussi en `bad-ink` : l'erreur ne doit
            pas reposer sur la seule couleur du texte d'aide, sinon elle
            disparaît pour qui ne distingue pas le rouge.
          */}
          <div className="aig-surface-elevated flex flex-col gap-4 rounded-lg p-4">
            <div className="flex flex-col gap-1.5">
              <p className="aig-text-muted text-2xs uppercase tracking-[0.1em]">
                Lecture impossible
              </p>
              <Unavailable
                reason="unread"
                detail="Le backend n'a pas répondu — ce n'est pas un zéro."
              />
            </div>

            <Field>
              <Label className="aig-text text-xs font-medium">Budget maximal (USD)</Label>
              <Input
                aria-label="Budget maximal"
                aria-invalid
                defaultValue="-12"
                className="sm:max-w-xs"
                style={{ borderColor: 'var(--aig-severity-bad-ink)' }}
              />
              <ErrorMessage style={{ color: 'var(--aig-severity-bad-ink)' }}>
                Un budget ne peut pas être négatif.
              </ErrorMessage>
            </Field>

            <div className="flex flex-wrap items-center gap-2">
              <SeverityChip tone="bad">Échoué</SeverityChip>
              <span className="aig-text-muted text-2xs">
                L&apos;état d&apos;échec porte toujours son libellé écrit — la teinte seule ne
                code jamais un statut.
              </span>
            </div>
          </div>
        </Row>

        <Row title="Overlay" hint="dialog, menu, drawer — le seul rang qui flotte">
          {/*
            Rendu STATIQUE : `Dialog` du kit est piloté par état et ne peut pas
            s'ouvrir dans une page serveur. Ce qui est démontré ici est la
            SURFACE (`aig-overlay` + son ombre), pas le comportement — c'est
            précisément ce que la mission demande de calibrer.
          */}
          <div className="aig-inset relative overflow-hidden rounded-lg p-6">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="aig-overlay flex flex-col gap-2 rounded-lg p-4">
                <p className="aig-text text-sm font-semibold">Confirmer la promotion</p>
                <p className="aig-text-muted text-2xs leading-4">
                  Un dialog flotte au-dessus du document : c&apos;est le seul rang autorisé à porter
                  une vraie ombre.
                </p>
                <div className="mt-1 flex gap-2">
                  <Button>Promouvoir</Button>
                  <Button outline>Annuler</Button>
                </div>
              </div>
              <div className="aig-overlay flex flex-col rounded-lg p-1.5">
                {['Ouvrir la fiche', 'Relancer le run', 'Voir les preuves'].map((item) => (
                  <span key={item} className="aig-text rounded-sm px-2.5 py-1.5 text-xs">
                    {item}
                  </span>
                ))}
                <div className="aig-hairline my-1" />
                <span className="aig-text-muted px-2.5 py-1.5 text-xs">Menu — même surface</span>
              </div>
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
