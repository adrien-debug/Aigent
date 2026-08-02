# `src/components/ui/` — Catalyst officiel (Tailwind Plus)

**Source** : `catalyst-ui-kit.zip` (Tailwind Plus) — copie dans
`vendor/catalyst-ui-kit/typescript/`, déployée telle quelle dans ce dossier.

## Règle d'or

**Ne pas recolorer le kit.** Pas de `--aig-*` ici. Le kit parle zinc + `dark:` ;
le graphite produit vit dans `src/theme/tokens.css`, `utilities.css` et les
classes `aig-*` sur les écrans.

`<html class="dark">` dans `layout.tsx` active le mode sombre natif de Catalyst.

## Primitives consommées par le produit (14)

| Fichier | Exports utilisés |
|---|---|
| `text` | `Text`, `Strong`, `TextLink`, `Code` |
| `badge` | `Badge`, `BadgeButton` |
| `heading` | `Heading`, `Subheading` |
| `divider` | `Divider` |
| `link` | `Link` |
| `avatar` | `Avatar` |
| `button` | `Button`, `TouchTarget` |
| `dialog` | `Dialog`, `DialogActions`, `DialogBody`, `DialogDescription`, `DialogTitle` |
| `textarea` | `Textarea` |
| `navbar` | `Navbar` |
| `fieldset` | `Field`, `Label`, `Description`, … |
| `checkbox` | `Checkbox`, `CheckboxField`, `CheckboxGroup` |
| `table` | `Table`, … |
| `sidebar` | `Sidebar`, `SidebarItem`, … |

## Primitives Catalyst additionnelles (disponibles, non consommées)

`alert`, `combobox`, `dropdown`, `input`, `listbox`, `pagination`, `radio`,
`select`, `switch`, `description-list`, `auth-layout`, `sidebar-layout`,
`stacked-layout`.

## Mise à jour depuis l'amont

1. Décompresser le zip Tailwind Plus Catalyst
2. Copier `catalyst-ui-kit/typescript/*.tsx` → `src/components/ui/`
3. Ne pas toucher aux couleurs — `npm run check:ui-kit-integrity` refuse `--aig-*`
4. Ouvrir un écran consommateur et vérifier le rendu (aucune gate ne mesure les pixels)

## Hors périmètre Catalyst dans ce dossier

- `index.ts` — barrel de gouvernance
- `ui-kit-catalog.tsx` — capture dev-only (Aigent)
