#!/usr/bin/env bash
# Launches a Chromium-family browser with a dedicated profile + CDP enabled.
#
# Since Chromium 136 the remote debugging port is refused for the *default*
# user data dir, so incleanup keeps its own profile directory. You log in to
# LinkedIn there once by hand; the session persists across runs.
#
# Usage:
#   ./scripts/launch-browser.sh            # autodetect (Chrome, then Brave, then Chromium)
#   ./scripts/launch-browser.sh brave      # force a family
#   INCLEANUP_BROWSER_BIN=/path/to/binary ./scripts/launch-browser.sh
set -euo pipefail

PORT="${INCLEANUP_CDP_PORT:-9222}"
FAMILY="${1:-${INCLEANUP_BROWSER:-auto}}"
PROFILE_DIR="${INCLEANUP_BROWSER_PROFILE:-$HOME/.incleanup/$FAMILY-profile}"

chrome_paths=(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  "$(command -v google-chrome || true)"
)
brave_paths=(
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
  "$(command -v brave-browser || true)"
)
chromium_paths=(
  "/Applications/Chromium.app/Contents/MacOS/Chromium"
  "$(command -v chromium || true)"
)

first_executable() {
  for candidate in "$@"; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

BROWSER="${INCLEANUP_BROWSER_BIN:-}"
if [[ -z "$BROWSER" ]]; then
  case "$FAMILY" in
    chrome)   BROWSER="$(first_executable "${chrome_paths[@]}" || true)" ;;
    brave)    BROWSER="$(first_executable "${brave_paths[@]}" || true)" ;;
    chromium) BROWSER="$(first_executable "${chromium_paths[@]}" || true)" ;;
    auto)
      BROWSER="$(first_executable "${chrome_paths[@]}" "${brave_paths[@]}" "${chromium_paths[@]}" || true)"
      PROFILE_DIR="${INCLEANUP_BROWSER_PROFILE:-$HOME/.incleanup/browser-profile}"
      ;;
    *)
      echo "Unknown browser family '$FAMILY' (expected chrome, brave or chromium)." >&2
      exit 1
      ;;
  esac
fi

if [[ -z "$BROWSER" ]]; then
  echo "Could not find a Chromium-family browser. Set INCLEANUP_BROWSER_BIN to its path." >&2
  exit 1
fi

if curl -sf --max-time 1 "http://127.0.0.1:$PORT/json/version" >/dev/null; then
  echo "A browser is already listening on port $PORT — nothing to do."
  exit 0
fi

mkdir -p "$PROFILE_DIR"
LOG="${INCLEANUP_DATA_DIR:-$HOME/.incleanup}/browser.log"
mkdir -p "$(dirname "$LOG")"

echo "Launching browser"
echo "  binary : $BROWSER"
echo "  profile: $PROFILE_DIR"
echo "  cdp    : http://127.0.0.1:$PORT"
echo "  log    : $LOG"

# Detached, not exec'd: the browser writes a steady stream of its own log lines
# and would hold this terminal, leaving nowhere to run `npm run dev`.
"$BROWSER" \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$PROFILE_DIR" \
  --no-first-run \
  --no-default-browser-check \
  "https://www.linkedin.com/feed/" >>"$LOG" 2>&1 &

BROWSER_PID=$!

for _ in $(seq 1 40); do
  if curl -sf --max-time 1 "http://127.0.0.1:$PORT/json/version" >/dev/null; then
    echo
    echo "Ready. Log in to LinkedIn in the window that opened — once; the session"
    echo "is remembered. Then run:  npm run dev"
    exit 0
  fi
  if ! kill -0 "$BROWSER_PID" 2>/dev/null; then
    echo "The browser exited straight away. Last lines of $LOG:" >&2
    tail -5 "$LOG" >&2
    exit 1
  fi
  sleep 0.5
done

echo "Browser started but port $PORT never answered. See $LOG." >&2
exit 1
