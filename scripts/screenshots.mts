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
 * These shots go in a public README, and the list is full of real people who
 * never agreed to appear there. Names and headlines are replaced and faces
 * blurred before anything is captured.
 */
const ANONYMISE = `(() => {
  const names = [
    'Alex Mercer', 'Priya Raman', 'Tomás Oliveira', 'Wei Chen', 'Sofia Lindqvist',
    'Daniel Okafor', 'Mira Halvorsen', 'Jonas Weber', 'Ana Ruiz', 'Kenji Sato',
    'Laura Bianchi', 'Omar Haddad', 'Nina Kowalski', 'Sam Doyle', 'Yara Nasser',
  ]
  const roles = [
    'Product Manager', 'Software Engineer', 'Talent Acquisition',
    'Head of Marketing', 'Data Analyst', 'Engineering Manager',
    'UX Researcher', 'Finance Lead', 'Account Executive',
  ]
  const companies = [
    'Northwind Labs', 'Corvus Analytics', 'Halden Group', 'Basalt Studio',
    'Verity Health', 'Orion Freight', 'Pinewood Media', 'Lumen Robotics',
    'Kestrel Capital', 'Tidal Systems', 'Ferrous Works', 'Bright Harbour',
  ]
  const followers = ['312,332 followers', '39 followers', '8,104 followers', '176,540 followers']

  // The pages tab lists organisations, so person names there would be a lie.
  const activeTab = document.querySelector('.tab.active')
  const isPages = /pages/i.test(activeTab ? activeTab.textContent : '')

  document.querySelectorAll('.row').forEach((row, index) => {
    const name = row.querySelector('.name')
    if (name) {
      const tag = name.querySelector('.tag')
      name.textContent = isPages
        ? companies[index % companies.length]
        : names[index % names.length]
      if (tag) name.appendChild(tag)
    }
    const headline = row.querySelector('.headline')
    if (headline) {
      headline.textContent = isPages
        ? followers[index % followers.length]
        : roles[index % roles.length]
    }
  })

  document.querySelectorAll('.preview li').forEach((item, index) => {
    if (!item.classList.contains('more')) item.textContent = names[index % names.length]
  })

  if (!document.getElementById('anon-style')) {
    const style = document.createElement('style')
    style.id = 'anon-style'
    style.textContent = 'img.avatar { filter: blur(7px); }'
    document.head.appendChild(style)
  }
})()`

async function shoot(page: Page, name: string) {
  await page.evaluate(ANONYMISE)
  await page.waitForTimeout(250)
  await page.screenshot({ path: path.join(OUT, `${name}.png`) })
  console.log('wrote', `${name}.png`)
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

  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await settle(page, 2500)
  await reset(page)
  await shoot(page, 'connections')

  // Filtered down to people sharing nobody, with a few marked for removal.
  await page.evaluate(`(() => {
    const select = document.querySelector('.filter select')
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
    setter.call(select, '0')
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await settle(page)
  await page.evaluate(`(() => {
    for (let i = 0; i < 3; i++) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    }
  })()`)
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
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.evaluate(`(() => {
    const tab = [...document.querySelectorAll('.tab')].find((b) => /Followed pages/.test(b.textContent))
    if (tab) tab.click()
  })()`)
  await settle(page, 1500)
  await reset(page)
  await shoot(page, 'pages-dark')
} finally {
  await page.close().catch(() => {})
  await browser.close().catch(() => {})
}
