// The values Senior's look keeps for the session, declared for `claude plugin validate`.
// They live with Claude Code, so a hot reload of the UI module keeps them.

/** The Senior skills that put a session in a mode. */
export type SeniorMode = 'design' | 'pair' | 'fast' | 'replay'

declare module 'claude-code' {
  interface PluginState {
    senior: {
      /** What the main loop is doing right now, for the spinner, or null between tools. */
      label: string | null
      /** A decision brought back by a callback, shown on the spinner for a few seconds. */
      recall: string | null
      /** The Senior mode the session is in, or null before any. */
      mode: SeniorMode | null
      /** The note for the end-of-turn line, keyed by the turn's duration in milliseconds. */
      notes: Record<string, string>
      /** True once the welcome line has been set up, so a reload does not show it again. */
      welcomed: boolean
      /** The active decision count the welcome line shows, or null once the first prompt is sent. */
      welcome: number | null
      /** When the running main-loop turn started, in milliseconds, or null between turns. */
      turnStartedAt: number | null
      /** The clock's last tick while a turn runs, so the spinner's elapsed time redraws each second. */
      tickAt: number
    }
  }
}
