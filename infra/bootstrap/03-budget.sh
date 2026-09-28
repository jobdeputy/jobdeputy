#!/usr/bin/env bash
# $20 monthly organization budget with alerts at $5/$10/$15 actual and $20
# forecast, an automatic budget-stop action at $20 actual, and daily
# anomaly alerts. Usage: ALERT_EMAIL=... ./03-budget.sh
set -euo pipefail
export AWS_PROFILE="${AWS_PROFILE:-jobdeputy-mgmt}"
: "${ALERT_EMAIL:?set ALERT_EMAIL}"
mgmt=$(aws sts get-caller-identity --query Account --output text)
budget=jobdeputy-pre-launch

root_id=$(aws organizations list-roots --query 'Roots[0].Id' --output text)
workloads_ou=$(aws organizations list-organizational-units-for-parent --parent-id "$root_id" \
  --query "OrganizationalUnits[?Name=='Workloads'].Id | [0]" --output text)
stop=$(aws organizations list-policies --filter SERVICE_CONTROL_POLICY \
  --query "Policies[?Name=='jd-budget-stop'].Id | [0]" --output text)
org_id=$(aws organizations describe-organization --query Organization.Id --output text)

sub="SubscriptionType=EMAIL,Address=$ALERT_EMAIL"
if ! aws budgets describe-budget --account-id "$mgmt" --budget-name "$budget" >/dev/null 2>&1; then
  # Gross cost: credits and refunds do not hide spend.
  aws budgets create-budget --account-id "$mgmt" --budget "{
    \"BudgetName\": \"$budget\", \"BudgetType\": \"COST\", \"TimeUnit\": \"MONTHLY\",
    \"BudgetLimit\": {\"Amount\": \"20\", \"Unit\": \"USD\"},
    \"CostTypes\": {\"IncludeCredit\": false, \"IncludeRefund\": false}}"
  for pct in 25 50 75; do
    aws budgets create-notification --account-id "$mgmt" --budget-name "$budget" \
      --notification "NotificationType=ACTUAL,ComparisonOperator=GREATER_THAN,Threshold=$pct,ThresholdType=PERCENTAGE" \
      --subscribers "$sub"
  done
  aws budgets create-notification --account-id "$mgmt" --budget-name "$budget" \
    --notification "NotificationType=FORECASTED,ComparisonOperator=GREATER_THAN,Threshold=100,ThresholdType=PERCENTAGE" \
    --subscribers "$sub"
fi
echo "Budget $budget: \$20, alerts at \$5/\$10/\$15 actual and \$20 forecast"

# Role the Budgets service uses to attach the budget-stop policy.
role=jobdeputy-budget-action
if ! aws iam get-role --role-name "$role" >/dev/null 2>&1; then
  aws iam create-role --role-name "$role" --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{"Effect": "Allow", "Principal": {"Service": "budgets.amazonaws.com"},
      "Action": "sts:AssumeRole",
      "Condition": {"StringEquals": {"aws:SourceAccount": "'"$mgmt"'"}}}]}' >/dev/null
fi
aws iam put-role-policy --role-name "$role" --policy-name attach-budget-stop --policy-document '{
  "Version": "2012-10-17",
  "Statement": [{"Effect": "Allow",
    "Action": ["organizations:AttachPolicy", "organizations:DetachPolicy"],
    "Resource": [
      "arn:aws:organizations::'"$mgmt"':policy/'"$org_id"'/service_control_policy/'"$stop"'",
      "arn:aws:organizations::'"$mgmt"':ou/'"$org_id"'/'"$workloads_ou"'"]}]}'
role_arn=$(aws iam get-role --role-name "$role" --query Role.Arn --output text)

existing=$(aws budgets describe-budget-actions-for-budget --account-id "$mgmt" --budget-name "$budget" \
  --query 'length(Actions)' --output text)
if [[ "$existing" == "0" ]]; then
  sleep 10 # IAM propagation
  aws budgets create-budget-action --account-id "$mgmt" --budget-name "$budget" \
    --notification-type ACTUAL --action-type APPLY_SCP_POLICY \
    --action-threshold ActionThresholdValue=100,ActionThresholdType=PERCENTAGE \
    --definition "ScpActionDefinition={PolicyId=$stop,TargetIds=[$workloads_ou]}" \
    --execution-role-arn "$role_arn" --approval-model AUTOMATIC \
    --subscribers "$sub" >/dev/null
fi
echo "Budget action: attach jd-budget-stop to Workloads at \$20 actual (automatic)"

# Daily anomaly email for any anomaly with impact >= $1. AWS creates a default
# subscription at $100 and 40%, which is too loose for a $20 budget, so tighten it.
monitor=$(aws ce get-anomaly-monitors --query 'AnomalyMonitors[0].MonitorArn' --output text)
threshold='{"Dimensions": {"Key": "ANOMALY_TOTAL_IMPACT_ABSOLUTE", "Values": ["1"], "MatchOptions": ["GREATER_THAN_OR_EQUAL"]}}'
sub_arn=$(aws ce get-anomaly-subscriptions --query 'AnomalySubscriptions[0].SubscriptionArn' --output text)
if [[ "$sub_arn" == "None" ]]; then
  aws ce create-anomaly-subscription --anomaly-subscription "{
    \"SubscriptionName\": \"jobdeputy-daily\", \"Frequency\": \"DAILY\",
    \"MonitorArnList\": [\"$monitor\"],
    \"Subscribers\": [{\"Type\": \"EMAIL\", \"Address\": \"$ALERT_EMAIL\"}],
    \"ThresholdExpression\": $threshold}" >/dev/null
else
  aws ce update-anomaly-subscription --subscription-arn "$sub_arn" --frequency DAILY \
    --threshold-expression "$threshold" >/dev/null
fi
echo "Anomaly alerts: daily email for impact >= \$1"
