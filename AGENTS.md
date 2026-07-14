<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:catalyst-ui-rules -->
## UI (gate : `npm run check:catalyst`)
- **Dashboard** (`src/app/admin/`, `src/components/agent-ops/`) → **primitives Catalyst
  uniquement** (`src/components/catalyst/`). Zéro `<button>`/`<input>`/`<select>`/`<textarea>`/
  `<table>` natif. Un contrôle au style entièrement custom (toggle, tuile sélectionnable, croix
  de suppression dans un badge) utilise `Headless.Button` (`@headlessui/react`) plutôt qu'un
  `<button>` brut — même sémantique clavier/focus/disabled que `Button` Catalyst, sans hériter
  de son padding/couleur par défaut.
- **Marketing** (`src/app/(site)/`, `src/components/marketing/`) → blocs Tailwind Plus pris tels
  quels, restylés sur les tokens du projet (`accent-*`/`zinc`). Pas de primitive Catalyst ici —
  convention volontaire, le marketing est une vitrine statique.
- **Un seul accent : `accent` (vert tendre, `#A7FB90`, `src/app/globals.css`).** Tout le reste est `zinc`.
  Les 18 autres couleurs que `<Button color>` accepte sont interdites hors `components/catalyst/`.
- Besoin d'une section/écran dashboard ? → **lis** `~/.claude/tailwind-blocks/application-ui/`
  pour la structure, puis monte-la avec les primitives Catalyst. Ne colle jamais le JSX brut d'un
  bloc dans le dashboard.
- 27 primitives disponibles dans `src/components/catalyst/` (avatar, badge, button, checkbox,
  combobox, description-list, dialog, divider, dropdown, fieldset, heading, input, link, listbox,
  navbar, pagination, radio, select, sidebar, sidebar-layout, stacked-layout, switch, table, text,
  textarea, alert, auth-layout).
<!-- END:catalyst-ui-rules -->
