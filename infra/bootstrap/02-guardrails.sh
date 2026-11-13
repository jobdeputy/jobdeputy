#!/usr/bin/env bash
# Creates and attaches service control policies: Region lock per account,
# cost guardrails on Workloads, and the (unattached) budget-stop policy.
set -euo pipefail
export AWS_PROFILE="${AWS_PROFILE:-jobdeputy-mgmt}"
here="$(cd "$(dirname "$0")" && pwd)"

root_id=$(aws organizations list-roots --query 'Roots[0].Id' --output text)
workloads_ou=$(aws organizations list-organizational-units-for-parent --parent-id "$root_id" \
  --query "OrganizationalUnits[?Name=='Workloads'].Id | [0]" --output text)

ensure_policy() { # name description file
  local id
  id=$(aws organizations list-policies --filter SERVICE_CONTROL_POLICY \
    --query "Policies[?Name=='$1'].Id | [0]" --output text)
  if [[ "$id" == "None" ]]; then
    id=$(aws organizations create-policy --type SERVICE_CONTROL_POLICY --name "$1" \
      --description "$2" --content "file://$3" --query 'Policy.PolicySummary.Id' --output text)
  else
    aws organizations update-policy --policy-id "$id" --content "file://$3" >/dev/null
  fi
  echo "$id"
}

attach() { # policy target
  aws organizations attach-policy --policy-id "$1" --target-id "$2" 2>/dev/null || true
}

# Region lock, one policy per Region, attached per account.
# account:region pairs (plain list: macOS ships bash 3.2)
tmp=$(mktemp -d)
for pair in jobdeputy-dev-iad:us-east-1 jobdeputy-prod-iad:us-east-1 \
            jobdeputy-prod-bom:ap-south-1 jobdeputy-prod-lhr:eu-west-2; do
  name=${pair%%:*}; region=${pair#*:}
  acct=$(aws organizations list-accounts --query "Accounts[?Name=='$name'].Id | [0]" --output text)
  [[ "$acct" == "None" ]] && continue
  sed "s/__REGION__/$region/" "$here/policies/region-lock.template.json" > "$tmp/$region.json"
  pid=$(ensure_policy "jd-region-lock-$region" "Deny all Regions except $region" "$tmp/$region.json")
  attach "$pid" "$acct"
  echo "Region lock $region attached to $name"
done

cost=$(ensure_policy jd-cost-guardrails "Deny costly services and leaving the org (decision 0005)" \
  "$here/policies/cost-guardrails.json")
attach "$cost" "$workloads_ou"
echo "Cost guardrails attached to Workloads"

stop=$(ensure_policy jd-budget-stop "Attached by the budget action at \$20 (decision 0005)" \
  "$here/policies/budget-stop.json")
echo "Budget-stop policy ready (not attached): $stop"
