import type { Page } from 'playwright-core'
import { HARVEST_NEW_CONNECTIONS, HARVEST_TOTAL, SCROLL_TO_END } from './harvest.ts'
import {
  HARVEST_FOLLOWED_PEOPLE,
  HARVEST_MANAGER_TOTAL,
  HARVEST_PAGES,
} from './harvestManager.ts'
import { CONNECTIONS_URL, profileUrl } from './linkedin.ts'
import type { DatasetKind, Entity } from './types.ts'

export const PAGES_URL = 'https://www.linkedin.com/mynetwork/network-manager/company/'
export const FOLLOWING_URL =
  'https://www.linkedin.com/mynetwork/network-manager/people-follow/following/'

type RawCard = {
  id: string
  name: string
  headline: string
  avatarUrl?: string
  connectedText?: string
}

export type DatasetSpec = {
  /** Used in prose: job messages, dialogs. */
  label: string
  /** Used on the tab, where width is scarce. */
  short: string
  url: string
  harvest: string
  total: string
  /** What acting on an entry does, for logs and UI copy. */
  verb: 'remove' | 'unfollow'
  toEntity: (card: RawCard) => Entity
}

const TURKISH_MONTHS = [
  'ocak',
  'şubat',
  'mart',
  'nisan',
  'mayıs',
  'haziran',
  'temmuz',
  'ağustos',
  'eylül',
  'ekim',
  'kasım',
  'aralık',
]

/**
 * "Connected on June 29, 2026" / "22 Ağustos 2024". The label has to be matched
 * around rather than stripped — trimming to the first digit eats the month.
 */
export const parseConnectedText = (text: string): number | undefined => {
  const english = text.match(/([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})/)
  if (english) {
    const parsed = Date.parse(`${english[1]} ${english[2]}, ${english[3]}`)
    if (Number.isFinite(parsed)) return parsed
  }

  const turkish = text.match(/(\d{1,2})\s+([^\s\d]+)\s+(\d{4})/)
  if (turkish) {
    const month = TURKISH_MONTHS.indexOf(turkish[2]!.toLocaleLowerCase('tr'))
    if (month >= 0) return Date.UTC(Number(turkish[3]), month, Number(turkish[1]))
  }

  return undefined
}

export const DATASETS: Record<DatasetKind, DatasetSpec> = {
  connections: {
    label: 'Connections',
    short: 'Connections',
    url: CONNECTIONS_URL,
    harvest: HARVEST_NEW_CONNECTIONS,
    total: HARVEST_TOTAL,
    verb: 'remove',
    toEntity: (card) => ({
      id: card.id,
      name: card.name || card.id,
      headline: card.headline,
      url: profileUrl(card.id),
      avatarUrl: card.avatarUrl || undefined,
      connectedAt: parseConnectedText(card.connectedText ?? ''),
    }),
  },
  pages: {
    label: 'Followed pages',
    short: 'Pages',
    url: PAGES_URL,
    harvest: HARVEST_PAGES,
    total: HARVEST_MANAGER_TOTAL,
    verb: 'unfollow',
    toEntity: (card) => ({
      id: card.id,
      name: card.name || card.id,
      headline: card.headline,
      url: `https://www.linkedin.com/company/${card.id}/`,
      avatarUrl: card.avatarUrl || undefined,
    }),
  },
  following: {
    label: 'People you follow',
    short: 'Following',
    url: FOLLOWING_URL,
    harvest: HARVEST_FOLLOWED_PEOPLE,
    total: HARVEST_MANAGER_TOTAL,
    verb: 'unfollow',
    toEntity: (card) => ({
      id: card.id,
      name: card.name || card.id,
      headline: card.headline,
      url: profileUrl(card.id),
      avatarUrl: card.avatarUrl || undefined,
    }),
  },
}

/**
 * Some lists page in with a button instead of on scroll, in which case
 * scrolling alone stalls after the first screenful.
 */
export async function clickLoadMore(page: Page): Promise<void> {
  const button = page
    .getByRole('button', {
      name: /^(load more|show more results|show more|daha fazla|daha fazla sonuç)/i,
    })
    .first()
  if (await button.isVisible().catch(() => false)) await button.click().catch(() => {})
}

export { SCROLL_TO_END }
export type { RawCard }
