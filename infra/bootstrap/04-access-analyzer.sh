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
