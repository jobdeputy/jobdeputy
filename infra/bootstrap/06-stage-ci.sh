#!/usr/bin/env bash
# Connects a stage to GitHub Actions: deploys the stage's CI/CD stack (the GitHub OIDC
# deploy role, and for dev the PR integration role) and fills the stage's GitHub
# environment with the secrets the workflows read. Run it for a new stage, and again
# whenever the repository is re-created (new repo ID in infra/config/github.ts) or a
# role or account changes. Idempotent.
#
# Usage: ALERT_EMAILS=a@x.com,b@y.com ./06-stage-ci.sh <stage>     (dev or prod)
#   Uses the AWS profile jobdeputy-<stage>-<cell> for each of the stage's cells, and the
#   GitHub CLI (gh) logged in as a repository admin.
#
# The CI/CD stack lives in the stage's US (iad) account. Prod's other cell accounts get
# their account IDs as secrets here; how CI deploys into them is decided at launch.
set -euo pipefail
cd "$(dirname "$0")/.."

stage="${1:?usage: ALERT_EMAILS=... $0 <stage>}"
repo="${GITHUB_REPO:-jobdeputy/jobdeputy}"
: "${ALERT_EMAILS:?set ALERT_EMAILS to the alarm recipients, comma-separated}"
info=$(pnpm exec tsx bootstrap/stage-info.ts "$stage")

# "<accountVar> <account>" per cell, from its profile (fails early if a login is missing).
# Plain lines, not an associative array: macOS ships bash 3.2.
accounts=""
while read -r cell profile var; do
  id=$(aws sts get-caller-identity --profile "$profile" --query Account --output text)
  accounts="$accounts$var $id"$'\n'
  echo "Cell $cell: account $id (profile $profile)"
done < <(jq -r '.cells[] | "\(.cell) \(.profile) \(.accountVar)"' <<< "$info")
account_of() { awk -v v="$1" '$1 == v { print $2 }' <<< "$accounts"; }

iad_profile=$(jq -r '.cells[] | select(.cell == "iad") | .profile' <<< "$info")
iad_var=$(jq -r '.cells[] | select(.cell == "iad") | .accountVar' <<< "$info")
iad_account=$(account_of "$iad_var")
cicd_stack="jobdeputy-cicd-$stage-iad"

echo "Building the web app (every shared-stage synth needs it)"
pnpm --filter @jobdeputy/web build >/dev/null

echo "Deploying $cicd_stack"
env "AWS_PROFILE=$iad_profile" AWS_REGION=us-east-1 "$iad_var=$iad_account" \
  pnpm exec cdk deploy "$cicd_stack" -c "stage=$stage" -c cicd=true --require-approval never

output() {
  aws cloudformation describe-stacks --profile "$iad_profile" --region us-east-1 \
    --stack-name "$cicd_stack" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" \
    --output text
}

set_secret() { # environment name value
  printf '%s' "$3" | gh secret set "$2" -R "$repo" --env "$1"
  echo "  $1: $2"
}

echo "GitHub environment '$stage' (deploys only from main)"
gh api -X PUT "repos/$repo/environments/$stage" --silent --input - <<'JSON'
{"deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}}
JSON
gh api "repos/$repo/environments/$stage/deployment-branch-policies" --jq '.branch_policies[].name' |
  grep -qx main ||
  gh api -X POST "repos/$repo/environments/$stage/deployment-branch-policies" \
    -f name=main -f type=branch --silent
set_secret "$stage" AWS_DEPLOY_ROLE_ARN "$(output DeployRoleArn)"
set_secret "$stage" JD_ALERT_EMAIL "$ALERT_EMAILS"
while read -r var id; do
  if [ -n "$var" ]; then set_secret "$stage" "$var" "$id"; fi
done <<< "$accounts"

pr_role=$(output PrRoleArn)
if [ "$pr_role" != "None" ]; then
  echo "GitHub environment 'pr' (PR integration stacks, dev only)"
  gh api -X PUT "repos/$repo/environments/pr" --silent
  set_secret pr AWS_PR_ROLE_ARN "$pr_role"
  set_secret pr "$iad_var" "$iad_account"
fi

echo "Done. The deploy role trusts: $(aws iam get-role --profile "$iad_profile" \
  --role-name "$(output DeployRoleArn | awk -F/ '{print $NF}')" \
  --query 'Role.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals."token.actions.githubusercontent.com:sub"' \
  --output text)"
