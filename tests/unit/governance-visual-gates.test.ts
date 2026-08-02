import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const GATE_LEGACY = join(ROOT, 'scripts/check-no-legacy-design-governance.mjs')
const GATE_VISUAL = join(ROOT, 'scripts/check-production-visual-authority.mjs')
const GATE_UI = join(ROOT, 'scripts/check-ui-kit-integrity.mjs')

const tempDirs: string[] = []

function makeWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), 'aigent-gov-015-'))
  tempDirs.push(dir)
  return dir
}

function put(root: string, rel: string, content: string) {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), content)
}

function run(script: string, cwd: string) {
  return spawnSync(process.execPath, [script], { cwd, encoding: 'utf8' })
}

function seedLegacyBase(root: string) {
  put(
    root,
    'docs/cockpit-catalyst-migration.md',
    "# x\n\nCE DOCUMENT N'EST PLUS UNE RÈGLE\n\nNON APPLICABLE\n",
  )
  put(
    root,
    'package.json',
    JSON.stringify(
      { scripts: { check: 'npm run check:no-legacy-design-governance && npm run check:production-visual-authority' } },
      null,
      2,
    ),
  )
  put(root, 'CLAUDE.md', 'gouvernance locale\n')
  put(root, 'AGENTS.md', 'Doctrine design historique — non applicable\n')
  for (const file of [
    'src/lib/agent-mission-control/repo-suite-context.ts',
    'src/lib/agent-mission-control/repo-risk-coverage.ts',
    'src/lib/agent-mission-control/repo-intelligence.ts',
    'src/lib/agent-mission-control/mission-orchestrator.ts',
    'src/lib/agent-mission-control/target-repo-sandbox.ts',
    'src/lib/agent-mission-control/agent-builder-run.ts',
  ]) {
    put(root, file, 'export const ok = true\n')
  }
}

function seedVisualBase(root: string) {
  put(root, 'src/app/page.tsx', "export default function Page(){return <main className='text-(--aig-text)'>ok</main>}\n")
  put(root, 'src/components/runs/runs-screen.tsx', "export function Runs(){return <div className='text-(--aig-text)'>runs</div>}\n")
}

function seedUiKitBase(root: string) {
  put(root, 'src/components/ui/avatar.tsx', 'export function Avatar(){return null}\n')
  put(
    root,
    'src/components/ui/badge.tsx',
    "export function Badge(){return <span className='focus-visible:ring-2'/>}\nexport function BadgeButton(){return null}\n",
  )
  put(
    root,
    'src/components/ui/button.tsx',
    [
      'export function Button(){return <TouchTarget>ok</TouchTarget>}',
      'export function TouchTarget({children}:{children:unknown}){',
      "  return <span className='absolute pointer-fine:hidden size-[max(100%,2.75rem)] focus-visible:ring-2 forced-colors:text-[ButtonText] data-disabled:opacity-50'>{children as never}</span>",
      '}',
      '',
    ].join('\n'),
  )
  put(
    root,
    'src/components/ui/checkbox.tsx',
    "export function Checkbox(){return <span className='focus-visible:ring-2 forced-colors:text-[ButtonText]'/>}\nexport function CheckboxField(){return null}\nexport function CheckboxGroup(){return null}\n",
  )
  // Ce fixture doit porter TOUTES les primitives exigées par `REQUIRED` dans
  // `check-ui-kit-integrity.mjs`. Il en manquait une — `description-list` — et
  // le test « garde-fous conservés » échouait donc sur PRIMITIVE MANQUANTE,
  // c'est-à-dire sur une lacune du fixture, pas sur le comportement testé.
  put(root, 'src/components/ui/description-list.tsx', 'export function DescriptionDetails(){return null}\nexport function DescriptionList(){return null}\nexport function DescriptionTerm(){return null}\n')
  put(root, 'src/components/ui/dialog.tsx', 'export function Dialog(){return null}\nexport function DialogActions(){return null}\nexport function DialogBody(){return null}\nexport function DialogDescription(){return null}\nexport function DialogTitle(){return null}\n')
  put(root, 'src/components/ui/divider.tsx', 'export function Divider(){return null}\n')
  put(root, 'src/components/ui/fieldset.tsx', 'export function Description(){return null}\nexport function ErrorMessage(){return null}\nexport function Field(){return null}\nexport function Fieldset(){return null}\nexport function Label(){return null}\nexport function Legend(){return null}\n')
  put(root, 'src/components/ui/heading.tsx', 'export function Heading(){return null}\nexport function Subheading(){return null}\n')
  put(root, 'src/components/ui/link.tsx', 'export function Link(){return null}\n')
  put(root, 'src/components/ui/navbar.tsx', 'export function Navbar(){return null}\n')
  put(root, 'src/components/ui/sidebar.tsx', 'export function Sidebar(){return null}\nexport function SidebarBody(){return null}\nexport function SidebarFooter(){return null}\nexport function SidebarHeader(){return null}\nexport function SidebarHeading(){return null}\nexport function SidebarItem(){return null}\nexport function SidebarLabel(){return null}\nexport function SidebarSection(){return null}\n')
  put(
    root,
    'src/components/ui/table.tsx',
    "export function Table(){return null}\nexport function TableBody(){return null}\nexport function TableCell(){return null}\nexport function TableHead(){return null}\nexport function TableHeader(){return null}\nexport function TableRow(){return <a aria-label='row'/>}\n",
  )
  put(root, 'src/components/ui/text.tsx', 'export function Code(){return null}\nexport function Strong(){return null}\nexport function Text(){return null}\nexport function TextLink(){return null}\n')
  put(root, 'src/components/ui/textarea.tsx', "export function Textarea(){return <textarea className='focus-visible:ring-2'/>}\n")
  put(root, 'src/app/page.tsx', "import { Button } from '@/components/ui/button'\nexport default function P(){return <Button />}\n")
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('governance gates split', () => {
  it('autorise couleurs/gradients dans Lab et visuels externes exclus', () => {
    const root = makeWorkspace()
    seedVisualBase(root)
    put(root, 'src/components/lab/demo.tsx', "export function Demo(){return <div className='bg-red-500 from-sky-500'>x</div>}\n")
    put(root, 'src/components/visualizations/logo.tsx', "export const logo = '#ff0055' // marque\n")
    put(root, 'src/app/globals.css', ':root{--aig-accent: oklch(0.72 0.11 52);}\n')
    const res = run(GATE_VISUAL, root)
    expect(res.status).toBe(0)
  })

  it('refuse bg-red-500 comme statut métier en production', () => {
    const root = makeWorkspace()
    seedVisualBase(root)
    put(
      root,
      'src/components/runs/runs-screen.tsx',
      "export function Runs(){const status='blocked'; return <div className='status bg-red-500'>{status}</div>}\n",
    )
    const res = run(GATE_VISUAL, root)
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('raw status accent interdit')
  })

  it('refuse une couleur littérale répétée dans une route production', () => {
    const root = makeWorkspace()
    seedVisualBase(root)
    put(root, 'src/components/agents/detail.tsx', "export function A(){return <div style={{color:'#e8455f'}}>x</div>}\n")
    const res = run(GATE_VISUAL, root)
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('couleur littérale hors autorité thème')
  })

  it('refuse une redéfinition locale de RUN_STATUS_COLOR', () => {
    const root = makeWorkspace()
    seedVisualBase(root)
    put(root, 'src/components/runs/colors.ts', "const RUN_STATUS_COLOR = { blocked: '#ff0000' }\nexport { RUN_STATUS_COLOR }\n")
    const res = run(GATE_VISUAL, root)
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(/RUN_STATUS_COLOR|couleur littérale hors autorité thème/)
  })

  it('échoue si la gate n’a aucune cible', () => {
    const root = makeWorkspace()
    const res = run(GATE_VISUAL, root)
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('gate sans cible')
  })
})

describe('legacy governance gate', () => {
  it('refuse le retour de zéro-scroll obligatoire', () => {
    const root = makeWorkspace()
    seedLegacyBase(root)
    put(root, 'src/lib/agent-mission-control/repo-suite-context.ts', 'export const bad = "zéro-scroll obligatoire"\n')
    const res = run(GATE_LEGACY, root)
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('zéro-scroll obligatoire')
  })

  it('refuse la réintroduction de check:catalyst/check:ds', () => {
    const root = makeWorkspace()
    seedLegacyBase(root)
    put(root, 'package.json', JSON.stringify({ scripts: { check: 'npm run check:ds && npm run check:catalyst' } }))
    const res = run(GATE_LEGACY, root)
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('check:catalyst')
  })
})

describe('ui-kit integrity tactile context', () => {
  it('autorise une modification volontaire de primitive si garde-fous conservés', () => {
    const root = makeWorkspace()
    seedUiKitBase(root)
    const res = run(GATE_UI, root)
    expect(res.status).toBe(0)
  })

  it('refuse un recolorage fork --aig-* dans le kit Catalyst', () => {
    const root = makeWorkspace()
    seedUiKitBase(root)
    put(
      root,
      'src/components/ui/button.tsx',
      [
        'export function Button(){return <TouchTarget>ok</TouchTarget>}',
        'export function TouchTarget({children}:{children:unknown}){',
        "  return <span className='bg-(--aig-raised) absolute pointer-fine:hidden size-[max(100%,2.75rem)] focus-visible:ring-2 forced-colors:text-[ButtonText] data-disabled:opacity-50'>{children as never}</span>",
        '}',
        '',
      ].join('\n'),
    )
    const res = run(GATE_UI, root)
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(/FORK RECOLORÉ/)
  })
})
