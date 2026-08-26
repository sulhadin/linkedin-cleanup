# incleanup

A local, keyboard-driven tool for pruning your LinkedIn connections.

It attaches to a Chromium-family browser you are already logged into, reads your
connection list, shows it in a fast list you drive with `↑`/`↓` and `space`, and
then removes everything you marked — one profile at a time, through the same UI
a person would click.

Nothing leaves your machine. There is no server, no account, no API key, and
incleanup never sees or asks for your LinkedIn password.

## Requirements

- Node 20+
- Chrome, Brave, or Chromium

## Setup

```bash
npm install
```

## Running

**1. Start the browser with remote debugging.**

```bash
npm run brave
```

Use `npm run chrome` for Chrome, or `npm run browser` to autodetect.

This opens a **separate browser profile** at `~/.incleanup/<family>-profile`.
That is not a choice — since Chromium 136 the remote debugging port is refused
for your default profile, so a dedicated one is the only way. Log in to LinkedIn
in that window once; the session persists across runs.

**2. Start incleanup.**

```bash
npm run dev
```

Open http://localhost:5273.

**3. Scan, select, remove.**

Press `r` to scan. Mark people with `space`, then press `↵` and confirm.

## Keyboard

| Key            | Action                                    |
| -------------- | ----------------------------------------- |
| `↑` `↓` / `k` `j` | Move the cursor                        |
| `space`        | Toggle the row under the cursor           |
| `shift`+`↑`/`↓`  | Extend the selection while moving       |
| `PgUp` `PgDn` `Home` `End` | Jump                          |
| `a`            | Select / deselect everything in view      |
| `n`            | Clear the selection                       |
| `/`            | Focus search (`esc` to leave)             |
| `esc`          | Clear the search, then the selection      |
| `r`            | Rescan connections                        |
| `↵`            | Remove the selection (opens a confirm)    |
| `d`            | Toggle dry run, in the confirm dialog     |

## Safety

Removing a connection is **not reversible** on LinkedIn — re-adding someone
means sending a fresh invite they have to accept.

- The confirm dialog has a **dry run** mode: it finds each person and verifies
  the "Remove connection" control is reachable, then closes the menu without
  clicking it. It cannot remove anyone.
- Every attempt is appended to `~/.incleanup/removals.log` (timestamp, outcome,
  profile id, name), so you can always find someone you cut by mistake.
- Removals are capped at 100 per run and paced 3.5–7s apart. LinkedIn does throttle
  accounts that behave like scripts; do not raise these without thinking about it.

## How it works

| Piece            | Approach                                                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser access   | `playwright-core` attaches over CDP to a browser you launched. It only ever drives a tab it opened itself — your other tabs are never read or navigated.  |
| Reading the list | The connections page is scrolled to the end and rows are read from the DOM as they appear, since LinkedIn virtualises the list. The page's own declared total is used as the target so a mid-list stall is not mistaken for the end. incleanup makes no API calls of its own. |
| Removing         | Done from the connections list, never by opening profiles — so nobody gets a "viewed your profile" notice. Each person is filtered in by name, matched by profile id, then **More actions → Remove connection** (plus a confirmation, if LinkedIn asks for one). Labels are matched in English and Turkish. |
| Storage          | `~/.incleanup/connections.json` (snapshot) and `~/.incleanup/removals.log`. Neither is ever committed.                                                    |

## Configuration

All optional, via environment variables:

| Variable                       | Default | Meaning                             |
| ------------------------------ | ------- | ----------------------------------- |
| `INCLEANUP_PORT`               | `5274`  | API port                            |
| `INCLEANUP_CDP_PORT`           | `9222`  | Browser remote debugging port       |
| `INCLEANUP_DATA_DIR`           | `~/.incleanup` | Snapshot + log location      |
| `INCLEANUP_MAX_REMOVALS`       | `100`   | Hard cap per run                    |
| `INCLEANUP_REMOVAL_DELAY_MIN`  | `3500`  | Min pause between removals (ms)     |
| `INCLEANUP_REMOVAL_DELAY_MAX`  | `7000`  | Max pause between removals (ms)     |
| `INCLEANUP_MAX_CONNECTIONS`    | `5000`  | Scan ceiling                        |
| `INCLEANUP_BROWSER_BIN`        | —       | Explicit browser binary path        |

## Caveats

LinkedIn rewrites its markup often. Rows are found by `componentkey`, with a
structural fallback that infers cards from the profile links themselves. If a
scan returns nothing, or removals start reporting "Card has no More actions
button", the selectors live in `src/server/harvest.ts` and
`src/server/remove.ts`.

A scan of ~1,200 connections takes several minutes; partial results are written
to disk every 200 people, so an interrupted scan is not wasted.

Automating your own account is your call and your risk — LinkedIn's User
Agreement discourages automated access regardless of intent.

## License

MIT
