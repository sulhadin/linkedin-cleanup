import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { config } from './config.ts'

export class ChromeUnreachableError extends Error {
  constructor(port: number) {
    super(
      `No browser with remote debugging on port ${port}. Start it with \`npm run chrome\`, ` +
        `then log in to LinkedIn in the window that opens.`,
    )
    this.name = 'ChromeUnreachableError'
  }
}

let browser: Browser | null = null
let page: Page | null = null

const endpoint = () => `http://127.0.0.1:${config.cdpPort}`

async function connect(): Promise<Browser> {
  if (browser?.isConnected()) return browser
  try {
    browser = await chromium.connectOverCDP(endpoint())
  } catch {
    throw new ChromeUnreachableError(config.cdpPort)
  }
  browser.on('disconnected', () => {
    browser = null
    page = null
  })
  return browser
}

function firstContext(b: Browser): BrowserContext {
  const context = b.contexts()[0]
  if (!context) throw new ChromeUnreachableError(config.cdpPort)
  return context
}

/**
 * The working tab. Only ever a tab this app opened itself — the user's other
 * tabs are visible over CDP but are never read or navigated.
 */
export async function workPage(): Promise<Page> {
  const b = await connect()
  if (page && !page.isClosed()) return page
  const context = firstContext(b)
  page = await context.newPage()
  return page
}

export async function isReachable(): Promise<boolean> {
  try {
    await connect()
    return true
  } catch {
    return false
  }
}

const signedIn = (url: string) =>
  url.includes('linkedin.com') && !/\/(login|uas|checkpoint|signup)/.test(url)

/**
 * LinkedIn bounces logged-out visitors from /feed/ to a login or guest page.
 *
 * Read twice: a tab caught mid-navigation reports whatever it was leaving, and
 * telling someone they are logged out when they are not is worse than waiting.
 */
export async function checkLoggedIn(): Promise<boolean> {
  const p = await workPage()

  for (let attempt = 0; attempt < 2; attempt++) {
    if (!p.url().includes('linkedin.com')) {
      await p
        .goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' })
        .catch(() => {})
    }
    if (signedIn(p.url())) return true
    await p.waitForTimeout(1200)
  }

  return signedIn(p.url())
}

export async function disconnect(): Promise<void> {
  // Closing the tab we opened, not the browser: over CDP `browser.close()`
  // only drops the connection, and the tab would be left behind. Restarts
  // otherwise pile up an abandoned LinkedIn tab every time.
  await page?.close().catch(() => {})
  await browser?.close().catch(() => {})
  browser = null
  page = null
}

let shuttingDown = false

export function closeTabOnExit(): void {
  const cleanup = () => {
    if (shuttingDown) return
    shuttingDown = true
    void disconnect().finally(() => process.exit(0))
  }

  process.once('SIGINT', cleanup)
  process.once('SIGTERM', cleanup)
}
