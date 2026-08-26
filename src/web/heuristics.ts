import type { Entity } from './api.ts'

/**
 * LinkedIn only lets people connect to people, so a company never shows up in
 * the connections list as such — but brands, agencies and bots do run personal
 * profiles. There is no reliable marker for that, so this is openly a guess:
 * it flags candidates and shows why, and the decision stays with the reader.
 */

const NAME_TOKENS = [
  'ltd',
  'ltd.',
  'llc',
  'inc',
  'inc.',
  'corp',
  'gmbh',
  'a.ş',
  'a.ş.',
  'aş',
  'şti',
  'holding',
  'group',
  'agency',
  'solutions',
  'technologies',
  'systems',
  'software',
  'consulting',
  'recruitment',
  'digital',
  'studio',
  'labs',
  'academy',
  'akademi',
  'yazılım',
  'bilişim',
  'teknoloji',
  'danışmanlık',
  'ajans',
]

const HEADLINE_PHRASES = [
  /\bwe (are|help|build|provide|offer)\b/i,
  /\b(contact|follow|dm|message) us\b/i,
  /\bour (team|clients|services)\b/i,
  /\bbize ulaş/i,
  /\bhizmet ver/i,
]

export type CorporateVerdict = { flagged: boolean; reasons: string[] }

export function looksCorporate(entity: Entity): CorporateVerdict {
  const reasons: string[] = []
  const words = entity.name.toLocaleLowerCase('tr').split(/[\s,]+/).filter(Boolean)

  const token = words.find((word) => NAME_TOKENS.includes(word.replace(/[^\p{L}.ş]/gu, '')))
  if (token) reasons.push(`name contains “${token}”`)

  if (/[|•·]/.test(entity.name)) reasons.push('name reads like a banner')

  const phrase = HEADLINE_PHRASES.find((pattern) => pattern.test(entity.headline))
  if (phrase) reasons.push('headline speaks as an organisation')

  // A profile nobody in your network shares is weak evidence on its own, so it
  // only counts once something else already looks off.
  if (reasons.length > 0 && entity.mutual === 0) reasons.push('no shared connections')

  return { flagged: reasons.length > 0, reasons }
}
