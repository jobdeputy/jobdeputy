#!/usr/bin/env bash
# Decision 0011: gives a stage its web address. Deploys the stage's web zone
# (jobdeputy-<stage>-web-dns) and delegates it from jobdeputy.com (05-delegate-web-zone.sh).
# Run it once for a stage, BEFORE the first deploy that includes its web stack; the
# web stack's certificate can only validate once the delegation exists. Idempotent.
#
# Usage: ./07-stage-web.sh <stage>     (the domain comes from infra/config/web.ts)
#   Uses the AWS profiles jobdeputy-<stage>-iad (the zone) and jobdeputy-mgmt (the parent).
set -euo pipefail
cd "$(dirname "$0")/.."

stage="${1:?usage: $0 <stage>}"
info=$(pnpm exec tsx bootstrap/stage-info.ts "$stage")
domain=$(jq -r '.webDomain // empty' <<< "$info")
if [ -z "$domain" ]; then
  echo "Stage $stage has no web address. Add it to WEB_SITES in infra/config/web.ts first." >&2
  exit 1
fi
profile=$(jq -r '.cells[] | select(.cell == "iad") | .profile' <<< "$info")
var=$(jq -r '.cells[] | select(.cell == "iad") | .accountVar' <<< "$info")
account=$(aws sts get-caller-identity --profile "$profile" --query Account --output text)

echo "Building the web app (every shared-stage synth needs it)"
pnpm --filter @jobdeputy/web build >/dev/null

echo "Deploying the $domain zone (jobdeputy-$stage-web-dns) into $account"
env "AWS_PROFILE=$profile" AWS_REGION=us-east-1 "$var=$account" \
  pnpm exec cdk deploy "jobdeputy-$stage-web-dns" -c "stage=$stage" --require-approval never

WORKLOAD_PROFILE="$profile" ./bootstrap/05-delegate-web-zone.sh "$domain"

echo "Public DNS for $domain (may take a minute):"
dig +short NS "$domain" @8.8.8.8 || true
echo "Done. The next deploy of $stage creates the site at https://$domain."
