import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getDataset,
  getStatus,
  startAction,
  startEnrich,
  startScan,
  stopJob,
  type DatasetInfo,
  type DatasetKind,
  type Entity,
  type Status,
} from './api.ts'
import {
  IconAuto,
  IconBuilding,
  IconCheckSquare,
  IconClose,
  IconExternal,
  IconMoon,
  IconRefresh,
  IconSearch,
  IconSquare,
  IconStop,
  IconSun,
  IconTrash,
  IconUserCheck,
  IconUserMinus,
  IconUsers,
} from './icons.tsx'
import { looksCorporate } from './heuristics.ts'
import { useJob } from './useJob.ts'
import { useTheme } from './useTheme.ts'

const ROW_HEIGHT = 92
const OVERSCAN = 6

const TAB_ICONS = {
  connections: IconUsers,
  pages: IconBuilding,
  following: IconUserCheck,
} as const

const MUTUAL_OPTIONS = [
  { value: 'any', label: 'Any' },
  { value: '0', label: '0' },
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '4', label: '4' },
  { value: '5+', label: '5+' },
  { value: 'unknown', label: 'Unknown' },
] as const

type MutualFilter = (typeof MUTUAL_OPTIONS)[number]['value']

const matchesMutual = (entity: Entity, filter: MutualFilter): boolean => {
  if (filter === 'any') return true
  // Not looked up and "LinkedIn would not say" are both unknown, never zero.
  if (entity.mutual === undefined || entity.mutual === null) return filter === 'unknown'
  if (filter === 'unknown') return false
  if (filter === '5+') return entity.mutual >= 5
  return entity.mutual === Number(filter)
}

export function App() {
  const [status, setStatus] = useState<Status | null>(null)
  const [kind, setKind] = useState<DatasetKind>('connections')
  const [entities, setEntities] = useState<Entity[]>([])
  const [scrapedAt, setScrapedAt] = useState<number | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [mutualFilter, setMutualFilter] = useState<MutualFilter>('any')
  const [corporateOnly, setCorporateOnly] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [confirming, setConfirming] = useState(false)
  const [dryRun, setDryRun] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { preference: theme, cycle: cycleTheme } = useTheme()
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(600)

  const dataset: DatasetInfo | undefined = status?.datasets.find((d) => d.kind === kind)
  const verb = dataset?.verb ?? 'remove'
  const isConnections = kind === 'connections'

  const refresh = useCallback(async () => {
    const snapshot = await getDataset(kind)
    setEntities(snapshot.entities)
    setScrapedAt(snapshot.scrapedAt)

    // Entries acted on are gone from the snapshot; keeping them selected would
    // leave the count pointing at people who are no longer there.
    const present = new Set(snapshot.entities.map((entity) => entity.id))
    setSelected((current) => {
      const kept = [...current].filter((id) => present.has(id))
      return kept.length === current.size ? current : new Set(kept)
    })
  }, [kind])

  const { job, attach, dismiss } = useJob(refresh)

  useEffect(() => {
    void getStatus().then(setStatus).catch(() => setStatus(null))
  }, [])

  useEffect(() => {
    setSelected(new Set())
    setCursor(0)
    void refresh().catch((e: unknown) => setError(String(e)))
  }, [refresh])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return entities.filter((entity) => {
      if (needle.length > 0) {
        const haystack = `${entity.name} ${entity.headline} ${entity.id}`.toLowerCase()
        if (!haystack.includes(needle)) return false
      }
      if (isConnections && !matchesMutual(entity, mutualFilter)) return false
      if (corporateOnly && !looksCorporate(entity).flagged) return false
      return true
    })
  }, [entities, query, mutualFilter, corporateOnly, isConnections])

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

  const selectAllFiltered = useCallback(() => {
    setSelected((current) => {
      const next = new Set(current)
      const allSelected = filtered.length > 0 && filtered.every((e) => next.has(e.id))
      for (const entity of filtered) {
        if (allSelected) next.delete(entity.id)
        else next.add(entity.id)
      }
      return next
    })
  }, [filtered])

  const run = useCallback(
    async (start: () => Promise<{ jobId: string }>, jobKind: 'scan' | 'act' | 'enrich') => {
      setError(null)
      try {
        const { jobId } = await start()
        attach(jobId, jobKind)
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [attach],
  )

  const runScan = useCallback(() => run(() => startScan(kind), 'scan'), [kind, run])
  const runEnrich = useCallback(() => run(() => startEnrich(), 'enrich'), [run])

  const runAction = useCallback(async () => {
    await run(() => startAction(kind, [...selected], dryRun), 'act')
    setConfirming(false)
    // A dry run changes nothing, so the selection is still what you want to act
    // on; a real run has consumed it.
    if (!dryRun) setSelected(new Set())
  }, [dryRun, kind, run, selected])

  const busy = job?.status === 'running'

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (confirming) {
        if (event.key === 'Escape') {
          event.preventDefault()
          setConfirming(false)
        } else if (event.key === 'Enter') {
          event.preventDefault()
          void runAction()
        } else if (event.key.toLowerCase() === 'd') {
          event.preventDefault()
          setDryRun((value) => !value)
        }
        return
      }

      // Only typing should swallow the shortcuts. Clicking a button leaves it
      // focused, and bailing on that would kill every key until the next click.
      const active = document.activeElement as HTMLElement | null
      const typing =
        active?.isContentEditable === true ||
        active?.tagName === 'TEXTAREA' ||
        active?.tagName === 'SELECT' ||
        (active?.tagName === 'INPUT' && (active as HTMLInputElement).type !== 'checkbox')

      if (typing) {
        if (event.key === 'Escape' || event.key === 'Enter') {
          event.preventDefault()
          active?.blur()
        }
        return
      }

      // A focused button would otherwise take the space bar as a click.
      if (active?.tagName === 'BUTTON') active.blur()

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
          if (selected.size > 0 && !busy) setConfirming(true)
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
          selectAllFiltered()
          return
        }
        case 'n': {
          event.preventDefault()
          setSelected(new Set())
          return
        }
        case 'r': {
          event.preventDefault()
          if (!busy) void runScan()
          return
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    busy,
    confirming,
    cursor,
    filtered,
    query,
    runAction,
    runScan,
    selectAllFiltered,
    selected.size,
    toggle,
    viewportHeight,
  ])

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const end = Math.min(
    filtered.length,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
  )
  const visible = filtered.slice(start, end)

  const enriched = entities.filter((e) => typeof e.mutual === 'number').length
  const allFilteredSelected = filtered.length > 0 && filtered.every((e) => selected.has(e.id))

  return (
    <div className="app">
      <div className="topbar">
        <header className="header">
        <div className="brand">
          <LinkedInMark />
          <h1>
            <span className="struck">LinkedIn</span> Cleanup
          </h1>
          <StatusPill status={status} />
        </div>
        <nav className="tabs">
          {(status?.datasets ?? []).map((info) => {
            const TabIcon = TAB_ICONS[info.kind]
            return (
              <button
                key={info.kind}
                className={info.kind === kind ? 'tab active' : 'tab'}
                onClick={() => setKind(info.kind)}
                disabled={busy}
              >
                <TabIcon />
                {info.label}
              </button>
            )
          })}
        </nav>
        <div className="actions">
          <button
            className="tab icon-only"
            onClick={cycleTheme}
            title={`Theme: ${theme} — click to change`}
            aria-label={`Theme: ${theme}`}
          >
            {theme === 'system' ? <IconAuto /> : theme === 'light' ? <IconSun /> : <IconMoon />}
          </button>
          <button onClick={() => void runScan()} disabled={busy}>
            <IconRefresh />
            {entities.length === 0 ? 'Scan' : 'Rescan'}
          </button>
          <button
            className="danger"
            onClick={() => setConfirming(true)}
            disabled={busy || selected.size === 0}
          >
            {verb === 'remove' ? <IconTrash /> : <IconUserMinus />}
            {verb === 'remove' ? 'Remove' : 'Unfollow'}
            {selected.size > 0 && ` ${selected.size}`}
          </button>
          </div>
        </header>
      </div>

      <div className="content">
      {status && !status.chrome && <Banner tone="warn">{status.hint}</Banner>}
      {status?.chrome && !status.loggedIn && <Banner tone="warn">{status.hint}</Banner>}
      {error && <Banner tone="error">{error}</Banner>}

      <div className="filters">
        <div className="search">
          <IconSearch />
          <input
            ref={searchRef}
            value={query}
            placeholder="Search name, headline or id…   (press / to focus)"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        {isConnections && (
          <label className="filter">
            Shared
            <select
              value={mutualFilter}
              onChange={(event) => setMutualFilter(event.target.value as MutualFilter)}
            >
              {MUTUAL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="filter checkbox">
          <input
            type="checkbox"
            checked={corporateOnly}
            onChange={(event) => setCorporateOnly(event.target.checked)}
          />
          <span>Looks like a company</span>
        </label>

        <button onClick={selectAllFiltered} disabled={filtered.length === 0}>
          {allFilteredSelected ? <IconSquare /> : <IconCheckSquare />}
          {allFilteredSelected ? 'Deselect' : 'Select'} all {filtered.length}
        </button>
      </div>

      <div className="statusline">
        <span>
          <strong>{filtered.length}</strong> shown of {entities.length}
        </span>
        <span className={selected.size > 0 ? 'active' : undefined}>
          <strong>{selected.size}</strong> selected
        </span>
        {isConnections && (
          <span>
            shared counts: <strong>{enriched}</strong>/{entities.length}
            <button className="link" onClick={() => void runEnrich()} disabled={busy}>
              look up
            </button>
          </span>
        )}
        {scrapedAt && <span className="dim">scanned {new Date(scrapedAt).toLocaleString()}</span>}
      </div>

      <div
        className="list"
        ref={listRef}
        tabIndex={-1}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        {filtered.length === 0 ? (
          <Empty hasEntities={entities.length > 0} label={dataset?.label ?? 'entries'} />
        ) : (
          <div style={{ height: filtered.length * ROW_HEIGHT, position: 'relative' }}>
            {visible.map((entity, index) => {
              const absolute = start + index
              return (
                <Row
                  key={entity.id}
                  entity={entity}
                  top={absolute * ROW_HEIGHT}
                  isCursor={absolute === cursor}
                  isSelected={selected.has(entity.id)}
                  showMutual={isConnections}
                  onClick={() => {
                    setCursor(absolute)
                    toggle(entity.id)
                  }}
                />
              )
            })}
          </div>
        )}
      </div>

      </div>

      <footer className="help">
        <Hint keys="↑ ↓" label="move" />
        <Hint keys="space" label="select" />
        <Hint keys="shift+↑↓" label="range" />
        <Hint keys="a" label="all shown" />
        <Hint keys="n" label="none" />
        <Hint keys="/" label="search" />
        <Hint keys="r" label="rescan" />
        <Hint keys="↵" label={verb === 'remove' ? 'remove selected' : 'unfollow selected'} />
      </footer>

      {confirming && (
        <ConfirmDialog
          verb={verb}
          count={selected.size}
          names={[...selected]
            .map((id) => entities.find((e) => e.id === id)?.name ?? id)
            .slice(0, 8)}
          dryRun={dryRun}
          onToggleDryRun={() => setDryRun((value) => !value)}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void runAction()}
        />
      )}

      {job && <JobPanel job={job} onStop={() => void stopJob(job.id)} onDismiss={dismiss} />}
    </div>
  )
}

function Row({
  entity,
  top,
  isCursor,
  isSelected,
  showMutual,
  onClick,
}: {
  entity: Entity
  top: number
  isCursor: boolean
  isSelected: boolean
  showMutual: boolean
  onClick: () => void
}) {
  const corporate = looksCorporate(entity)
  // LinkedIn's CDN is happy to serve these, but a blocker on a non-LinkedIn
  // origin is not, and an expired signature eventually 403s. Either way an
  // empty frame is worse than initials.
  const [imageBroken, setImageBroken] = useState(false)
  const className = ['row', isCursor && 'cursor', isSelected && 'selected']
    .filter(Boolean)
    .join(' ')

  return (
    <div className={className} style={{ top, height: ROW_HEIGHT }} onClick={onClick}>
      <span className="checkbox" aria-hidden>
        {isSelected ? '◉' : '○'}
      </span>
      {entity.avatarUrl && !imageBroken ? (
        <img
          className="avatar"
          src={`/api/avatar?u=${encodeURIComponent(entity.avatarUrl)}`}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImageBroken(true)}
        />
      ) : (
        <span className="avatar placeholder" aria-hidden>
          {entity.name.charAt(0)}
        </span>
      )}
      <span className="who">
        <span className="name">
          {entity.name}
          {corporate.flagged && (
            <span className="tag" title={corporate.reasons.join('; ')}>
              company?
            </span>
          )}
        </span>
        <span className="headline">{entity.headline}</span>
        <span className="meta">{describe(entity, showMutual)}</span>
      </span>
      <a
        className="open"
        href={entity.url}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => event.stopPropagation()}
      >
        <IconExternal size={14} />
        View profile
      </a>
    </div>
  )
}

/** The wording LinkedIn itself uses under a connection. */
function describe(entity: Entity, showMutual: boolean): string {
  const parts: string[] = []

  if (showMutual && typeof entity.mutual === 'number') {
    parts.push(`${entity.mutual} shared connection${entity.mutual === 1 ? '' : 's'}`)
  }
  if (entity.connectedAt) {
    parts.push(
      `Connected on ${new Date(entity.connectedAt).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })}`,
    )
  }

  return parts.join(' · ')
}

function ConfirmDialog({
  verb,
  count,
  names,
  dryRun,
  onToggleDryRun,
  onCancel,
  onConfirm,
}: {
  verb: 'remove' | 'unfollow'
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
          {verb === 'remove' ? 'Remove' : 'Unfollow'} {count} {count === 1 ? 'entry' : 'entries'}?
        </h2>
        <ul className="preview">
          {names.map((name) => (
            <li key={name}>{name}</li>
          ))}
          {count > names.length && <li className="more">…and {count - names.length} more</li>}
        </ul>
        <p className="warning">
          {verb === 'remove'
            ? 'LinkedIn does not undo this — re-adding means a fresh invite they must accept.'
            : 'You can follow a page again later, but the list of who you followed is not kept.'}{' '}
          Every attempt is appended to <code>~/.incleanup/removals.log</code>.
        </p>
        <label className="dry-run">
          <input type="checkbox" checked={dryRun} onChange={onToggleDryRun} />
          Dry run — find each one and check the control, but never click it
        </label>
        <div className="dialog-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="danger" onClick={onConfirm}>
            {!dryRun && (verb === 'remove' ? <IconTrash /> : <IconUserMinus />)}
            {dryRun ? 'Start dry run' : `${verb === 'remove' ? 'Remove' : 'Unfollow'} ${count}`}
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
  const title =
    job.kind === 'scan' ? 'Scanning' : job.kind === 'enrich' ? 'Looking up shared connections' : 'Working'

  return (
    <div className="job-panel">
      <div className="job-head">
        <strong>{title}</strong>
        <span className={`job-status ${job.status}`}>
          {job.summary ?? `${job.done}${job.total ? `/${job.total}` : ''}`}
        </span>
        {job.status === 'running' ? (
          <button onClick={onStop}>
            <IconStop size={14} />
            Stop
          </button>
        ) : (
          <button onClick={onDismiss}>
            <IconClose size={14} />
            Close
          </button>
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

function LinkedInMark() {
  return (
    <svg className="mark" viewBox="0 0 24 24" role="img" aria-label="LinkedIn">
      <path
        fill="currentColor"
        d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z"
      />
    </svg>
  )
}

function StatusPill({ status }: { status: Status | null }) {
  if (!status) return <span className="pill unknown">api offline</span>
  if (!status.chrome) return <span className="pill bad">browser not attached</span>
  if (!status.loggedIn) return <span className="pill warn">not logged in</span>
  return <span className="pill good">connected</span>
}

function Banner({ tone, children }: { tone: 'warn' | 'error'; children: React.ReactNode }) {
  return <div className={`banner ${tone}`}>{children}</div>
}

function Empty({ hasEntities, label }: { hasEntities: boolean; label: string }) {
  return (
    <div className="empty">
      {hasEntities ? (
        <p>Nothing matches these filters.</p>
      ) : (
        <>
          <p>No {label.toLowerCase()} scanned yet.</p>
          <p className="dim">
            Start the browser with <code>npm run chrome</code>, log in to LinkedIn, then press{' '}
            <kbd>r</kbd>.
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
