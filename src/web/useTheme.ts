import { useCallback, useEffect, useState } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'

const ORDER: ThemePreference[] = ['system', 'light', 'dark']

const prefersDark = () => matchMedia('(prefers-color-scheme: dark)').matches

const apply = (preference: ThemePreference) => {
  const dark = preference === 'dark' || (preference === 'system' && prefersDark())
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

/**
 * The resolved theme lives on the document rather than in CSS media queries, so
 * an explicit choice can override the system one. index.html applies the stored
 * value before first paint; this keeps it in step afterwards.
 */
export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(
    () => (localStorage.getItem('theme') as ThemePreference | null) ?? 'system',
  )

  useEffect(() => {
    apply(preference)
    localStorage.setItem('theme', preference)

    if (preference !== 'system') return
    const media = matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => apply('system')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [preference])

  const cycle = useCallback(() => {
    setPreference((current) => ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]!)
  }, [])

  return { preference, cycle }
}
