import os from 'node:os'
import path from 'node:path'

const int = (value: string | undefined, fallback: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const config = {
  port: int(process.env.INCLEANUP_PORT, 5274),
  cdpPort: int(process.env.INCLEANUP_CDP_PORT, 9222),
  dataDir: process.env.INCLEANUP_DATA_DIR ?? path.join(os.homedir(), '.incleanup'),

  /** Upper bound on connections pulled in one scrape. */
  maxConnections: int(process.env.INCLEANUP_MAX_CONNECTIONS, 5000),
  /** Scroll rounds without new profiles before the scrape is considered complete. */
  scrollIdleRounds: int(process.env.INCLEANUP_SCROLL_IDLE_ROUNDS, 12),
  /** New connections between snapshot writes, so an interrupted scan is not lost. */
  checkpointEvery: int(process.env.INCLEANUP_CHECKPOINT_EVERY, 200),
  /** Pause after each scroll, for LinkedIn to append the next page of cards. */
  scrollWaitMs: int(process.env.INCLEANUP_SCROLL_WAIT, 1200),

  /** Connection removals per run. Deliberately low: LinkedIn cannot undo them. */
  maxRemovalsPerRun: int(process.env.INCLEANUP_MAX_REMOVALS, 100),
  /** Unfollows per run. Higher, because following again is one click. */
  maxUnfollowsPerRun: int(process.env.INCLEANUP_MAX_UNFOLLOWS, 500),
  /** Search result pages to walk when looking up mutual connections. */
  maxEnrichPages: int(process.env.INCLEANUP_MAX_ENRICH_PAGES, 100),
  /** Randomised pause between removals, to stay in human territory. */
  removalDelayMinMs: int(process.env.INCLEANUP_REMOVAL_DELAY_MIN, 3500),
  removalDelayMaxMs: int(process.env.INCLEANUP_REMOVAL_DELAY_MAX, 7000),
} as const

export const actionLogPath = path.join(config.dataDir, 'removals.log')
