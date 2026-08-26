import { useCallback, useRef, useState } from 'react'
import { subscribeToJob, type JobEvent, type RemovalResult } from './api.ts'

export type JobView = {
  id: string
  kind: 'scrape' | 'remove'
  lines: string[]
  done: number
  total: number | null
  results: RemovalResult[]
  status: 'running' | 'done' | 'error'
  summary: string | null
}

export function useJob(onFinished?: () => void) {
  const [job, setJob] = useState<JobView | null>(null)
  const unsubscribe = useRef<(() => void) | null>(null)

  const attach = useCallback(
    (id: string, kind: 'scrape' | 'remove') => {
      unsubscribe.current?.()
      setJob({ id, kind, lines: [], done: 0, total: null, results: [], status: 'running', summary: null })

      unsubscribe.current = subscribeToJob(id, (event: JobEvent) => {
        setJob((previous) => {
          if (!previous || previous.id !== id) return previous
          switch (event.type) {
            case 'log':
              return { ...previous, lines: [...previous.lines, event.message] }
            case 'progress':
              return { ...previous, done: event.done, total: event.total, lines: [...previous.lines, event.message] }
            case 'result':
              return { ...previous, results: [...previous.results, event.result] }
            case 'done':
              return { ...previous, status: 'done', summary: event.summary }
            case 'error':
              return { ...previous, status: 'error', summary: event.message }
          }
        })

        if (event.type === 'done' || event.type === 'error') onFinished?.()
      })
    },
    [onFinished],
  )

  const dismiss = useCallback(() => {
    unsubscribe.current?.()
    unsubscribe.current = null
    setJob(null)
  }, [])

  return { job, attach, dismiss }
}
