#!/usr/bin/env bash
# #14: posts a PR's UI screenshots (apps/web/e2e/screenshots.spec.ts) as one PR comment.
# The images live on the `ui-screenshots` branch, which holds only open PRs' latest shots
# and is rewritten as a single commit each time, so it never grows. Run by
# .github/workflows/web.yml with GH_TOKEN and GITHUB_REPOSITORY set.
#
#   publish-ui-screenshots.sh <pr-number> <commit-sha> <dir-of-pngs>
set -euo pipefail

BRANCH=ui-screenshots
MARKER='<!-- ui-screenshots -->'
# Phones and tablet in one row, desktops in the next; names match playwright.config.ts.
SMALL=(small-phone iphone pixel ipad)
LARGE=(desktop-chrome desktop-firefox desktop-safari)

pr="$1"
sha="${2:0:7}"
src="$3"
repo="$GITHUB_REPOSITORY"
[[ "$pr" =~ ^[0-9]+$ ]] || { echo "Not a PR number: $pr"; exit 1; }
compgen -G "$src/*.png" >/dev/null || { echo "No screenshots in $src"; exit 1; }

work="$(mktemp -d)"
gh auth setup-git
git -C "$work" init -q
git -C "$work" remote add origin "https://github.com/$repo.git"
if git -C "$work" fetch -q --depth 1 origin "$BRANCH"; then
  git -C "$work" checkout -q FETCH_HEAD
fi

# Drop the shots of PRs that are no longer open, then replace this PR's.
open_prs="$(gh pr list -R "$repo" --state open --limit 500 --json number --jq '.[].number')"
for dir in "$work"/pr-*; do
  [[ -d "$dir" ]] || continue
  grep -qx "${dir##*/pr-}" <<<"$open_prs" || rm -rf "$dir"
done
rm -rf "$work/pr-$pr"
mkdir -p "$work/pr-$pr/$sha"
cp "$src"/*.png "$work/pr-$pr/$sha/"

git -C "$work" checkout -q --orphan next
git -C "$work" add -A
git -C "$work" -c user.name='github-actions[bot]' \
  -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
  commit -q -m "UI screenshots of open PRs"
git -C "$work" push -q -f origin "HEAD:refs/heads/$BRANCH"

# One table per screen: the image URL carries the commit, so a browser never shows a stale copy.
row() {
  local screen="$1"; shift
  local cells="" device file
  for device in "$@"; do
    file="$screen--$device.png"
    [[ -f "$src/$file" ]] || continue
    cells+="<td align=\"center\"><b>$device</b><br><img src=\"https://github.com/$repo/blob/$BRANCH/pr-$pr/$sha/$file?raw=true\" width=\"$WIDTH\"></td>"
  done
  [[ -n "$cells" ]] && echo "<tr>$cells</tr>"
}
body="$MARKER
### UI screenshots for $sha

Every screen on every device that the browser tests cover. Updated on each push."
for screen in $(find "$src" -name '*.png' -exec basename {} \; | sed 's/--.*//' | sort -u); do
  small="$(WIDTH=180 row "$screen" "${SMALL[@]}" || true)"
  large="$(WIDTH=300 row "$screen" "${LARGE[@]}" || true)"
  body+="

#### $screen

<table>$small</table>
<table>$large</table>"
done

comment_id="$(gh api "repos/$repo/issues/$pr/comments" --paginate \
  --jq ".[] | select(.user.login == \"github-actions[bot]\" and (.body | startswith(\"$MARKER\"))) | .id" | sed -n 1p)"
if [[ -n "$comment_id" ]]; then
  gh api -X PATCH "repos/$repo/issues/comments/$comment_id" -f body="$body" >/dev/null
else
  gh pr comment "$pr" -R "$repo" --body "$body" >/dev/null
fi
echo "Posted $(find "$src" -name '*.png' | wc -l | tr -d ' ') screenshots on PR #$pr"
