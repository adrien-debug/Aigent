'use client'

/**
 * Catalogue dev-only des primitives UI — utilisé par le script de capture
 * `scripts/capture-ui-kit-catalog-002.mjs`. Ne pas importer depuis les écrans
 * métier : c'est un outil de preuve visuelle, pas une surface produit.
 */
import { useState } from 'react'

import { Badge } from './badge'
import { Button } from './button'
import { Checkbox, CheckboxField, CheckboxGroup } from './checkbox'
import { Description, Label } from './fieldset'
import { Dialog, DialogActions, DialogBody, DialogDescription, DialogTitle } from './dialog'
import { Textarea } from './textarea'

function Section({ title, children, ...props }: Readonly<{ title: string; children: React.ReactNode } & React.ComponentPropsWithoutRef<'section'>>) {
  return (
    <section
      {...props}
      data-testid={`catalog-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
      className="space-y-3 rounded-lg border border-(--border-default) bg-(--surface-primary) p-4"
    >
      <h2 className="text-sm font-semibold text-(--aig-text)">{title}</h2>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  )
}

export function UiKitCatalog() {
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <main className="min-h-screen space-y-6 bg-(--surface-canvas) p-6 text-(--aig-text)">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold">Aigent · Kit UI</h1>
        <p className="text-sm text-(--aig-text-muted)">Catalogue de capture — états normal, hover, focus, disabled, invalid</p>
      </header>

      <Section title="Button">
        <Button>Normal</Button>
        <Button disabled>Disabled</Button>
        <Button outline>Outline</Button>
        <Button plain>Plain</Button>
        <Button color="red">Destructive</Button>
      </Section>

      <Section title="Badge">
        <Badge>Neutral</Badge>
        <Badge color="green">Good</Badge>
        <Badge color="red">Bad</Badge>
        <Badge color="sky">Running</Badge>
      </Section>

      <Section title="Textarea (Input absent du kit)">
        <Textarea placeholder="Normal" rows={2} className="min-w-[16rem]" />
        <Textarea placeholder="Disabled" rows={2} disabled className="min-w-[16rem]" />
        <Textarea placeholder="Invalid" rows={2} invalid className="min-w-[16rem]" />
      </Section>

      <Section title="Checkbox">
        <CheckboxGroup>
          <CheckboxField>
            <Checkbox defaultChecked />
            <Label>Checked</Label>
          </CheckboxField>
          <CheckboxField>
            <Checkbox />
            <Label>Unchecked</Label>
          </CheckboxField>
          <CheckboxField>
            <Checkbox disabled />
            <Label>Disabled</Label>
            <Description>État désactivé</Description>
          </CheckboxField>
        </CheckboxGroup>
      </Section>

      <Section title="Dialog">
        <Button onClick={() => setDialogOpen(true)}>Ouvrir</Button>
        <Dialog open={dialogOpen} onClose={setDialogOpen}>
          <DialogTitle>Dialog</DialogTitle>
          <DialogDescription>Surface élevée — radius lg, ombre overlay.</DialogDescription>
          <DialogBody>
            <Textarea placeholder="Champ dans le dialog" rows={2} />
          </DialogBody>
          <DialogActions>
            <Button plain onClick={() => setDialogOpen(false)}>
              Annuler
            </Button>
            <Button onClick={() => setDialogOpen(false)}>Confirmer</Button>
          </DialogActions>
        </Dialog>
      </Section>

      <p className="text-xs text-(--aig-text-muted)">
        Select et Switch ne sont pas dans le kit Catalyst actuel — Textarea tient lieu de contrôle texte.
      </p>
    </main>
  )
}
