/**
 * Regenerates the screenshots in docs/screenshots.
 *
 * Needs the app running (`npm run dev`) and the browser up (`npm run chrome`).
 * Run with: npx tsx scripts/screenshots.mts
 *
 * It drives a throwaway tab of its own so it never disturbs the working tab.
 */
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Page } from 'playwright-core'

const APP = process.env.INCLEANUP_APP_URL ?? 'http://localhost:5273'
const CDP = `http://127.0.0.1:${process.env.INCLEANUP_CDP_PORT ?? 9222}`
const OUT = path.join(process.cwd(), 'docs', 'screenshots')

const settle = (page: Page, ms = 1200) => page.waitForTimeout(ms)

/**
 * These shots go in a public README, and the lists are full of real people and
 * the pages a real account follows. Everything identifying is blurred before
 * anything is captured — blurred rather than swapped for invented names, so
 * there is no chance of a made-up name landing on a real person.
 *
 * Only the identifying parts go: counts, dates and the controls stay legible,
 * which is what the screenshots are meant to show.
 */
const ANONYMISE = `(() => {
  if (!document.getElementById('anon-style')) {
    const style = document.createElement('style')
    style.id = 'anon-style'
    style.textContent =
      '.anon-blur { filter: blur(7px); }' +
      '.avatar { filter: blur(8px); }'
    document.head.appendChild(style)
  }

  // Wrapping the text rather than blurring the element keeps sibling badges,
  // such as the "company?" tag, readable.
  const blurText = (el) => {
    if (!el) return
    for (const node of [...el.childNodes]) {
      if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue
      const span = document.createElement('span')
      span.className = 'anon-blur'
      span.textContent = node.textContent
      node.replaceWith(span)
    }
  }

  for (const row of document.querySelectorAll('.row')) {
    blurText(row.querySelector('.name'))
    blurText(row.querySelector('.headline'))
  }

  for (const item of document.querySelectorAll('.preview li:not(.more)')) blurText(item)
})()`

async function shoot(page: Page, name: string) {
  await page.evaluate(ANONYMISE)
  await page.waitForTimeout(250)
  await page.screenshot({ path: path.join(OUT, `${name}.png`) })
  console.log('wrote', `${name}.png`)
}

/**
 * Pins the theme explicitly. Leaving it to the system preference would make the
 * screenshots depend on whoever regenerates them.
 */
async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate(`(() => {
    localStorage.setItem('theme', ${JSON.stringify(theme)})
    document.documentElement.dataset.theme = ${JSON.stringify(theme)}
  })()`)
  await settle(page, 300)
}

/**
 * Crops the app's own wordmark for the README, rather than redrawing it by
 * hand: the logo there is then the real one, and it follows the header
 * whenever that changes. Zoomed first so it stays crisp on a dense display.
 */
async function shootLogo(page: Page, name: string) {
  await page.evaluate(`(() => {
    const style = document.createElement('style')
    style.id = 'logo-shot'
    style.textContent =
      '.brand { zoom: 2; padding: 10px 16px; background: var(--surface); border-radius: 10px; }' +
      // The connection status is app state, not part of the mark.
      '.brand .pill { display: none; }'
    document.head.appendChild(style)
  })()`)
  await settle(page, 300)

  await page.locator('.brand').screenshot({ path: path.join(OUT, `${name}.png`) })
  console.log('wrote', `${name}.png`)

  await page.evaluate(`document.getElementById('logo-shot')?.remove()`)
  await settle(page, 200)
}

/** Clears filters and selection so each shot starts from a known state. */
async function reset(page: Page) {
  await page.evaluate(`(() => {
    const box = document.querySelector('.filter.checkbox input')
    if (box && box.checked) box.click()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }))
    document.querySelector('.list').scrollTop = 0
  })()`)
  await settle(page, 400)
}

const browser = await chromium.connectOverCDP(CDP)
const context = browser.contexts()[0]!
const page = await context.newPage()

try {
  await mkdir(OUT, { recursive: true })
  await page.setViewportSize({ width: 1280, height: 800 })

  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await settle(page, 2500)
  await setTheme(page, 'light')
  await reset(page)
  await shootLogo(page, 'logo-light')
  await shoot(page, 'connections')

  // Filtered down to people sharing nobody, with a few marked for removal.
  await page.evaluate(`(() => {
    const select = document.querySelector('.filter select')
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
    setter.call(select, '0')
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await settle(page)
  // One key at a time: fired back to back, every press lands on the same row
  // because React has not re-rendered the cursor in between.
  for (let i = 0; i < 3; i++) {
    await page.evaluate(
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))`,
    )
    await settle(page, 150)
    await page.evaluate(
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`,
    )
    await settle(page, 150)
  }
  await settle(page, 600)
  await shoot(page, 'filtered')

  // The confirmation, including dry run. Nothing is ever confirmed here.
  await page.evaluate(`(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })()`)
  await settle(page)
  await shoot(page, 'confirm')
  await page.evaluate(
    `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
  )
  await settle(page, 400)

  // Followed pages, in dark mode.
  await setTheme(page, 'dark')
  await shootLogo(page, 'logo-dark')
  await page.evaluate(`(() => {
    const tab = [...document.querySelectorAll('.tab')].find((b) => /Followed pages/.test(b.textContent))
    if (tab) tab.click()
  })()`)
  await settle(page, 1500)
  await reset(page)
  await shoot(page, 'pages-dark')
} finally {
  // Never leave a preference behind in the profile this ran against.
  await page.evaluate(`localStorage.removeItem('theme')`).catch(() => {})
  await page.close().catch(() => {})
  await browser.close().catch(() => {})
}
