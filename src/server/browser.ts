import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { config } from './config.ts'

export class ChromeUnreachableError extends Error {
  constructor(port: number) {
    super(
      `No Chrome with remote debugging on port ${port}. Start it with \`npm run chrome\`, ` +
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
 * The working tab. incleanup only ever drives a tab it opened itself — the
 * user's other tabs are visible over CDP but are never read or navigated.
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

/**
 * LinkedIn bounces logged-out visitors from /feed/ to a login or guest page.
 */
export async function checkLoggedIn(): Promise<boolean> {
  const p = await workPage()
  if (!p.url().includes('linkedin.com')) {
    await p.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' })
  }
  const url = p.url()
  return url.includes('linkedin.com') && !/\/(login|uas|checkpoint|signup)/.test(url)
}

export async function disconnect(): Promise<void> {
  await browser?.close().catch(() => {})
  browser = null
  page = null
}
