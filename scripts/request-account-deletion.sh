#!/usr/bin/env bash
# Requests deletion of one account (T12/T13): writes the same DELETION record that
# DELETE /me writes, so the normal deletion pipeline erases the login, every table
# item, and every file. Use this instead of deleting a user in the Cognito console.
#
# Usage: scripts/request-account-deletion.sh <stack-name> <user-id> [aws-profile]
#   <user-id> is the Cognito "sub" (the userId in every user table).
set -euo pipefail

stack="${1:?stack name, for example jobdeputy-dev-iad}"
user_id="${2:?user ID (Cognito sub)}"
profile="${3:-jobdeputy-dev-iad}"

if [[ ! "$user_id" =~ ^[0-9a-f-]{36}$ ]]; then
  echo "Not a user ID: $user_id" >&2
  exit 1
fi

now="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
ttl="$(( $(date -u +%s) + 7200 ))"

aws dynamodb put-item \
  --profile "$profile" \
  --table-name "${stack}-users" \
  --condition-expression "attribute_not_exists(userId)" \
  --item "{
    \"userId\": {\"S\": \"${user_id}\"},
    \"sk\": {\"S\": \"DELETION\"},
    \"type\": {\"S\": \"deletion\"},
    \"username\": {\"S\": \"${user_id}\"},
    \"status\": {\"S\": \"queued\"},
    \"requestedAt\": {\"S\": \"${now}\"},
    \"updatedAt\": {\"S\": \"${now}\"},
    \"ttl\": {\"N\": \"${ttl}\"},
    \"schemaVersion\": {\"N\": \"1\"}
  }" && echo "Deletion requested for ${user_id} in ${stack}. The worker erases it within minutes, with a final sweep 15 minutes later." \
  || { echo "Not requested: a deletion request may already exist for this user." >&2; exit 1; }
