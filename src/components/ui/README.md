# `src/components/ui/` — Catalyst officiel (Tailwind Plus)

**Source** : `catalyst-ui-kit.zip` (Tailwind Plus) — copie dans
`vendor/catalyst-ui-kit/typescript/`, déployée telle quelle dans ce dossier.

## Règle d'or

**Ne pas recolorer le kit.** Pas de `--aig-*` ici. Le kit parle zinc + `dark:` ;
le graphite produit vit dans `src/theme/tokens.css`, `utilities.css` et les
classes `aig-*` sur les écrans.

La nav pose `dark aig-dark` en îlot (`app-shell.tsx`) ; le document reste clair
(`layout.tsx`).

## Primitives consommées par le produit (14)

| Fichier | Exports utilisés |
|---|---|
| `text` | `Text`, `Strong`, `TextLink`, `Code` |
| `badge` | `Badge`, `BadgeButton` |
| `heading` | `Heading`, `Subheading` |
| `divider` | `Divider` |
| `link` | `Link` (branché sur `next/link` — soft nav App Router) |
| `avatar` | `Avatar` |
| `button` | `Button`, `TouchTarget` |
| `dialog` | `Dialog`, `DialogActions`, `DialogBody`, `DialogDescription`, `DialogTitle` |
| `textarea` | `Textarea` |
| `input` | `Input` |
| `fieldset` | `Field`, `Label`, `Description`, … |
| `checkbox` | `Checkbox`, `CheckboxField`, `CheckboxGroup` |
| `table` | `Table`, … |
| `sidebar` | `Sidebar`, `SidebarItem`, … |

## Primitives Catalyst additionnelles (dans `vendor/`, non déployées dans `ui/`)

`alert`, `combobox`, `dropdown`, `listbox`, `navbar`, `pagination`, `radio`,
`select`, `switch`, `description-list`, `auth-layout`, `sidebar-layout`,
`stacked-layout`.

## Mise à jour depuis l'amont

1. Décompresser le zip Tailwind Plus Catalyst
2. Copier `catalyst-ui-kit/typescript/*.tsx` → `src/components/ui/` (sous-ensemble consommé)
3. **Rebrancher `link.tsx` sur `next/link`** (le zip amont rend un `<a>` brut — voir
   [docs Catalyst](https://catalyst.tailwindui.com/docs#client-side-router-integration))
4. Ne pas toucher aux couleurs — `npm run check:ui-kit-integrity` refuse `--aig-*`
5. Ouvrir un écran consommateur et vérifier le rendu (aucune gate ne mesure les pixels)

## Hors périmètre Catalyst dans ce dossier

- `index.ts` — barrel de gouvernance
