#!/bin/bash
# Batch PDF export test — navigates a dedicated Chrome test window,
# triggers Alt+Shift+P, and accepts only a fresh PDF whose extracted text
# contains the job's unique marker. It fails closed rather than trusting names.
#
# Prereq: web-paperize loaded; a dedicated Chrome test window; pdftotext.
#
# Usage: bash tests/tools/batch-export.sh <test-window-index> [urls-file]
#   test-window-index: 1-based Chrome window index (find via osascript)
#   urls-file fields: category|expected-title|url|unique-page-text-marker

WINDOW_INDEX="${1:?Usage: batch-export.sh <test-window-index> [urls-file]}"
URLS_FILE="${2:-/tmp/batch-matrix.tsv}"
RESULTS="/tmp/batch-results.tsv"
PDF_DIR="$HOME/Downloads"
RUN_TMP=$(mktemp -d "${TMPDIR:-/tmp}/web-paperize-batch.XXXXXX") || exit 2

cleanup() {
  case "$RUN_TMP" in
    */web-paperize-batch.*) [ -d "$RUN_TMP" ] && rm -rf -- "$RUN_TMP" ;;
  esac
}
trap cleanup EXIT INT TERM

if ! command -v pdftotext >/dev/null 2>&1; then
  echo "ERROR: pdftotext is required for fail-closed PDF identity checks." >&2
  exit 2
fi

# Resolve once: bringing a window to the front changes Chrome's index order,
# while its AppleScript window id remains stable throughout the run.
WINDOW_ID=$(osascript - "$WINDOW_INDEX" <<'APPLESCRIPT'
on run argv
  set requestedIndex to (item 1 of argv) as integer
  tell application "Google Chrome"
    if (count of windows) < requestedIndex then error "test window does not exist"
    return id of window requestedIndex
  end tell
end run
APPLESCRIPT
) || exit 2

if ! [[ "$WINDOW_ID" =~ ^[0-9]+$ ]]; then
  echo "ERROR: could not resolve a stable Chrome test-window id." >&2
  exit 2
fi

navigate_test_window() {
  osascript - "$WINDOW_ID" "$1" <<'APPLESCRIPT'
on run argv
  set targetId to (item 1 of argv) as integer
  set targetUrl to item 2 of argv
  tell application "Google Chrome"
    set URL of active tab of window id targetId to targetUrl
  end tell
end run
APPLESCRIPT
}

focus_and_send_shortcut() {
  osascript - "$WINDOW_ID" <<'APPLESCRIPT'
on run argv
  set targetId to (item 1 of argv) as integer
  tell application "Google Chrome"
    set index of window id targetId to 1
    activate
    delay 0.4
    if id of front window is not targetId then error "test window is not frontmost"
  end tell
  tell application "System Events"
    keystroke "p" using {option down, shift down}
  end tell
end run
APPLESCRIPT
}

snapshot_pdfs() {
  local output="$1" pdf
  : > "$output"
  for pdf in "$PDF_DIR"/*.pdf; do
    [ -f "$pdf" ] || continue
    stat -f '%N|%m|%z' "$pdf" >> "$output" 2>/dev/null || true
  done
}

title_variant() {
  local base="$1" expected="$2" sanitized stem suffix
  sanitized=$(printf '%s' "$expected" | tr '/:*?"<>|' '        ' | tr -s ' ')
  for stem in "$expected" "$sanitized"; do
    [ "$base" = "$stem.pdf" ] && return 0
    case "$base" in
      "$stem ("*").pdf")
        suffix=${base#"$stem ("}
        suffix=${suffix%")".pdf}
        [[ "$suffix" =~ ^[0-9]+$ ]] && return 0
        ;;
    esac
  done
  return 1
}

wait_pdf() {
  local title="$1" marker="$2" snapshot="$3" started="$4" timeout="${5:-20}"
  local pdf base record mtime size text
  for _ in $(seq 1 "$timeout"); do
    for pdf in "$PDF_DIR"/*.pdf; do
      [ -f "$pdf" ] || continue
      base=$(basename "$pdf")
      title_variant "$base" "$title" || continue
      mtime=$(stat -f%m "$pdf" 2>/dev/null) || continue
      size=$(stat -f%z "$pdf" 2>/dev/null) || continue
      [ "$mtime" -ge "$started" ] || continue
      [ "$size" -gt 1000 ] || continue
      record=$(stat -f '%N|%m|%z' "$pdf" 2>/dev/null) || continue
      grep -Fqx -- "$record" "$snapshot" && continue
      text=$(pdftotext "$pdf" - 2>/dev/null) || continue
      if printf '%s' "$text" | grep -Fq -- "$marker"; then
        printf '%s\n' "$pdf"
        return 0
      fi
    done
    sleep 1
  done
  return 1
}

analyze_pdf() {
  python3 - "$1" <<'PY'
import re, sys
data = open(sys.argv[1], 'rb').read()
pages = len(re.findall(rb'/Type\s*/Page[^s]', data))
uris = len(re.findall(rb'/URI', data))
print(f'{pages}|{len(data)//1024}|{uris}')
PY
}

echo "category|title|url|marker|pdf|pages|kb|uris|status" > "$RESULTS"

job=0
while IFS='|' read -r category title url marker; do
  [ -z "$url" ] && continue
  job=$((job + 1))
  echo -n "[$category] $title → "

  if [ -z "$marker" ]; then
    echo "NO_MARKER (fail closed)"
    echo "$category|$title|$url||||||NO_MARKER" >> "$RESULTS"
    continue
  fi

  if ! navigate_test_window "$url" >/dev/null 2>&1; then
    echo "NAV_FAIL"
    echo "$category|$title|$url|$marker|||||NAV_FAIL" >> "$RESULTS"
    continue
  fi

  sleep 5
  started=$(date +%s)
  snapshot="$RUN_TMP/job-$job.snapshot"
  snapshot_pdfs "$snapshot"

  # System Events always targets the foreground app/window. Raise and verify the
  # exact designated window immediately before the extension shortcut.
  if ! focus_and_send_shortcut >/dev/null 2>&1; then
    echo "FOCUS_FAIL"
    echo "$category|$title|$url|$marker|||||FOCUS_FAIL" >> "$RESULTS"
    continue
  fi

  # Accept name.pdf and Chrome's name (N).pdf variants, but identity still
  # requires both freshness and the unique page-text marker in extracted PDF.
  pdf=$(wait_pdf "$title" "$marker" "$snapshot" "$started" 30) || pdf=""

  if [ -n "$pdf" ]; then
    stats=$(analyze_pdf "$pdf")
    IFS='|' read -r pages kb uris <<< "$stats"
    echo "✅ $pages pages, ${kb}KB, $uris links"
    echo "$category|$title|$url|$marker|$(basename "$pdf")|$pages|$kb|$uris|OK" >> "$RESULTS"
  else
    echo "❌ no fresh, marker-matching PDF after 30s"
    echo "$category|$title|$url|$marker|||||IDENTITY_TIMEOUT" >> "$RESULTS"
  fi

  sleep 2
done < "$URLS_FILE"

echo ""
echo "=== Results ==="
column -t -s'|' "$RESULTS"
