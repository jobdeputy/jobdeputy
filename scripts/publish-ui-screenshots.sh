#!/usr/bin/env bash
# #14: posts a PR's UI screenshots (apps/web/e2e/screenshots.spec.ts) as one PR comment.
# The images live on the `ui-screenshots` branch, rewritten as a single commit each time so it
# never grows. It keeps each PR's last 3 pushes, while the PR is open and for 30 days after it
# closes. Run by .github/workflows/web.yml with GH_TOKEN and GITHUB_REPOSITORY set.
#
#   publish-ui-screenshots.sh <pr-number> <commit-sha> <dir-of-pngs>
set -euo pipefail

BRANCH=ui-screenshots
MARKER='<!-- ui-screenshots -->'
KEEP_DAYS=30
KEEP_PUSHES=3
ATTEMPTS=3
# Phones and tablet in one row, desktops in the next; names match playwright.config.ts.
SMALL=(small-phone iphone pixel ipad)
LARGE=(desktop-chrome desktop-firefox desktop-safari)

pr="$1"
sha="${2:0:7}"
src="$(cd "$3" && pwd)"
repo="$GITHUB_REPOSITORY"
[[ "$pr" =~ ^[0-9]+$ ]] || { echo "Not a PR number: $pr"; exit 1; }
compgen -G "$src/*.png" >/dev/null || { echo "No screenshots in $src"; exit 1; }
total="$(find "$src" -name '*.png' | wc -l | tr -d ' ')"
all_screens="$(find "$src" -name '*.png' -exec basename {} \; | sed 's/--.*//' | sort -u)"

# Which screens to show: those with a shot that differs from main's (apps/web/e2e/
# compare-screenshots.ts writes one compare-<part>.json per test part), on every device. Every
# screen when main had nothing to compare with, or when any part's shots were not all compared.
screens="$all_screens"
compared=false
unchanged=""
gone=""
used=""
# Every part compared, and all with the same main commit (one could restore a newer entry).
if compgen -G "$src/compare-*.json" >/dev/null &&
  [[ "$(jq -s 'map(.shots) | add' "$src"/compare-*.json)" == "$total" ]] &&
  [[ "$(jq -s 'map(.baseline) | unique | length' "$src"/compare-*.json)" == 1 ]]; then
  used="$(jq -rs '.[0].baseline // ""' "$src"/compare-*.json)"
  used="${used#ui-screenshots-main-}"
  screens="$(jq -r '.changed[]' "$src"/compare-*.json | sed 's/--.*//' | sort -u)"
  unchanged="$(comm -23 <(echo "$all_screens") <(echo "$screens") | grep -v '^$' || true)"
  # Screens main has that this run took no shot of (removed or renamed).
  gone="$(comm -13 <(echo "$all_screens") \
    <(jq -r '.main[]' "$src"/compare-*.json | sed 's/--.*//' | sort -u) | grep -v '^$' || true)"
  compared=true
fi

# Folder names start with the time, so the newest pushes sort last.
push_dir="$(date -u +%Y%m%d%H%M%S)-$sha"

# PRs whose shots are kept: open, or closed within KEEP_DAYS.
keep_prs="$(gh pr list -R "$repo" --state all --limit 1000 --json number,state,closedAt \
  --jq ".[] | select(.state == \"OPEN\" or (.closedAt | fromdateiso8601) > now - $KEEP_DAYS * 86400) | .number")"

gh auth setup-git
# Runs as an `if` condition, where bash ignores `set -e`, so every step ends in `|| return 1`.
publish() {
  local work lease=""
  work="$(mktemp -d)" || return 1
  git -C "$work" init -q || return 1
  git -C "$work" remote add origin "${UI_SCREENSHOTS_REMOTE:-https://github.com/$repo.git}" || return 1
  # Exit code 2 means the branch does not exist yet; any other failure stops the run, so a
  # network error never replaces everyone's screenshots with only this PR's.
  local code=0
  git -C "$work" ls-remote --exit-code --heads origin "$BRANCH" >/dev/null || code=$?
  if [[ $code -eq 0 ]]; then
    git -C "$work" fetch -q --depth 1 origin "$BRANCH" || return 1
    git -C "$work" checkout -q FETCH_HEAD || return 1
    lease="$(git -C "$work" rev-parse HEAD)" || return 1
  elif [[ $code -ne 2 ]]; then
    echo "Could not read $BRANCH (git exit $code)"
    return 1
  fi

  local dir
  for dir in "$work"/pr-*; do
    [[ -d "$dir" ]] || continue
    grep -qx "${dir##*/pr-}" <<<"$keep_prs" || rm -rf "$dir" || return 1
  done
  mkdir -p "$work/pr-$pr/$push_dir" || return 1
  local screen
  for screen in $screens; do
    cp "$src/$screen"--*.png "$work/pr-$pr/$push_dir/" || return 1
  done
  # Older pushes stay a while, so a comment being updated never points at deleted files.
  find "$work/pr-$pr" -mindepth 1 -maxdepth 1 -type d | sort |
    awk -v keep="$KEEP_PUSHES" '{ dirs[NR] = $0 } END { for (i = 1; i <= NR - keep; i++) print dirs[i] }' |
    xargs rm -rf || return 1

  git -C "$work" checkout -q --orphan next || return 1
  git -C "$work" add -A || return 1
  git -C "$work" -c user.name='github-actions[bot]' \
    -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
    commit -q -m "UI screenshots of open and recent PRs" || return 1
  # The lease fails if another PR's run pushed after our read; then read again and retry.
  git -C "$work" push -q --force-with-lease="refs/heads/$BRANCH:$lease" origin \
    "HEAD:refs/heads/$BRANCH" || return 1
}
for attempt in $(seq 1 "$ATTEMPTS"); do
  # Nothing to show: no images to keep (older pushes' folders stay until the next publish).
  [[ -n "$screens" ]] || break
  if publish; then break; fi
  [[ $attempt -lt $ATTEMPTS ]] || { echo "Could not publish after $ATTEMPTS attempts"; exit 1; }
  echo "Another run published first; retrying ($attempt/$ATTEMPTS)"
done

# One table per screen: the image URL carries the push, so a browser never shows a stale copy.
row() {
  local screen="$1" width="$2" cells="" device file
  shift 2
  for device in "$@"; do
    file="$screen--$device.png"
    [[ -f "$src/$file" ]] || continue
    cells+="<td align=\"center\"><b>$device</b><br><img src=\"https://github.com/$repo/blob/$BRANCH/pr-$pr/$push_dir/$file?raw=true\" width=\"$width\"></td>"
  done
  [[ -z "$cells" ]] || echo "<tr>$cells</tr>"
}
if ! $compared; then
  intro="Every screen on every device that the browser tests cover."
elif [[ -z "$screens" ]]; then
  intro="No screen differs from main's ($total screenshots compared)."
else
  intro="Only the screens that differ from main's, each on every device ($(wc -w <<<"$screens" | tr -d ' ') of $(wc -w <<<"$all_screens" | tr -d ' ') screens)."
fi
if $compared && [[ -n "$used" ]]; then
  base="${UI_BASE_SHA:-}"
  if [[ "$used" == "$base" ]]; then
    intro+=" Compared with main at ${used:0:7}, this PR's base."
  elif [[ -z "$base" ]]; then
    intro+=" Compared with main at ${used:0:7}."
  else
    intro+=" Compared with main at ${used:0:7}, the newest saved: the main this PR is tested on (${base:0:7}) has none saved, or this PR is stacked on another, so screens changed in between may show too."
  fi
fi
body="$MARKER
### UI screenshots for $sha

$intro Updated on each push whose browser tests pass; kept for $KEEP_DAYS days after the PR
closes."
if [[ -n "$gone" ]]; then
  body+="

**No longer screenshotted** (main has them): $(echo $gone | sed 's/ /, /g')"
fi
if [[ -n "$unchanged" ]]; then
  body+="

<details><summary>Unchanged screens ($(wc -w <<<"$unchanged" | tr -d ' '))</summary>

$(sed 's/^/- /' <<<"$unchanged")

</details>"
fi
for screen in $screens; do
  body+="

#### $screen

<table>$(row "$screen" 180 "${SMALL[@]}")</table>
<table>$(row "$screen" 300 "${LARGE[@]}")</table>"
done

comment_id="$(gh api "repos/$repo/issues/$pr/comments" --paginate \
  --jq ".[] | select(.user.login == \"github-actions[bot]\" and (.body | startswith(\"$MARKER\"))) | .id" | sed -n 1p)"
if [[ -n "$comment_id" ]]; then
  gh api -X PATCH "repos/$repo/issues/comments/$comment_id" -f body="$body" >/dev/null
else
  gh pr comment "$pr" -R "$repo" --body "$body" >/dev/null
fi
echo "Posted $(wc -w <<<"$screens" | tr -d ' ') of $(wc -w <<<"$all_screens" | tr -d ' ') screens on PR #$pr"
