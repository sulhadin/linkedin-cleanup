import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getConnections,
  getStatus,
  startRemoval,
  startScrape,
  stopJob,
  type Connection,
  type Status,
} from './api.ts'
import { useJob } from './useJob.ts'

const ROW_HEIGHT = 68
const OVERSCAN = 6

type Mode = 'list' | 'confirm'

export function App() {
  const [status, setStatus] = useState<Status | null>(null)
  const [connections, setConnections] = useState<Connection[]>([])
  const [scrapedAt, setScrapedAt] = useState<number | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [mode, setMode] = useState<Mode>('list')
  const [dryRun, setDryRun] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(600)

  const refreshConnections = useCallback(async () => {
    const snapshot = await getConnections()
    setConnections(snapshot.connections)
    setScrapedAt(snapshot.scrapedAt)
  }, [])

  const { job, attach, dismiss } = useJob(refreshConnections)

  useEffect(() => {
    void getStatus().then(setStatus).catch(() => setStatus(null))
    void refreshConnections().catch((e: unknown) => setError(String(e)))
  }, [refreshConnections])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle.length === 0) return connections
    return connections.filter(
      (c) =>
        c.name.toLowerCase().includes(needle) ||
        c.headline.toLowerCase().includes(needle) ||
        c.id.toLowerCase().includes(needle),
    )
  }, [connections, query])

  useEffect(() => {
    setCursor((current) => Math.min(current, Math.max(0, filtered.length - 1)))
  }, [filtered.length])

  // Keep the cursor row inside the scroll viewport as it moves.
  useEffect(() => {
    const container = listRef.current
    if (!container) return
    const top = cursor * ROW_HEIGHT
    const bottom = top + ROW_HEIGHT
    if (top < container.scrollTop) container.scrollTop = top
    else if (bottom > container.scrollTop + container.clientHeight) {
      container.scrollTop = bottom - container.clientHeight
    }
  }, [cursor])

  useEffect(() => {
    const container = listRef.current
    if (!container) return
    const measure = () => setViewportHeight(container.clientHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const runScrape = useCallback(async () => {
    setError(null)
    try {
      const { jobId } = await startScrape()
      attach(jobId, 'scrape')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [attach])

  const runRemoval = useCallback(async () => {
    setError(null)
    const ids = [...selected]
    try {
      const { jobId } = await startRemoval(ids, dryRun)
      attach(jobId, 'remove')
      setMode('list')
      if (!dryRun) setSelected(new Set())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [attach, dryRun, selected])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const searchFocused = document.activeElement === searchRef.current

      if (mode === 'confirm') {
        if (event.key === 'Escape') {
          event.preventDefault()
          setMode('list')
        } else if (event.key === 'Enter') {
          event.preventDefault()
          void runRemoval()
        } else if (event.key.toLowerCase() === 'd') {
          event.preventDefault()
          setDryRun((value) => !value)
        }
        return
      }

      if (searchFocused) {
        if (event.key === 'Escape' || event.key === 'Enter') {
          event.preventDefault()
          searchRef.current?.blur()
        }
        return
      }

      const move = (delta: number) => {
        event.preventDefault()
        setCursor((current) => {
          const next = Math.min(Math.max(0, current + delta), Math.max(0, filtered.length - 1))
          // Shift paints a range: the row you land on joins the selection.
          if (event.shiftKey) {
            const landed = filtered[next]
            if (landed) setSelected((s) => new Set(s).add(landed.id))
          }
          return next
        })
      }

      const rowsPerPage = Math.max(1, Math.floor(viewportHeight / ROW_HEIGHT) - 1)

      switch (event.key) {
        case 'ArrowDown':
        case 'j':
          return move(1)
        case 'ArrowUp':
        case 'k':
          return move(-1)
        case 'PageDown':
          return move(rowsPerPage)
        case 'PageUp':
          return move(-rowsPerPage)
        case 'Home':
          return move(-filtered.length)
        case 'End':
          return move(filtered.length)
        case ' ': {
          event.preventDefault()
          const row = filtered[cursor]
          if (row) toggle(row.id)
          return
        }
        case 'Enter': {
          event.preventDefault()
          if (selected.size > 0 && job?.status !== 'running') setMode('confirm')
          return
        }
        case '/': {
          event.preventDefault()
          searchRef.current?.focus()
          return
        }
        case 'Escape': {
          event.preventDefault()
          if (query.length > 0) setQuery('')
          else setSelected(new Set())
          return
        }
        case 'a': {
          event.preventDefault()
          setSelected((current) => {
            const next = new Set(current)
            const allSelected = filtered.every((c) => next.has(c.id))
            for (const c of filtered) {
              if (allSelected) next.delete(c.id)
              else next.add(c.id)
            }
            return next
          })
          return
        }
        case 'n': {
          event.preventDefault()
          setSelected(new Set())
          return
        }
        case 'r': {
          event.preventDefault()
          if (job?.status !== 'running') void runScrape()
          return
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [cursor, filtered, job?.status, mode, query, runRemoval, runScrape, selected.size, toggle, viewportHeight])

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const end = Math.min(filtered.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN)
  const visible = filtered.slice(start, end)

  const busy = job?.status === 'running'

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <h1>incleanup</h1>
          <StatusPill status={status} />
        </div>
        <div className="counts">
          <span>
            <strong>{filtered.length}</strong> shown
          </span>
          <span>
            <strong>{connections.length}</strong> total
          </span>
          <span className={selected.size > 0 ? 'selected-count active' : 'selected-count'}>
            <strong>{selected.size}</strong> selected
          </span>
        </div>
        <div className="actions">
          <button onClick={() => void runScrape()} disabled={busy}>
            {connections.length === 0 ? 'Scan connections' : 'Rescan'} <kbd>r</kbd>
          </button>
          <button
            className="danger"
            onClick={() => setMode('confirm')}
            disabled={busy || selected.size === 0}
          >
            Remove {selected.size || ''} <kbd>↵</kbd>
          </button>
        </div>
      </header>

      {status && !status.chrome && <Banner tone="warn">{status.hint}</Banner>}
      {status?.chrome && !status.loggedIn && <Banner tone="warn">{status.hint}</Banner>}
      {error && <Banner tone="error">{error}</Banner>}

      <div className="searchbar">
        <input
          ref={searchRef}
          value={query}
          placeholder="Search by name, headline or profile id…   (press / to focus)"
          onChange={(event) => setQuery(event.target.value)}
        />
        {scrapedAt && (
          <span className="scraped-at">Last scan {new Date(scrapedAt).toLocaleString()}</span>
        )}
      </div>

      <div
        className="list"
        ref={listRef}
        tabIndex={-1}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        {filtered.length === 0 ? (
          <Empty hasConnections={connections.length > 0} />
        ) : (
          <div style={{ height: filtered.length * ROW_HEIGHT, position: 'relative' }}>
            {visible.map((connection, index) => {
              const absolute = start + index
              return (
                <Row
                  key={connection.id}
                  connection={connection}
                  top={absolute * ROW_HEIGHT}
                  isCursor={absolute === cursor}
                  isSelected={selected.has(connection.id)}
                  onClick={() => {
                    setCursor(absolute)
                    toggle(connection.id)
                  }}
                />
              )
            })}
          </div>
        )}
      </div>

      <footer className="help">
        <Hint keys="↑ ↓" label="move" />
        <Hint keys="space" label="select" />
        <Hint keys="shift+↑↓" label="range" />
        <Hint keys="a" label="all" />
        <Hint keys="n" label="none" />
        <Hint keys="/" label="search" />
        <Hint keys="r" label="rescan" />
        <Hint keys="↵" label="remove selected" />
      </footer>

      {mode === 'confirm' && (
        <ConfirmDialog
          count={selected.size}
          names={[...selected]
            .map((id) => connections.find((c) => c.id === id)?.name ?? id)
            .slice(0, 8)}
          dryRun={dryRun}
          onToggleDryRun={() => setDryRun((value) => !value)}
          onCancel={() => setMode('list')}
          onConfirm={() => void runRemoval()}
        />
      )}

      {job && (
        <JobPanel
          job={job}
          onStop={() => void stopJob(job.id)}
          onDismiss={dismiss}
        />
      )}
    </div>
  )
}

function Row({
  connection,
  top,
  isCursor,
  isSelected,
  onClick,
}: {
  connection: Connection
  top: number
  isCursor: boolean
  isSelected: boolean
  onClick: () => void
}) {
  const className = ['row', isCursor && 'cursor', isSelected && 'selected']
    .filter(Boolean)
    .join(' ')

  return (
    <div className={className} style={{ top, height: ROW_HEIGHT }} onClick={onClick}>
      <span className="checkbox" aria-hidden>
        {isSelected ? '◉' : '○'}
      </span>
      {connection.avatarUrl ? (
        <img className="avatar" src={connection.avatarUrl} alt="" loading="lazy" />
      ) : (
        <span className="avatar placeholder" aria-hidden>
          {connection.name.charAt(0)}
        </span>
      )}
      <span className="who">
        <span className="name">{connection.name}</span>
        <span className="headline">{connection.headline}</span>
      </span>
      {connection.connectedAt && (
        <span className="since">{new Date(connection.connectedAt).toLocaleDateString()}</span>
      )}
      <a
        className="open"
        href={connection.profileUrl}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => event.stopPropagation()}
      >
        profile ↗
      </a>
    </div>
  )
}

function ConfirmDialog({
  count,
  names,
  dryRun,
  onToggleDryRun,
  onCancel,
  onConfirm,
}: {
  count: number
  names: string[]
  dryRun: boolean
  onToggleDryRun: () => void
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="overlay">
      <div className="dialog">
        <h2>
          Remove {count} connection{count === 1 ? '' : 's'}?
        </h2>
        <ul className="preview">
          {names.map((name) => (
            <li key={name}>{name}</li>
          ))}
          {count > names.length && <li className="more">…and {count - names.length} more</li>}
        </ul>
        <p className="warning">
          LinkedIn does not undo this. Every attempt is appended to{' '}
          <code>~/.incleanup/removals.log</code> so you can find people again.
        </p>
        <label className="dry-run">
          <input type="checkbox" checked={dryRun} onChange={onToggleDryRun} />
          Dry run — walk each profile and open the dialog, but never confirm <kbd>d</kbd>
        </label>
        <div className="dialog-actions">
          <button onClick={onCancel}>
            Cancel <kbd>esc</kbd>
          </button>
          <button className="danger" onClick={onConfirm}>
            {dryRun ? 'Start dry run' : `Remove ${count}`} <kbd>↵</kbd>
          </button>
        </div>
      </div>
    </div>
  )
}

function JobPanel({
  job,
  onStop,
  onDismiss,
}: {
  job: NonNullable<ReturnType<typeof useJob>['job']>
  onStop: () => void
  onDismiss: () => void
}) {
  const percent = job.total ? Math.round((job.done / job.total) * 100) : null

  return (
    <div className="job-panel">
      <div className="job-head">
        <strong>{job.kind === 'scrape' ? 'Scanning connections' : 'Removing connections'}</strong>
        <span className={`job-status ${job.status}`}>{job.summary ?? `${job.done}${job.total ? `/${job.total}` : ''}`}</span>
        {job.status === 'running' ? (
          <button onClick={onStop}>Stop</button>
        ) : (
          <button onClick={onDismiss}>Close</button>
        )}
      </div>
      {percent !== null && (
        <div className="progress">
          <div className="bar" style={{ width: `${percent}%` }} />
        </div>
      )}
      <div className="job-log">
        {job.lines.slice(-6).map((line, index) => (
          <div key={`${index}-${line}`}>{line}</div>
        ))}
      </div>
      {job.results.some((result) => result.outcome === 'failed') && (
        <div className="job-failures">
          {job.results
            .filter((result) => result.outcome === 'failed')
            .map((result) => (
              <div key={result.id}>
                ✗ {result.name} — {result.error}
              </div>
            ))}
        </div>
      )}
    </div>
  )
}

function StatusPill({ status }: { status: Status | null }) {
  if (!status) return <span className="pill unknown">api offline</span>
  if (!status.chrome) return <span className="pill bad">chrome not attached</span>
  if (!status.loggedIn) return <span className="pill warn">not logged in</span>
  return <span className="pill good">connected</span>
}

function Banner({ tone, children }: { tone: 'warn' | 'error'; children: React.ReactNode }) {
  return <div className={`banner ${tone}`}>{children}</div>
}

function Empty({ hasConnections }: { hasConnections: boolean }) {
  return (
    <div className="empty">
      {hasConnections ? (
        <p>Nothing matches that search.</p>
      ) : (
        <>
          <p>No connections scanned yet.</p>
          <p className="dim">
            Start the browser with <code>npm run brave</code> (or <code>npm run chrome</code>), log
            in to LinkedIn, then press <kbd>r</kbd>.
          </p>
        </>
      )}
    </div>
  )
}

function Hint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="hint">
      <kbd>{keys}</kbd> {label}
    </span>
  )
}
