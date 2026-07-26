<!-- BEGIN:deploy-policy -->
PROD_AUTODEPLOY: unknown

Cette valeur déclenche uniquement une **vérification courte** avant push, jamais un blocage.

Si aucun mécanisme d'auto-déploiement réel n'est démontré, un push explicitement demandé par Adrien
est **autorisé et doit être exécuté**.

La seule présence de fichiers CI, Vercel, Railway, Docker ou d'un ancien hook supposé ne constitue
**pas** une preuve d'auto-déploiement. Il faut une étape de déploiement réellement câblée.

Ne jamais bloquer indéfiniment un push sur une simple valeur `unknown`.
<!-- END:deploy-policy -->

@AGENTS.md

## UI — ce qui garde réellement le design system

> **Storybook n'est PAS installé dans ce workspace (26/07/2026).** Le câblage précédent
> était creux de bout en bout — hook PreToolUse désactivé, 0 story, 0 test, et un
> `test:storybook-unit` qui se terminait par `|| true` donc ne pouvait pas échouer tout
> en occupant une ligne de `npm run check`. Le tout a été **supprimé**, pas caché :
> scripts, hook et marqueur `.storybook-consulted` n'existent plus.

Le design system est gardé par des outils qui échouent pour de vrai :

- `npm run check:ds` (`scripts/check-palette.mjs`) — mono-accent (`#A7FB90`) + zinc, et zéro import
  de `seed-fixtures` depuis l'app. **Ne dis pas qu'il « vérifie les contrastes AA » : c'est faux.**
  Il calcule exactement **3 paires codées en dur** sur l'échelle accent (zinc-950 sur accent-500,
  zinc-950 sur accent-600, blanc sur accent-700) — un garde-fou sur la *palette*, qui ne regarde
  aucune page, aucun plan de surface, aucun texte réellement rendu.
- `npm run check:contrast` (`scripts/check-contrast.mjs`) — la seule gate qui mesure vraiment le
  contraste AA : elle pilote un navigateur, lit les styles calculés et composite les fonds
  ancêtres + `opacity`, donc elle voit ce qu'aucun grep ne voit (`oklch()`, `color-mix()`, alphas
  empilés). **Elle EXISTE, elle ÉCHOUE, et elle n'est branchée NULLE PART.**
  - État réel mesuré le 26/07/2026 contre `http://localhost:3210` : **exit 1, 51 glyphes sous AA
    sur 6 pages / 6** (`/admin`, `/admin/projects/proj-tradeagent`, `…/team`,
    `/admin/agents/copilot-market-intelligence`, `/admin/performance`, `/admin/settings`) — pour
    l'essentiel du `text-zinc-500` à 10–12 px, mesuré entre 3,59:1 et 4,02:1 pour un seuil de 4,5.
  - Elle n'est ni dans le script `check` de `package.json`, ni dans `.github/workflows/ci.yml`
    (qui ne lance que `npm run check`, `npm test`, `npm run build`). **Conclusion à énoncer telle
    quelle : le contraste AA du dashboard n'est PAS gardé aujourd'hui.** La brancher demande un
    serveur de dev dans la CI *et* de réparer les 51 glyphes d'abord — tant que ce n'est pas fait,
    ne présente pas cette gate comme câblée.
- `npm run check:catalyst` — primitives `src/components/ui/` obligatoires sur
  `src/app/admin/**`, `src/components/agent-ops/**`, `src/components/views/**`,
  `src/components/shell/**`. Zéro natif, spacing sur l'échelle fixe.
- `npm run check:danger` (`scripts/check-danger-role.mjs`) — un échec ou une destruction doit
  porter le rôle rouge `--state-danger-*`, jamais l'accent.
- `npm run check:views`, `check:render-truth`, `check:status-truth` — vérité affichée.

Le contrat visuel lui-même (surfaces, tokens, échelle typo, cascade des `className`, arbitrages
ouverts) vit dans `src/components/agent-ops/DESIGN-DOCTRINE.md` — il n'est pas recopié ici.

Le design system de ce workspace lui est PROPRE : ne pas importer les tokens/palette
d'un autre projet. Si Storybook est installé un jour, il faudra de vraies stories et une
gate a11y bloquante **avant** de réécrire une règle ici — une règle ne vaut que si un
outil la fait respecter.

## Anti-fuite de secrets — pre-commit actif

`npm run hooks:install` câble `core.hooksPath=scripts/hooks` : le hook `pre-commit`
lance `gitleaks protect --staged --redact` et **refuse** le commit si un secret est
détecté (vérifié par sonde : commit bloqué, HEAD inchangé). `npm run check:secrets`
rejoue le scan sur tout l'historique. À faire une fois après un clone.
