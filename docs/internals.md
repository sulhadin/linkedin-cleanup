# Internals

Notes for whoever has to fix this after LinkedIn changes something. Most of what
follows was learned by probing the live pages, not from documentation.

## Browser access

`playwright-core` attaches over CDP to a browser started by
`scripts/launch-browser.sh`. It only ever drives a tab it opened itself — the
user's other tabs are visible over CDP but are never read or navigated.

Since Chromium 136 the remote debugging port is refused for the **default** user
data dir, so the launcher keeps its own profile under
`~/.incleanup/<family>-profile`. There is no way around this; the user logs in
there once.

## LinkedIn serves more than one UI

The account is mid-migration, and the two markups need different handling:

| Page | Markup | Hook |
| --- | --- | --- |
| Connections | new | `[componentkey^="ConnectionCard_"]`, id is the suffix |
| People search | new | one `<a>` per result, wrapping the whole row |
| Network manager (pages, follows) | classic | `[data-chameleon-result-urn]`, artdeco buttons |

Both connections variants exist in the wild: one pages in on scroll, the other
needs a **Load more** button clicked. `clickLoadMore` handles the second; without
it a scan stops at the first screenful.

## Browser-side code is passed as strings

`tsx` compiles with esbuild's `keepNames`, which rewrites named function
expressions into calls to a `__name` helper that does not exist inside the page.
Anything handed to `page.evaluate` as a *function* breaks the moment it declares
a nested helper. So `harvest.ts` and `harvestManager.ts` cross the boundary as
source text. Losing type-checking there is the price.

## Reading a list

Rows are accumulated across scroll rounds, never snapshotted at the end —
LinkedIn virtualises long lists, so rows scrolled past are gone from the DOM well
before the list stops growing. The container and the ids already seen are cached
on `window`, so each round only reads genuinely new rows; walking up from every
anchor each round is quadratic and ends up slower than LinkedIn itself.

The page states its own total ("1,217 connections"), and that is used as the
target. Without it, a mid-list stall — LinkedIn pauses for tens of seconds — is
indistinguishable from the end of the list.

Scrolling targets the inner pane holding the most entries. Picking a pane by
size instead silently scrolls the wrong element and the scan stalls forever.

## Removing a connection

From the connections list, never by opening profiles — visiting a profile shows
up in that person's "who viewed your profile".

Filter the list by name, match the card by profile id (so two people with the
same name cannot be confused), then **More actions → Remove connection**.

The confirmation is a **native `<dialog>`**. It carries the dialog role
implicitly, so an attribute selector like `[role="dialog"]` never matches it —
this cost a long debugging session in which the dialog appeared every time and
every probe reported that nothing had happened. Its confirm button reads
**"Remove connection"**, not "Remove".

The card menu occasionally does not open on the first click, so it gets one
retry before the row is called unreachable.

Success is the row dropping out of the list; if it lingers, the name filter is
re-run so the answer comes from LinkedIn rather than a stale DOM.

## Unfollowing

Each row has a `Click to stop following <name>` button. The row stays in place
afterwards and the button flips to "follow", so the button disappearing *is* the
proof. It needs a real wait — sampling once after a fixed pause reports
successful unfollows as failures.

## Shared connection counts

The connections page never mentions them. They come from 1st-degree people
search, which prints them under every result:

```
"A & B are mutual connections"            → 2
"A, B & 19 other mutual connections"      → 21
"A is a mutual connection"                → 1
(no such line)                            → 0
```

Two traps:

- The mutual-connection **names** are profile links too. Inferring result cards
  from links alone invents entries for them. A row only counts when its text
  carries a degree marker or a mutual line.
- The search is capped near 1,000 results. Entries past the cap keep
  `mutual: null` and are shown as `Unknown`. They must never be recorded as
  zero, or filtering for "0 shared" quietly sweeps up people nobody looked up.

## Why not the internal API

LinkedIn's public API does not expose connection management at all, and the
internal one has no bulk endpoint — removals are one call per person either way,
so the only gain is per-call latency. Driving the UI is slower but it is the
traffic LinkedIn expects from a signed-in person. Calling the internal API
directly is the clearest automation signal an account can send.

## Where things live

| File | |
| --- | --- |
| `src/server/harvest.ts` | Connections page + scrolling |
| `src/server/harvestManager.ts` | Network-manager lists |
| `src/server/enrich.ts` | People search, shared counts |
| `src/server/actions.ts` | Remove and unfollow |
| `src/server/datasets.ts` | Per-list URLs, harvesters, mapping |
| `src/web/heuristics.ts` | The "looks like a company" guess |
