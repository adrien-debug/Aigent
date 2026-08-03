// Le rail de navigation annonce la page courante — garde de RÉGRESSION.
//
// CE QUE CE TEST PROUVE, ET CE QU'IL NE PROUVE PAS. Il lit le SOURCE du kit et
// vérifie que chaque branche de rendu qui pose `data-current` pose aussi un
// `aria-current`. Il ne rend rien : la suite tourne en `environment: 'node'`,
// il n'y a pas de DOM. La preuve que l'attribut arrive réellement dans le HTML
// servi est une preuve NAVIGATEUR, versionnée sous
// `docs/visual-reviews/AIGENT-HARDENING-PRODUCTION-001/`.
//
// POURQUOI CE TEST EXISTE QUAND MÊME. Le défaut d'origine n'était pas subtil :
// `data-current` était posé, `aria-current` ne l'était pas. `data-current` est
// un crochet de style — un lecteur d'écran n'en voit rien, et le liseré qui
// marque l'entrée active est un `<span aria-hidden>`. La surface courante
// n'existait donc QUE visuellement, ce que `DESIGN_DOCTRINE.md` §7 interdit.
// Ce test attrape précisément la réintroduction de ce défaut : une branche de
// rendu ajoutée plus tard avec le seul crochet de style.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const SIDEBAR = join(process.cwd(), 'src/components/ui/sidebar.tsx')

describe('rail de navigation — aria-current', () => {
  const source = readFileSync(SIDEBAR, 'utf8')

  it('pose un aria-current partout où il pose un data-current', () => {
    const dataCurrent = source.match(/data-current=\{/g) ?? []
    const ariaCurrent = source.match(/aria-current=\{/g) ?? []

    // Anti-vacuité : si le fichier ne portait plus aucun marqueur, le test
    // passerait sur zéro cible et ne mesurerait rien.
    expect(dataCurrent.length).toBeGreaterThan(0)
    expect(ariaCurrent.length).toBe(dataCurrent.length)
  })

  it('annonce `page` sur la branche lien et `true` sur la branche bouton', () => {
    // `aria-current="page"` est réservé à un lien vers la page courante. Sur un
    // <button>, il annoncerait une navigation qui n'a pas lieu.
    expect(source).toContain("aria-current={current ? 'page' : undefined}")
    expect(source).toContain("aria-current={current ? 'true' : undefined}")
  })

  it("n'annonce rien quand l'entrée n'est pas courante", () => {
    // `aria-current="false"` est lu par certains lecteurs d'écran comme une
    // annonce, là où l'absence d'attribut est silencieuse. Toutes les branches
    // doivent retomber sur `undefined`.
    const falsy = source.match(/aria-current=\{[^}]*\}/g) ?? []
    expect(falsy.length).toBeGreaterThan(0)
    for (const occurrence of falsy) {
      expect(occurrence).toContain('undefined')
    }
  })
})
