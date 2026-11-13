#!/usr/bin/env bash
# Creates OUs and a workload account, enables centralized root access,
# and gives the human admin access to the new account.
# Usage: DEV_IAD_EMAIL=... ADMIN_USERNAME=... ./01-organization.sh
set -euo pipefail
export AWS_PROFILE="${AWS_PROFILE:-jobdeputy-mgmt}"
: "${DEV_IAD_EMAIL:?set DEV_IAD_EMAIL}"
: "${ADMIN_USERNAME:?set ADMIN_USERNAME}"

root_id=$(aws organizations list-roots --query 'Roots[0].Id' --output text)

ensure_ou() { # parent name
  local id
  id=$(aws organizations list-organizational-units-for-parent --parent-id "$1" \
    --query "OrganizationalUnits[?Name=='$2'].Id | [0]" --output text)
  if [[ "$id" == "None" ]]; then
    id=$(aws organizations create-organizational-unit --parent-id "$1" --name "$2" \
      --query 'OrganizationalUnit.Id' --output text)
  fi
  echo "$id"
}

workloads_ou=$(ensure_ou "$root_id" Workloads)
dev_ou=$(ensure_ou "$workloads_ou" Dev)
prod_ou=$(ensure_ou "$workloads_ou" Prod)
echo "OUs: Workloads=$workloads_ou Dev=$dev_ou Prod=$prod_ou"

# Centralized root access: member accounts get no root credentials.
aws organizations enable-aws-service-access --service-principal iam.amazonaws.com
aws iam enable-organizations-root-credentials-management >/dev/null
aws iam enable-organizations-root-sessions >/dev/null
echo "Centralized root access: enabled"

create_account() { # name email ou
  local id
  id=$(aws organizations list-accounts --query "Accounts[?Name=='$1'].Id | [0]" --output text)
  if [[ "$id" == "None" ]]; then
    local req
    req=$(aws organizations create-account --account-name "$1" --email "$2" \
      --iam-user-access-to-billing DENY --query 'CreateAccountStatus.Id' --output text)
    while :; do
      read -r state id reason < <(aws organizations describe-create-account-status \
        --create-account-request-id "$req" \
        --query 'CreateAccountStatus.[State,AccountId,FailureReason]' --output text)
      [[ "$state" == "SUCCEEDED" ]] && break
      [[ "$state" == "FAILED" ]] && { echo "Account creation failed: $reason" >&2; exit 1; }
      sleep 10
    done
    aws organizations move-account --account-id "$id" \
      --source-parent-id "$root_id" --destination-parent-id "$3"
  fi
  echo "$id"
}

dev_iad=$(create_account jobdeputy-dev-iad "$DEV_IAD_EMAIL" "$dev_ou")
echo "Account jobdeputy-dev-iad: $dev_iad"

# Give the human admin AdministratorAccess on the new account.
instance_arn=$(aws sso-admin list-instances --query 'Instances[0].InstanceArn' --output text)
store_id=$(aws sso-admin list-instances --query 'Instances[0].IdentityStoreId' --output text)
user_id=$(aws identitystore list-users --identity-store-id "$store_id" \
  --filters AttributePath=UserName,AttributeValue="$ADMIN_USERNAME" --query 'Users[0].UserId' --output text)
ps_arn=""
for arn in $(aws sso-admin list-permission-sets --instance-arn "$instance_arn" --query 'PermissionSets[]' --output text); do
  name=$(aws sso-admin describe-permission-set --instance-arn "$instance_arn" --permission-set-arn "$arn" \
    --query 'PermissionSet.Name' --output text)
  [[ "$name" == "AdministratorAccess" ]] && ps_arn="$arn"
done
aws sso-admin create-account-assignment --instance-arn "$instance_arn" \
  --target-id "$dev_iad" --target-type AWS_ACCOUNT \
  --permission-set-arn "$ps_arn" --principal-type USER --principal-id "$user_id" >/dev/null
echo "Assigned $ADMIN_USERNAME AdministratorAccess on jobdeputy-dev-iad"
