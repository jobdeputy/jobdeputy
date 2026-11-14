#!/usr/bin/env bash
# Decision 0011: delegates a web app zone (for example dev.jobdeputy.com) from the
# jobdeputy.com zone in the management account to the zone that the stage's web DNS
# stack (jobdeputy-<stage>-web-dns) created in its workload account. Run it once after
# that stack's first deploy, and again only if the zone is ever re-created (a new zone
# gets new name servers). Idempotent: the NS record is upserted.
# Usage: ./05-delegate-web-zone.sh [domain]   (default dev.jobdeputy.com)
#   WORKLOAD_PROFILE  profile of the account that owns the zone (default jobdeputy-dev-iad)
#   MGMT_PROFILE      profile of the management account (default jobdeputy-mgmt)
set -euo pipefail
domain="${1:-dev.jobdeputy.com}"
parent="jobdeputy.com"
workload="${WORKLOAD_PROFILE:-jobdeputy-dev-iad}"
mgmt="${MGMT_PROFILE:-jobdeputy-mgmt}"

zone_id() {
  aws route53 list-hosted-zones-by-name --profile "$1" --dns-name "$2" \
    --query "HostedZones[?Name=='$2.'].Id | [0]" --output text
}

child=$(zone_id "$workload" "$domain")
if [ "$child" = "None" ] || [ -z "$child" ]; then
  echo "No $domain zone in $workload. Deploy its web DNS stack first:" >&2
  echo "  ./07-stage-web.sh <stage>   (deploys the zone, then runs this script)" >&2
  exit 1
fi
parent_id=$(zone_id "$mgmt" "$parent")
ns=$(aws route53 get-hosted-zone --profile "$workload" --id "$child" \
  --query 'DelegationSet.NameServers' --output json)

# One hour, so a mistake is corrected quickly; delegations rarely change.
change=$(jq -n --arg name "$domain." --argjson ns "$ns" '{
  Comment: "Delegate \($name) to the web app zone (decision 0011)",
  Changes: [{ Action: "UPSERT", ResourceRecordSet: {
    Name: $name, Type: "NS", TTL: 3600, ResourceRecords: ($ns | map({ Value: . })) } }]
}')
status=$(aws route53 change-resource-record-sets --profile "$mgmt" --hosted-zone-id "$parent_id" \
  --change-batch "$change" --query 'ChangeInfo.Status' --output text)
echo "Delegated $domain to $(jq -r 'join(", ")' <<< "$ns") ($status)."
echo "Check: dig +short NS $domain"
