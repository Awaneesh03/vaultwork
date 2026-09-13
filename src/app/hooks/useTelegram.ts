import { useEffect } from 'react'
import { platform } from '@/platform'
import { processTelegramMessage } from '@/services'

/**
 * The bridge between an arriving Telegram message and the application.
 *
 * Mounted once, in the app shell. It is deliberately tiny: subscribe, hand each
 * message to the service, send the answer, acknowledge. No polling happens
 * here — the loop lives in the native process, so React is never holding a
 * network request open and a slow Telegram cannot make the UI stutter.
 *
 * The acknowledgement is the last step on purpose. The cursor only moves once
 * the mutation and the message log have committed, so a crash costs a replayed
 * update rather than a lost one — and a replay is harmless, because the message
 * log rejects it.
 *
 * Messages are processed one at a time. Telegram delivers in order, and running
 * two `/done 1`s concurrently against the same list is a race nobody asked for.
 */
export function useTelegram(): void {
  useEffect(() => {
    if (!platform.telegram.isSupported) return

    let unsubscribe: (() => void) | null = null
    let cancelled = false
    // A promise chain, so overlapping deliveries queue rather than interleave.
    let queue: Promise<void> = Promise.resolve()

    const handle = async (
      message: Parameters<Parameters<typeof platform.telegram.subscribe>[0]>[0],
    ) => {
      const status = await platform.telegram.status()

      const outcome = await processTelegramMessage(message, {
        authorizedChatId: status.authorizedChatId,
      })

      if (outcome.reply !== null) {
        try {
          await platform.telegram.sendMessage(outcome.reply.chatId, outcome.reply.text)
        } catch {
          // A reply that could not be delivered must not cost the mutation that
          // already happened, nor stop the cursor advancing — Telegram would
          // otherwise redeliver forever.
        }
      }

      await platform.telegram.ack(message.externalId)
    }

    void platform.telegram
      .subscribe((message) => {
        queue = queue.then(() => handle(message)).catch(() => undefined)
      })
      .then((off) => {
        if (cancelled) off()
        else unsubscribe = off
      })
      .catch(() => {
        // Subscribing is the app shell's first act. If the native listener
        // cannot be registered, Vaultwork carries on without inbound Telegram
        // rather than dying at boot with an unhandled rejection.
      })

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])
}
