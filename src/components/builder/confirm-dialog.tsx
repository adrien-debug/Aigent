'use client'

/**
 * Dialog de confirmation des mutations COÛTEUSES (décision D2).
 *
 * RÈGLE : toute mutation qui dépense de l'argent ou déclenche un run LLM passe
 * par ici. Pas de mutation en un clic sur un chemin facturé. Le dialog affiche
 * ce qui va réellement se passer et, quand il est connaissable, ce que ça coûte.
 *
 * SUR LE COÛT — CE QU'ON REFUSE DE FAIRE
 * --------------------------------------
 * Aigent ne mesure PAS le coût d'un tour d'architecte avant de l'émettre : il
 * dépend du nombre d'itérations d'outils repo, de la taille du contexte et de la
 * réponse du modèle. Afficher « ~$0.01 » serait un chiffre inventé, et un
 * chiffre inventé sur un écran de dépense est exactement le mensonge que ce
 * repo interdit. Le dialog nomme donc la NATURE de la dépense (« un appel modèle
 * facturé, montant non mesuré avant émission ») plutôt qu'un montant faux.
 * `estimatedCost` n'est rendu que si l'appelant a une valeur réellement connue.
 *
 * Le kit Catalyst n'est pas modifié : ce composant COMPOSE `Dialog`, `Button`,
 * `Badge`, `Text`.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogActions, DialogBody, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Text } from '@/components/ui/text'

export interface CostedActionDescriptor {
  /** Titre du dialog — ce qui va être fait, en clair. */
  title: string
  /** Une phrase : ce que l'action déclenche réellement. */
  description: string
  /** Les effets concrets, listés. Chaque ligne est un fait, pas une promesse. */
  effects: readonly string[]
  /**
   * Coût RÉELLEMENT connu, déjà formaté (ex. « $0.42 »). `null` quand il n'est
   * pas mesurable avant émission — le dialog le dit alors explicitement.
   */
  estimatedCost: string | null
  /** Libellé du bouton de confirmation. */
  confirmLabel: string
  /** `true` pour une action destructive/irréversible → bouton rouge. */
  destructive?: boolean
}

export function CostedConfirmDialog({
  open,
  descriptor,
  pending,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean
  descriptor: CostedActionDescriptor
  pending: boolean
  onConfirm: () => void
  onClose: () => void
  /** Contenu additionnel (options de dry-run, détail de la cible). */
  children?: ReactNode
}) {
  return (
    <Dialog open={open} onClose={onClose} size="lg">
      <DialogTitle>{descriptor.title}</DialogTitle>
      <DialogDescription>{descriptor.description}</DialogDescription>
      <DialogBody>
        <div className="flex flex-col gap-4">
          <div>
            <Text className="mb-2 font-medium">Ce qui va se passer</Text>
            <ul className="flex flex-col gap-1">
              {descriptor.effects.map((effect) => (
                <li key={effect} className="flex gap-2">
                  <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-zinc-400" />
                  <Text>{effect}</Text>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border border-dashed border-zinc-950/10 p-3 dark:border-white/10">
            <div className="flex items-center gap-2">
              <Text className="font-medium">Coût</Text>
              {descriptor.estimatedCost === null ? (
                <Badge color="amber">non mesuré</Badge>
              ) : (
                <Badge color="zinc">{descriptor.estimatedCost}</Badge>
              )}
            </div>
            <Text className="mt-1">
              {descriptor.estimatedCost === null
                ? 'Cette action émet un appel modèle facturé. Le montant dépend du contexte et de la réponse : il n’est pas mesurable avant émission, et aucun chiffre n’est affiché plutôt qu’un chiffre inventé.'
                : 'Montant connu pour cette action.'}
            </Text>
          </div>

          {children}
        </div>
      </DialogBody>
      <DialogActions>
        <Button plain onClick={onClose} disabled={pending}>
          Annuler
        </Button>
        <Button
          color={descriptor.destructive ? 'red' : 'dark/zinc'}
          onClick={onConfirm}
          disabled={pending}
        >
          {pending ? 'En cours…' : descriptor.confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/**
 * Petit état de dialog réutilisable — ouvrir, fermer, retenir l'action.
 *
 * Il évite que chaque appelant réinvente un `useState<boolean>` plus un
 * descripteur, et garantit qu'une action costée ne peut pas être déclenchée sans
 * passer par `request()`.
 */
export function useCostedConfirm() {
  const [pendingAction, setPendingAction] = useState<{
    descriptor: CostedActionDescriptor
    run: () => void | Promise<void>
  } | null>(null)
  const [running, setRunning] = useState(false)

  return {
    descriptor: pendingAction?.descriptor ?? null,
    open: pendingAction !== null,
    running,
    request(descriptor: CostedActionDescriptor, run: () => void | Promise<void>) {
      setPendingAction({ descriptor, run })
    },
    close() {
      if (running) return
      setPendingAction(null)
    },
    async confirm() {
      if (!pendingAction || running) return
      setRunning(true)
      try {
        await pendingAction.run()
        setPendingAction(null)
      } finally {
        setRunning(false)
      }
    },
  }
}
