'use client'

/**
 * Les commandes Obsidian — les seuls endroits de l'UI qui émettent une URI
 * `obsidian://`.
 *
 * TROIS RÈGLES TENUES ICI
 * -----------------------
 * 1. **Un bouton ne s'affiche que si son URI est constructible.** Les builders
 *    de `obsidian-bridge.ts` renvoient un résultat typé `{ ok: true; uri } |
 *    { ok: false; reason; detail }` : le type force le test avant d'atteindre
 *    `.uri`, donc aucun `href` ne peut recevoir un échec. Quand c'est `ok:
 *    false`, on ne rend PAS un bouton mort — on ne rend rien, ou une mention
 *    lisible selon le contexte. Un bouton grisé qui ne dira jamais pourquoi est
 *    un mensonge d'affordance.
 * 2. **Le contenu de note est composé à partir de champs DÉJÀ bornés** : des
 *    identifiants stables, un statut, un titre, et des routes de preuve. Jamais
 *    un prompt, jamais un payload, jamais un `output_summary` brut d'outil. Le
 *    module de pont refuse en plus tout contenu suspect (`screenContent`) — la
 *    ceinture après les bretelles.
 * 3. **La config vient du SERVEUR.** `getObsidianConfig()` lit `process.env` ;
 *    l'appeler ici l'exposerait au bundle navigateur. La page la résout et la
 *    passe en prop — un simple nom de vault, aucun secret.
 */
import { useMemo } from 'react'

import { Button } from '@/components/ui/button'
import {
  buildCanvasUri,
  buildCreateNoteUri,
  buildOpenVaultUri,
  buildSearchUri,
  type ObsidianConfig,
} from '@/lib/agent-mission-control/obsidian-bridge'
import type { OperatorQueueItem } from '@/lib/agent-mission-control/operator-queue'

/**
 * Corps de la note de review d'une ligne de file.
 *
 * Volontairement PAUVRE : ce qui identifie, ce qui qualifie, et où retrouver la
 * preuve. Tout le reste vit dans Aigent et se rejoint par lien — recopier
 * l'analyse dans le vault en ferait une seconde source de vérité qui dérive.
 *
 * `origin` est PASSÉ en paramètre, jamais lu depuis `window` ici. Lire
 * `window.location.origin` dans un composant rendu des deux côtés produit deux
 * URI différentes (chaîne vide au SSR, origine réelle au client) — donc une
 * erreur d'hydratation React, constatée en console avant cette correction. Les
 * liens de preuve sont des chemins RELATIFS quand l'origine est inconnue : un
 * lien relatif dans une note Obsidian est inerte, mais il ne ment pas, alors
 * qu'une origine devinée pointerait vers le mauvais hôte.
 */
function reviewNoteBody(item: OperatorQueueItem, origin: string): string {
  const lines = [
    '---',
    'tags: [aigent, review]',
    `aigent-item: ${item.id}`,
    'source: aigent',
    '---',
    '',
    `# ${item.title}`,
    '',
    `- **Catégorie** : ${item.kind}`,
    `- **Statut** : ${item.status}`,
    `- **Contexte** : ${item.meta}`,
    item.copilotId ? `- **Agent** : ${item.copilotId}` : null,
    item.risk ? `- **Risque** : ${item.risk}` : null,
    '',
    '## Preuve',
    '',
    `- File d'action : ${origin}/actions`,
    item.copilotId ? `- Agent : ${origin}/agents/${item.copilotId}` : null,
    `- Supervision : ${origin}/learning`,
    '',
    '## Décision',
    '',
    '<!-- À compléter par l’opérateur -->',
    '',
  ]
  return lines.filter((line): line is string => line !== null).join('\n')
}

/** Nom de fichier stable et sans caractère hostile pour un chemin de vault. */
function reviewNotePath(item: OperatorQueueItem): string {
  const slug = item.id.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 60)
  return `Reviews/${slug}.md`
}

/**
 * « Créer la note de review » pour une ligne de file.
 *
 * Ne rend rien quand Obsidian n'est pas configuré, ou quand le pont refuse le
 * contenu : dans les deux cas il n'existe pas d'action honnête à proposer.
 */
export function ObsidianNoteButton({
  config,
  item,
  origin,
}: Readonly<{ config: ObsidianConfig; item: OperatorQueueItem; origin: string }>) {
  // Recalculé au rendu plutôt qu'au clic : si l'URI n'est pas constructible, le
  // bouton ne doit pas exister du tout.
  const result = useMemo(
    () =>
      buildCreateNoteUri(config, {
        path: reviewNotePath(item),
        content: reviewNoteBody(item, origin),
      }),
    [config, item, origin]
  )

  if (!result.ok) return null

  return (
    <Button plain href={result.uri} title="Créer une note de review dans Obsidian">
      Note de review
    </Button>
  )
}

/**
 * Le bloc de commandes Obsidian de `/learning`.
 *
 * Chaque commande dit son état : disponible, ou absente avec sa raison. Le
 * Canvas a sa propre raison (`canvas_not_configured`), distincte de « vault non
 * configuré » — deux correctifs différents pour l'opérateur, donc deux messages
 * différents.
 */
export function ObsidianCommands({ config }: Readonly<{ config: ObsidianConfig }>) {
  const vault = buildOpenVaultUri(config)
  const canvas = buildCanvasUri(config)
  const search = buildSearchUri(config, 'aigent review')

  if (config.availability === 'not_configured') {
    return (
      <div className="rounded-lg border border-dashed border-zinc-950/10 p-4 dark:border-white/10">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">Obsidian non configuré.</span>{' '}
          Renseignez <code className="rounded bg-zinc-950/5 px-1 dark:bg-white/10">AIGENT_OBSIDIAN_VAULT</code>{' '}
          pour ouvrir le vault, créer des notes de review et atteindre le Canvas de supervision depuis Aigent.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {vault.ok ? (
          <Button plain href={vault.uri}>
            Ouvrir le vault
          </Button>
        ) : null}
        {search.ok ? (
          <Button plain href={search.uri}>
            Rechercher
          </Button>
        ) : null}
        {canvas.ok ? (
          <Button plain href={canvas.uri}>
            Canvas de supervision
          </Button>
        ) : null}
      </div>

      {!canvas.ok && canvas.reason === 'canvas_not_configured' ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Aucun Canvas de supervision déclaré —{' '}
          <code className="rounded bg-zinc-950/5 px-1 dark:bg-white/10">AIGENT_OBSIDIAN_CANVAS_PATH</code> est
          vide. Le vault reste accessible.
        </p>
      ) : null}
    </div>
  )
}
