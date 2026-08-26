/**
 * Browser-side DOM harvesting, kept as source strings on purpose.
 *
 * tsx compiles with esbuild's `keepNames`, which rewrites named function
 * expressions into calls to a `__name` helper that does not exist inside the
 * page. Anything passed to `page.evaluate` as a function would break the moment
 * it declared a nested helper, so this code crosses the boundary as text.
 *
 * State is cached on `window` between rounds. A fresh navigation clears it,
 * which is exactly when it should be recomputed.
 */

/**
 * Returns only the cards that have appeared since the previous call:
 * `{ id, name, headline, connectedText, avatarUrl }[]`.
 *
 * Locating a card by walking up from every anchor is quadratic once the list
 * holds hundreds of rows, and reading `innerText` forces a reflow per card. So
 * the list container is resolved once, and each round touches only rows whose
 * profile id is new.
 */
export const HARVEST_NEW_CONNECTIONS = `(() => {
  const idOf = (el) => {
    const href = el.getAttribute('href') || ''
    const match = href.match(/\\/in\\/([^/?#]+)/)
    return match ? decodeURIComponent(match[1]) : null
  }

  const hasMultipleProfiles = (el) => {
    let seen = null
    for (const anchor of el.querySelectorAll('a[href*="/in/"]')) {
      const id = idOf(anchor)
      if (!id) continue
      if (seen === null) seen = id
      else if (seen !== id) return true
    }
    return false
  }

  // The list container is the parent of the largest group of sibling cards; a
  // card is the largest ancestor of an anchor that still holds one profile.
  const findContainer = () => {
    const counts = new Map()
    const cards = new Set()

    for (const anchor of document.querySelectorAll('a[href*="/in/"]')) {
      if (!idOf(anchor)) continue

      let card = anchor
      for (let depth = 0; depth < 15; depth++) {
        const parent = card.parentElement
        if (!parent || parent === document.body) break
        if (hasMultipleProfiles(parent)) break
        card = parent
      }
      if (cards.has(card)) continue
      cards.add(card)

      const parent = card.parentElement
      if (parent) counts.set(parent, (counts.get(parent) || 0) + 1)
    }

    let best = null
    let bestCount = 0
    for (const [element, count] of counts) {
      if (count > bestCount) {
        best = element
        bestCount = count
      }
    }
    return best
  }

  if (!window.__incleanupSeen) window.__incleanupSeen = new Set()
  const seen = window.__incleanupSeen

  let container = window.__incleanupContainer
  if (!container || !container.isConnected) {
    container = findContainer()
    window.__incleanupContainer = container
  }
  if (!container) return []

  const found = []
  for (const card of container.children) {
    const anchor = card.querySelector('a[href*="/in/"]')
    if (!anchor) continue

    const id = idOf(anchor)
    if (!id || seen.has(id)) continue
    seen.add(id)

    const lines = (card.innerText || '')
      .split('\\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    if (lines.length === 0) continue

    const name = lines[0]
    const connectedText =
      lines.find((line) => /^(connected on|bağlantı kurulma|bağlantı tarihi)/i.test(line)) || ''
    const headline =
      lines.find(
        (line) =>
          line !== name &&
          line !== connectedText &&
          !/^(message|mesaj|connected|bağlantı|following|takip)/i.test(line) &&
          !/^\\d+(st|nd|rd|th)$/i.test(line) &&
          line.length > 2,
      ) || ''

    const img = card.querySelector('img')
    const avatarUrl = img && /^https?:/.test(img.src) ? img.src : ''

    found.push({ id: id, name: name, headline: headline, connectedText: connectedText, avatarUrl: avatarUrl })
  }

  // Nothing new can mean the list moved to a different container, so make the
  // next round re-resolve it rather than sitting on a stale one.
  if (found.length === 0) window.__incleanupContainer = null

  return found
})()`

/**
 * The connections page states its own total ("1,217 connections"). Knowing it
 * turns the scroll loop from "stop when it looks finished" — which LinkedIn
 * defeats by stalling mid-list for several seconds — into a real target.
 */
export const HARVEST_TOTAL = `(() => {
  const match = document.body.innerText.match(/([\\d][\\d.,\\u00a0 ]*)\\s*(connections|bağlantı)/i)
  if (!match) return null
  const count = Number(match[1].replace(/[^\\d]/g, ''))
  return Number.isFinite(count) && count > 0 ? count : null
})()`

/**
 * The list lives in an inner scroll pane, not the window. The pane is picked by
 * how many profiles it contains rather than by size — sizing alone picks up
 * unrelated wrappers, and then the scroll silently does nothing.
 */
export const SCROLL_TO_END = `(() => {
  let pane = window.__incleanupPane
  if (!pane || !pane.isConnected || pane.scrollHeight <= pane.clientHeight + 200) {
    pane = null
    let bestProfiles = 0
    for (const el of document.querySelectorAll('div, main, section, ul')) {
      if (el.scrollHeight <= el.clientHeight + 200) continue
      const profiles = el.querySelectorAll('a[href*="/in/"]').length
      if (profiles < 4) continue
      if (profiles > bestProfiles) {
        pane = el
        bestProfiles = profiles
      }
    }
    window.__incleanupPane = pane
  }

  if (pane) {
    pane.scrollTop = pane.scrollHeight
    return pane.scrollHeight
  }

  window.scrollTo(0, document.documentElement.scrollHeight)
  return document.documentElement.scrollHeight
})()`
