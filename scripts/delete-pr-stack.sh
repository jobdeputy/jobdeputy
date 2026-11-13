#!/usr/bin/env bash
# #61: deletes a PR stack, retrying when AWS fails a resource's delete with an
# internal error (seen: the HTTP API's Cognito authorizer, "InternalFailure").
# Prints the resources that failed and why, and fails only if every attempt fails.
#
#   delete-pr-stack.sh <jobdeputy-dev-prN-iad>
set -euo pipefail

ATTEMPTS=3
stack="$1"
case "$stack" in jobdeputy-dev-pr*-iad) ;; *) echo "Refusing $stack"; exit 1 ;; esac

for attempt in $(seq 1 "$ATTEMPTS"); do
  aws cloudformation delete-stack --stack-name "$stack"
  if aws cloudformation wait stack-delete-complete --stack-name "$stack"; then
    echo "Deleted $stack (attempt $attempt)"
    exit 0
  fi
  echo "::warning::Deleting $stack failed (attempt $attempt of $ATTEMPTS). Failed resources:"
  aws cloudformation describe-stack-events --stack-name "$stack" --max-items 50 \
    --query 'StackEvents[?ResourceStatus==`DELETE_FAILED`].[Timestamp,LogicalResourceId,ResourceStatusReason]' \
    --output text || true
  if [ "$attempt" -lt "$ATTEMPTS" ]; then sleep 30; fi
done
echo "::error::Could not delete $stack after $ATTEMPTS attempts."
exit 1
