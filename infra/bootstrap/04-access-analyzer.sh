#!/usr/bin/env bash
# IAM Access Analyzer for the whole organization (T14): flags any resource shared
# publicly or with an account outside the organization (a bucket, a role, a queue).
# External-access analysis is free. One analyzer per Region; this creates it in
# every Region that runs workloads now (dev: us-east-1). Add ap-south-1 and
# eu-west-2 at launch (issue #22). Idempotent.
# Usage: ./04-access-analyzer.sh [region ...]
set -euo pipefail
export AWS_PROFILE="${AWS_PROFILE:-jobdeputy-mgmt}"
regions=("${@:-us-east-1}")

aws organizations enable-aws-service-access --service-principal access-analyzer.amazonaws.com

for region in "${regions[@]}"; do
  if aws accessanalyzer get-analyzer --region "$region" --analyzer-name jobdeputy-org >/dev/null 2>&1; then
    echo "Analyzer already exists in $region"
  else
    aws accessanalyzer create-analyzer --region "$region" \
      --analyzer-name jobdeputy-org --type ORGANIZATION >/dev/null
    echo "Created organization analyzer in $region"
  fi
done

# Reviewed, intended external access (T14). Archive rules auto-archive exactly these,
# so any new finding stands out. Both principal and role name must match:
#   - GitHub Actions OIDC roles (their trust is limited to this repository and one
#     GitHub environment; infra/test/guards.test.ts and pr-integration.test.ts enforce it)
#   - IAM Identity Center (SSO) roles for the maintainers' console and CLI access
add_rule() {
  local region="$1" name="$2" filter="$3"
  if aws accessanalyzer get-archive-rule --region "$region" --analyzer-name jobdeputy-org --rule-name "$name" >/dev/null 2>&1; then
    echo "Archive rule $name already exists in $region"
  else
    aws accessanalyzer create-archive-rule --region "$region" --analyzer-name jobdeputy-org \
      --rule-name "$name" --filter "$filter"
    echo "Created archive rule $name in $region"
  fi
}

for region in "${regions[@]}"; do
  add_rule "$region" github-oidc-deploy-roles \
    '{"principal.Federated":{"contains":["oidc-provider/token.actions.githubusercontent.com"]},"resource":{"contains":[":role/jobdeputy-github-"]}}'
  add_rule "$region" identity-center-roles \
    '{"principal.Federated":{"contains":["saml-provider/AWSSSO_"]},"resource":{"contains":[":role/aws-reserved/sso.amazonaws.com/"]}}'
  # Archive rules apply to new findings; apply them to existing ones too.
  analyzer_arn=$(aws accessanalyzer get-analyzer --region "$region" --analyzer-name jobdeputy-org --query analyzer.arn --output text)
  for rule in github-oidc-deploy-roles identity-center-roles; do
    aws accessanalyzer apply-archive-rule --region "$region" --analyzer-arn "$analyzer_arn" --rule-name "$rule"
  done
done
