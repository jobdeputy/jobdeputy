#!/usr/bin/env bash
# T14: log groups that outlive their stack. CDK's built-in "empty the bucket on
# delete" helper creates a Lambda log group with no expiry, and CloudFormation does
# not delete it with the stack. Our own functions' log groups are fine (14 days,
# deleted with the stack).
#
#   cleanup-log-groups.sh stack <jobdeputy-dev-prN-iad>   after deleting a PR stack
#   cleanup-log-groups.sh sweep                           daily, in the dev account
#
# sweep: deletes /aws/lambda/jobdeputy-dev-pr* log groups whose PR stack is gone, and
# sets 14-day retention on any /aws/lambda/jobdeputy-dev-* log group that has none.
set -euo pipefail

RETENTION_DAYS=14

delete_for_stack() {
  local stack="$1"
  case "$stack" in jobdeputy-dev-pr*-iad) ;; *) echo "Refusing $stack"; exit 1 ;; esac
  aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/${stack}-" \
    --query 'logGroups[].logGroupName' --output text | tr '\t' '\n' | while read -r group; do
    [ -n "$group" ] || continue
    aws logs delete-log-group --log-group-name "$group"
    echo "Deleted $group"
  done
}

stack_exists() {
  local status
  status=$(aws cloudformation describe-stacks --stack-name "$1" \
    --query 'Stacks[0].StackStatus' --output text 2>/dev/null) || return 1
  [ "$status" != "DELETE_COMPLETE" ]
}

sweep() {
  aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/jobdeputy-dev-pr" \
    --query 'logGroups[].logGroupName' --output text | tr '\t' '\n' | while read -r group; do
    [ -n "$group" ] || continue
    stack=$(echo "$group" | sed -E 's#^/aws/lambda/(jobdeputy-dev-pr[0-9]+-iad)-.*#\1#')
    if [ "$stack" != "$group" ] && ! stack_exists "$stack"; then
      aws logs delete-log-group --log-group-name "$group"
      echo "Deleted $group (stack $stack is gone)"
    fi
  done
  aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/jobdeputy-dev-" \
    --query 'logGroups[?!retentionInDays].logGroupName' --output text | tr '\t' '\n' | while read -r group; do
    [ -n "$group" ] || continue
    aws logs put-retention-policy --log-group-name "$group" --retention-in-days "$RETENTION_DAYS"
    echo "Set ${RETENTION_DAYS}-day retention on $group"
  done
}

case "${1:-}" in
  stack) delete_for_stack "${2:?stack name}" ;;
  sweep) sweep ;;
  *) echo "Usage: $0 stack <jobdeputy-dev-prN-iad> | sweep" >&2; exit 2 ;;
esac
