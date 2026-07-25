#!/usr/bin/env node
// PreToolUse hook — force le passage par Storybook AVANT toute édition UI.
// exit 0 = autorise ; exit 2 + stderr = BLOQUE (stderr rendu à l'agent).
import { readFileSync, existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
const REPO = resolve(import.meta.dirname, '..', '..')
const CONSENT = resolve(REPO, '.storybook-consulted')
const TTL_MS = 15 * 60 * 1000
// Adapte ce motif à l'arborescence UI de TON projet si besoin :
const UI_PATH = /\/(src\/)?(components|design-system|ui|app)\/.*\.(tsx|jsx|vue|svelte)$/
const STORY = /\.stories\.(tsx|jsx|ts|js|mdx)$/
function readStdin(){ try { return readFileSync(0,'utf8') } catch { return '' } }
function main(){
  let p; try { p = JSON.parse(readStdin() || '{}') } catch { process.exit(0) }
  const t = p.tool_name
  if (t!=='Edit' && t!=='Write' && t!=='MultiEdit') process.exit(0)
  const path = p.tool_input?.file_path ?? ''
  if (!UI_PATH.test(path) || STORY.test(path)) process.exit(0)
  if (existsSync(CONSENT) && Date.now()-statSync(CONSENT).mtimeMs < TTL_MS) process.exit(0)
  process.stderr.write(
    ['⛔ Modif UI bloquée par la gate Storybook (voir CLAUDE.md).',
     `   Fichier : ${path}`, '',
     '   Avant d\'éditer un composant UI : consulter Storybook, identifier la story',
     '   + le vrai composant + le token source, reproduire le problème.', '',
     '   Puis débloque la passe UI (15 min) :  npm run storybook:consult', ''
    ].join('\n')+'\n')
  process.exit(2)
}
main()
