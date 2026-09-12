#!/bin/bash
# Batch PDF export test — navigates test-window tabs via AppleScript,
# triggers export via Alt+Shift+P, verifies PDF, all without GUI popup.
#
# Prereq: web-paperize extension loaded; a Chrome window with one tab
# is the designated test window (NOT the user's browsing window).
#
# Usage: bash tests/tools/batch-export.sh <test-window-index> [urls-file]
#   test-window-index: 1-based Chrome window index (find via osascript)

WINDOW_INDEX="${1:?Usage: batch-export.sh <test-window-index> [urls-file]}"
URLS_FILE="${2:-/tmp/batch-matrix.tsv}"
RESULTS="/tmp/batch-results.tsv"
PDF_DIR="$HOME/Downloads"

# Resolve window id for AppleScript tab targeting
get_tab_js() {
  echo "tell application \"Google Chrome\"
    set w to window $WINDOW_INDEX
    set URL of active tab of w to \"$1\"
  end tell"
}

send_shortcut() {
  osascript -e "tell application \"System Events\"
    keystroke \"p\" using {option down, shift down}
  end tell" 2>/dev/null
}

wait_pdf() {
  local title="$1" timeout="${2:-20}"
  local pdf="$PDF_DIR/$title.pdf"
  for i in $(seq 1 "$timeout"); do
    [ -f "$pdf" ] && [ "$(stat -f%z "$pdf" 2>/dev/null)" -gt 1000 ] && echo "$pdf" && return 0
    sleep 1
  done
  return 1
}

analyze_pdf() {
  python3 -c "
import re, sys
data = open('$1','rb').read()
pages = len(re.findall(rb'/Type\s*/Page[^s]', data))
uris = len(re.findall(rb'/URI', data))
print(f'{pages}|{len(data)//1024}|{uris}')
" 2>/dev/null
}

echo "category|title|url|pdf|pages|kb|uris|status" > "$RESULTS"

while IFS='|' read -r cat title url; do
  [ -z "$url" ] && continue
  echo -n "[$cat] $title → "

  # Navigate (background — doesn't steal focus from user's window)
  osascript -e "$(get_tab_js "$url")" 2>/dev/null
  if [ $? -ne 0 ]; then
    echo "NAV_FAIL" | tee -a "$RESULTS" <<< "$cat|$title|$url||||NAV_FAIL"
    continue
  fi

  # Wait for page load
  sleep 5

  # Send Alt+Shift+P (works even if window is not frontmost via System Events)
  send_shortcut

  # Wait for PDF (page title becomes filename)
  # Chrome sanitizes the title; try progressively
  pdf=""
  for try_title in "$title" "$(echo "$title" | tr '/:*?"<>|' '      ')"; do
    pdf=$(wait_pdf "$try_title" 15) && break
  done

  if [ -n "$pdf" ]; then
    stats=$(analyze_pdf "$pdf")
    IFS='|' read -r pages kb uris <<< "$stats"
    status="OK"
    echo "✅ $pages pages, ${kb}KB, $uris links"
    echo "$cat|$title|$url|$(basename "$pdf")|$pages|$kb|$uris|$status" >> "$RESULTS"
  else
    echo "❌ PDF not found after 15s"
    echo "$cat|$title|$url||||TIMEOUT" >> "$RESULTS"
  fi

  # Brief pause between exports
  sleep 2
done < "$URLS_FILE"

echo ""
echo "=== Results ==="
column -t -s'|' "$RESULTS"
