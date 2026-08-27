# incleanup

A local, keyboard-driven tool for pruning what has piled up on your LinkedIn
account: connections you no longer recognise, and pages and people you no longer
want in your feed.

It attaches to a Chromium-family browser you are already logged into, reads the
lists, shows them in a fast list you drive with `↑`/`↓` and `space`, and then
acts on everything you marked — one entry at a time, through the same controls
you would click yourself.

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
npm run chrome
```

Use `npm run brave` for Brave, or `npm run browser` to autodetect.

This opens a **separate browser profile** at `~/.incleanup/<family>-profile`.
That is not a choice — since Chromium 136 the remote debugging port is refused
for your default profile, so a dedicated one is the only way. Log in to LinkedIn
in that window once; the session persists across runs.

**2. Start incleanup.**

```bash
npm run dev
```

Open http://localhost:5273.

**3. Scan, filter, select, act.**

Press `r` to scan the active tab. Mark entries with `space`, or take the whole
filtered set with **Select all**. Press `↵` and confirm.

## What it can clean

| Tab                | Source                        | Action     |
| ------------------ | ----------------------------- | ---------- |
| Connections        | My Network → Connections      | Remove connection |
| Followed pages     | Network manager → Pages       | Unfollow   |
| People you follow  | Network manager → People      | Unfollow   |

Each tab keeps its own snapshot, so scanning one never disturbs another.

## Filters

- **Search** — name, headline, or profile id.
- **Shared** — how many connections you have in common: `0`, `1`, `2`, `3`, `4`,
  `5+`, or `Unknown`. Connections only.
- **Looks like a company** — flags profiles that read as a brand or agency
  rather than a person. This is openly a guess; hover the `company?` tag to see
  what triggered it, and check before acting.

### Shared connections need a lookup pass

The connections page never mentions shared connections, so the counts come from
a separate pass over 1st-degree people search (the **look up** link in the
status bar). It takes a few minutes.

LinkedIn caps that search at roughly 1,000 results, so on a larger network the
tail never appears. Those entries stay **Unknown** rather than being recorded as
zero — filtering for `0` will not quietly sweep up people whose count was simply
never available.

## Keyboard

| Key            | Action                                    |
| -------------- | ----------------------------------------- |
| `↑` `↓` / `k` `j` | Move the cursor                        |
| `space`        | Toggle the row under the cursor           |
| `shift`+`↑`/`↓`  | Extend the selection while moving       |
| `PgUp` `PgDn` `Home` `End` | Jump                          |
| `a`            | Select / deselect everything shown         |
| `n`            | Clear the selection                       |
| `/`            | Focus search (`esc` to leave)             |
| `esc`          | Clear the search, then the selection      |
| `r`            | Rescan the active tab                     |
| `↵`            | Act on the selection (opens a confirm)    |
| `d`            | Toggle dry run, in the confirm dialog     |

## Safety

Removing a connection is **not reversible** on LinkedIn — re-adding someone
means sending a fresh invite they have to accept.

- The confirm dialog has a **dry run** mode: it finds each entry and verifies
  the control is reachable, then backs out without clicking it. It cannot remove
  or unfollow anyone.
- Every attempt is appended to `~/.incleanup/removals.log` (timestamp, list,
  outcome, id, name), so you can always find someone you cut by mistake.
- Runs are capped: **100** connection removals (LinkedIn cannot undo them) and
  **500** unfollows (following again is one click).
- Actions are paced 1.5–3.5s apart, which works out around 5s per entry
  end to end. That pause is a deliberate throttle — LinkedIn does restrict
  accounts that fire in a steady machine rhythm — so lower it knowingly.

## How it works

| Piece            | Approach                                                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser access   | `playwright-core` attaches over CDP to a browser you launched. It only ever drives a tab it opened itself — your other tabs are never read or navigated.  |
| Reading a list   | The page is scrolled and paged to the end, and rows are read from the DOM as they appear, since LinkedIn virtualises long lists. The page's own declared total is used as the target, so a mid-list stall is not mistaken for the end. incleanup makes no API calls of its own. |
| Removing         | Done from the connections list, never by opening profiles — so nobody gets a "viewed your profile" notice. Each person is filtered in by name, matched by profile id, then **More actions → Remove connection**, then the confirmation. |
| Unfollowing      | From the network-manager lists, via each row's **Following** button. The button flipping back to "Follow" is what proves it landed. |
| Storage          | `~/.incleanup/<list>.json` and `~/.incleanup/removals.log`. Neither is ever committed.                                                    |

Labels are matched in English and Turkish throughout.

## Configuration

All optional, via environment variables:

| Variable                       | Default | Meaning                             |
| ------------------------------ | ------- | ----------------------------------- |
| `INCLEANUP_PORT`               | `5274`  | API port                            |
| `INCLEANUP_CDP_PORT`           | `9222`  | Browser remote debugging port       |
| `INCLEANUP_DATA_DIR`           | `~/.incleanup` | Snapshot + log location      |
| `INCLEANUP_MAX_REMOVALS`       | `100`   | Connection removals per run         |
| `INCLEANUP_MAX_UNFOLLOWS`      | `500`   | Unfollows per run                   |
| `INCLEANUP_REMOVAL_DELAY_MIN`  | `1500`  | Min pause between actions (ms)      |
| `INCLEANUP_REMOVAL_DELAY_MAX`  | `3500`  | Max pause between actions (ms)      |
| `INCLEANUP_MAX_CONNECTIONS`    | `5000`  | Scan ceiling                        |
| `INCLEANUP_MAX_ENRICH_PAGES`   | `100`   | Search pages read for shared counts |
| `INCLEANUP_BROWSER_BIN`        | —       | Explicit browser binary path        |

## Caveats

LinkedIn is mid-rewrite and serves more than one version of these pages. The
connections list uses a new `componentkey` markup; the network-manager lists
still use the classic one. incleanup targets both, with a structural fallback
that infers rows from the profile links themselves, but a further rewrite will
need the selectors in `src/server/harvest.ts`, `src/server/harvestManager.ts`
and `src/server/actions.ts` revisited.

A scan of ~1,200 connections takes several minutes; partial results are written
to disk every 200 entries, so an interrupted scan is not wasted.

### Why the browser, and not the API

LinkedIn's public API does not expose connection management at all, and its
internal one has no bulk endpoint — removals are one call per person either way.
Driving the UI is slower per entry, but it is the traffic LinkedIn expects from a
signed-in person. Calling the internal API directly is the clearest automation
signal an account can send, and the cost of being wrong is the account.

Automating your own account is your call and your risk — LinkedIn's User
Agreement discourages automated access regardless of intent.

## License

MIT
