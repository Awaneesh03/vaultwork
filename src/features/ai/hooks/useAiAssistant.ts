import { useCallback, useEffect, useRef, useState } from 'react'
import type { AiStepOutcome } from '@/ai/bridge/aiBridgeTypes'
import { platform, type AiStatus } from '@/platform'
import {
  askAi,
  cancelAiConfirmation,
  confirmAiAction,
  proposeAiChoices,
  type AiAskResult,
  type AiConfirmation,
  type AiUnavailableReason,
} from '@/services'
import { useToastStore } from '@/store/toastStore'
import type { Id } from '@/types/entities'

/**
 * The assistant's UI state, and none of its logic.
 *
 * Everything this hook does is remember what happened and call one of three
 * application functions. The pipeline lives in `aiAssistantService`; the
 * confirmation gate lives in `aiConfirmationService`; the executor is reached
 * by neither this file nor the components it serves. That separation is the
 * reason the view can stay a view.
 *
 * The turn list is deliberately in memory. Nothing about a conversation with an
 * assistant belongs in Dexie: the prompts and answers are the most sensitive
 * text the application would hold, they have no schema, and a reload clearing
 * them is the safe failure rather than a lost feature.
 */

/** One exchange. The conversation is a list of these, oldest first. */
export interface AiTurn {
  id: string
  request: string
  /** Null while the provider is still answering. */
  result: AiAskResult | null
}

/** Where a proposal is in its lifecycle, as far as the screen is concerned. */
export type AiTurnPhase = 'idle' | 'asking' | 'proposed' | 'executing' | 'settled'

export interface AiOutcome {
  ok: boolean
  message: string
}

export interface AiAssistant {
  status: AiStatus | null
  unavailable: AiUnavailableReason | null
  turns: AiTurn[]
  phase: AiTurnPhase
  /** The proposal currently awaiting a decision, if any. */
  confirmation: AiConfirmation | null
  /** What the last confirmed action did. Cleared by the next question. */
  outcome: AiOutcome | null
  /** Which row was picked for each ambiguous step, by step id. */
  choices: ReadonlyMap<string, Id>

  ask: (text: string) => Promise<void>
  choose: (stepId: string, taskId: Id) => void
  proposeChosen: (steps: readonly AiStepOutcome[]) => Promise<void>
  confirm: () => Promise<void>
  cancel: () => void
  reset: () => void
}

let turnSeq = 0
const nextTurnId = () => `turn-${(turnSeq += 1)}`

export function useAiAssistant(): AiAssistant {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [unavailable, setUnavailable] = useState<AiUnavailableReason | null>(null)
  const [turns, setTurns] = useState<AiTurn[]>([])
  const [phase, setPhase] = useState<AiTurnPhase>('idle')
  const [confirmation, setConfirmation] = useState<AiConfirmation | null>(null)
  const [outcome, setOutcome] = useState<AiOutcome | null>(null)
  const [choices, setChoices] = useState<Map<string, Id>>(new Map())

  const push = useToastStore((state) => state.push)

  /**
   * Guards every entry point against a second call while one is in flight.
   *
   * A ref rather than the `phase` state, because two clicks in the same tick
   * would both read the old state and both proceed. Disabling a button is a
   * courtesy; this is the actual rule.
   */
  const busy = useRef(false)

  useEffect(() => {
    let cancelled = false
    void platform.ai
      .status()
      .then((next) => {
        if (cancelled) return
        setStatus(next)
        if (!platform.ai.isAvailable) setUnavailable('unsupported')
        else if (!next.configured) setUnavailable('not-configured')
        else if (!next.enabled) setUnavailable('disabled')
        else setUnavailable(null)
      })
      .catch(() => {
        // Reading a status never throws on either adapter, but a screen must
        // not hang on the possibility. An unknown status shows as unavailable.
        if (!cancelled) setUnavailable('unsupported')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const ask = useCallback(async (text: string) => {
    const request = text.trim()
    if (request.length === 0 || busy.current) return

    busy.current = true
    const id = nextTurnId()
    setTurns((previous) => [...previous, { id, request, result: null }])
    setConfirmation(null)
    setOutcome(null)
    setChoices(new Map())
    setPhase('asking')

    try {
      const result = await askAi(request)
      setTurns((previous) => previous.map((turn) => (turn.id === id ? { ...turn, result } : turn)))

      if (result.kind === 'unavailable') setUnavailable(result.reason)
      if (result.kind === 'proposal') {
        setConfirmation(result.confirmation)
        setPhase('proposed')
      } else {
        setPhase('settled')
      }
    } finally {
      busy.current = false
    }
  }, [])

  /** Records which row the user meant. Touches nothing else. */
  const choose = useCallback((stepId: string, taskId: Id) => {
    setChoices((previous) => new Map(previous).set(stepId, taskId))
  }, [])

  /**
   * Builds a proposal once every ambiguous step has an answer.
   *
   * No provider call: choosing between two of your own tasks is not a question
   * a model can answer better than you can.
   */
  const proposeChosen = useCallback(
    async (steps: readonly AiStepOutcome[]) => {
      if (busy.current) return
      busy.current = true
      setPhase('asking')
      try {
        const next = await proposeAiChoices(steps, choices)
        if (next === null) {
          setOutcome({ ok: false, message: 'Choose an option for every step first.' })
          setPhase('settled')
          return
        }
        setConfirmation(next)
        setPhase('proposed')
      } finally {
        busy.current = false
      }
    },
    [choices],
  )

  const confirm = useCallback(async () => {
    if (confirmation === null || busy.current) return
    busy.current = true
    setPhase('executing')

    try {
      const executed = await confirmAiAction(confirmation.id)
      setConfirmation(null)

      if (executed.status === 'executed') {
        const message = executed.results.map((result) => result.message).join(' · ')
        setOutcome({ ok: true, message })

        // The existing undo path, not a second one: a toast carrying the intent
        // the executor handed back, which `ToastHost` replays through the same
        // command layer every other undo in the application uses.
        const [first] = executed.undo
        push({
          message,
          tone: 'success',
          ...(first ? { action: { label: 'Undo', intent: first } } : {}),
        })
      } else {
        setOutcome({ ok: false, message: executed.message })
      }
    } finally {
      busy.current = false
      setPhase('settled')
    }
  }, [confirmation, push])

  const cancel = useCallback(() => {
    if (confirmation === null) return
    cancelAiConfirmation(confirmation.id)
    setConfirmation(null)
    setOutcome({ ok: false, message: 'Cancelled. Nothing was changed.' })
    setPhase('settled')
  }, [confirmation])

  const reset = useCallback(() => {
    // A withdrawn proposal must not be left pending behind a cleared screen.
    if (confirmation !== null) cancelAiConfirmation(confirmation.id)
    setTurns([])
    setConfirmation(null)
    setOutcome(null)
    setChoices(new Map())
    setPhase('idle')
  }, [confirmation])

  return {
    status,
    unavailable,
    turns,
    phase,
    confirmation,
    outcome,
    choices,
    ask,
    choose,
    proposeChosen,
    confirm,
    cancel,
    reset,
  }
}
