'use client'

/**
 * Pattern « remplissage de progression » — un libellé qui se remplit.
 *
 * CE QUE CE PATTERN CORRIGE
 * -------------------------
 * Un run en cours n'a aujourd'hui aucun indicateur de progression : il porte le
 * badge « En cours » et rien d'autre. L'opérateur ne peut pas distinguer un run
 * qui avance d'un run bloqué depuis huit minutes.
 *
 * LE PIÈGE, ET POURQUOI IL Y A DEUX MODES
 * ---------------------------------------
 * La version courante de ce pattern sur le web anime une barre avec une
 * progression ALÉATOIRE (`progress + Math.random()`), ce qui produit une barre
 * qui avance sans rien mesurer. Ici c'est interdit : la même règle que partout
 * dans ce produit — une valeur non mesurée ne se peint pas comme une mesure.
 *
 *  · `determinate`   — le total d'étapes est CONNU. Le remplissage vaut
 *                      `done / total`, une proportion vraie, et le libellé
 *                      porte le compte.
 *  · `indeterminate` — le total n'est PAS connu (le run tourne, le graphe n'a
 *                      pas encore rendu sa dernière étape). Aucun pourcentage
 *                      n'est affiché ; une lueur balaie le libellé pour dire
 *                      « ça travaille », ce qui est la seule chose qu'on sache.
 *
 * Les deux ne se ressemblent pas à l'écran, exprès : une barre pleine à 60 %
 * et une lueur qui balaie disent deux choses différentes.
 *
 * `'use client'` : `useSpring` s'anime image par image dans le navigateur.
 */
import { motion, useReducedMotion, useSpring, useTransform } from 'motion/react'
import { useEffect, useState } from 'react'

import { Strong, Text } from '@/components/ui/text'
import { SEVERITY } from '@/components/cockpit/primitives'

/** Les étapes d'un run, telles que `AgentRunStep.kind` les nomme. */
const STEP_LABELS = [
  'Lecture du manifeste',
  'Appel du modèle',
  'Outil · list_projects',
  'Garde-fou · vérification',
  'Appel du modèle',
  'Outil · read_repo_file',
  'Rédaction de la sortie',
] as const

const TOTAL = STEP_LABELS.length

function DeterminateFill({ done }: Readonly<{ done: number }>) {
  const ratio = done / TOTAL
  // `useSpring` lisse le passage d'une étape à l'autre : sans lui, le
  // remplissage saute par paliers de 14 %, ce qui se lit comme un défaut de
  // rendu plutôt que comme une progression.
  const progress = useSpring(ratio, { stiffness: 120, damping: 20 })
  const clipPath = useTransform(progress, [0, 1], ['inset(0 100% 0 0)', 'inset(0 0% 0 0)'])

  useEffect(() => {
    progress.set(ratio)
  }, [progress, ratio])

  // Le MOT porte l'effet, pas le compteur : un gros libellé qui se remplit se
  // voit d'un coup d'œil, là où « 3/7 » demande d'être lu. Le compte reste —
  // c'est lui qui dit la vérité de la mesure — mais en second rang.
  const word = done >= TOTAL ? 'Terminé' : 'En cours'

  return (
    <div className="flex select-none flex-col gap-1.5">
      <div className="relative">
        {/* Le calque de fond porte le mot en creux ; celui du dessus est
            identique mais découpé à la proportion réelle. Deux copies du MÊME
            texte, donc aucun risque qu'ils divergent. */}
        <div
          aria-hidden
          className="text-4xl font-black tracking-tighter text-white/12 uppercase"
        >
          {word}
        </div>
        <motion.div
          style={{ clipPath, color: SEVERITY.good }}
          className="absolute inset-0 text-4xl font-black tracking-tighter uppercase"
        >
          {word}
        </motion.div>
      </div>

      <Text className="font-mono text-2xs tabular-nums">
        {done}/{TOTAL} étapes rendues
      </Text>
    </div>
  )
}

function IndeterminateSweep() {
  // `useReducedMotion()` rend `null` avant hydratation : le `!== true` traite
  // « pas encore connu » comme « on peut animer », et l'hydratation corrigera.
  // L'inverse figerait le pattern pour tout le monde le temps d'un rendu.
  const sweep = useReducedMotion() !== true

  return (
    <div className="flex select-none flex-col gap-1.5">
      <div className="relative">
        <div
          aria-hidden
          className="text-4xl font-black tracking-tighter text-white/12 uppercase"
        >
          En cours
        </div>
        {/* Aucune proportion : la lueur balaie sans jamais s'arrêter sur une
            valeur, parce qu'il n'y en a pas à montrer. Le mouvement dit
            « ça travaille », il ne prétend pas dire « on en est là ». */}
        {/*
          MOUVEMENT RÉDUIT : LE BALAYAGE NE DÉMARRE PAS DU TOUT.

          C'était la seule boucle infinie du produit sans garde, et le pire
          profil vestibulaire qu'on puisse écrire : un balayage de grande
          amplitude sur un texte `4xl font-black`, indéfiniment. Le laisser
          tourner sur `prefers-reduced-motion: reduce` est exactement ce que ce
          réglage système existe pour empêcher.

          Réduit, la couche colorée est simplement POSÉE : le libellé reste
          lisible et coloré, il ne balaie plus. Aucune information n'est perdue
          — il n'y en avait aucune dans le mouvement, c'est le propos même de ce
          pattern (« ça travaille », pas « on en est là »).
        */}
        <motion.div
          className="absolute inset-0 text-4xl font-black tracking-tighter uppercase"
          style={{ color: SEVERITY.running }}
          animate={
            sweep
              ? { clipPath: ['inset(0 100% 0 0)', 'inset(0 0% 0 0)', 'inset(0 0% 0 100%)'] }
              : undefined
          }
          transition={
            sweep
              ? { duration: 2.2, repeat: Infinity, ease: 'easeInOut', times: [0, 0.55, 1] }
              : undefined
          }
        >
          En cours
        </motion.div>
      </div>

      <Text className="font-mono text-2xs">nombre d’étapes inconnu</Text>
    </div>
  )
}

export default function PatternProgress() {
  const [done, setDone] = useState(0)
  const [knowsTotal, setKnowsTotal] = useState(true)

  // Simulation d'avancement — les étapes tombent une par une, comme le ferait
  // un flux d'événements de run. Fixture, pas une mesure.
  useEffect(() => {
    if (!knowsTotal) return
    const id = setInterval(() => {
      setDone((d) => (d >= TOTAL ? 0 : d + 1))
    }, 1100)
    return () => clearInterval(id)
  }, [knowsTotal])

  const current = STEP_LABELS[Math.min(done, TOTAL - 1)]
  const finished = done >= TOTAL

  return (
    <div className="flex flex-col gap-4 p-5">
      {/* Pas de badge d'état ici : le grand libellé le porte déjà. Le répéter
          en petit à côté affaiblirait les deux. */}
      <Strong className="text-sm">Run · fixture-pricer</Strong>

      {knowsTotal ? <DeterminateFill done={done} /> : <IndeterminateSweep />}

      <div className="min-h-5">
        <Text className="truncate text-xs">
          {knowsTotal
            ? finished
              ? 'Toutes les étapes ont été rendues.'
              : `Étape ${done + 1} · ${current}`
            : 'Le graphe n’a pas encore rendu son plan : le nombre d’étapes est inconnu.'}
        </Text>
      </div>

      <button
        type="button"
        onClick={() => {
          setKnowsTotal((k) => !k)
          setDone(0)
        }}
        className="aig-line-soft self-start rounded-lg border px-3 py-1.5 text-xs font-medium transition hover:bg-white/5"
      >
        {knowsTotal ? 'Voir le cas « total inconnu »' : 'Voir le cas « total connu »'}
      </button>
    </div>
  )
}
