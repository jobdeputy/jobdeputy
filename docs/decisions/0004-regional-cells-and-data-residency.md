# 0004: Regional cells and data residency

- **Status:** Proposed
- **Date:** 2026-09-27
- **Task:** t03

## Context

JobDeputy launches in the US, India, and the UK. From day 1, user data must not move from one Region to another. Dev runs only in the US. Prod runs in all three Regions and is created at launch, but everything must be built for it now.

## Decision

1. **Cells.** Each (stage, Region) pair is a self-contained deployment that shares no data with the others:

   | Cell | AWS Region | Stages |
   |---|---|---|
   | `us` | `us-east-1` (N. Virginia) | dev, prod |
   | `in` | `ap-south-1` (Mumbai) | prod |
   | `uk` | `eu-west-2` (London) | prod |

   Each cell has its own Cognito user pool, DynamoDB tables, S3 buckets, SQS queues, Lambdas, logs, and (later) credential storage.

2. **Home Region.** A user chooses their Region at signup, and it is fixed. All of the user's data (profile, résumé, crawl requests, jobs, generated materials, credentials, and logs about them) lives only in that Region. Moving Regions means export, then delete, then sign up again.

3. **Prohibited:** DynamoDB global tables, S3 cross-Region replication, cross-Region backup copies, cross-Region CDK references, and any central store holding user data from several Regions (for example a global email-to-Region directory). Logs and metrics that contain user data stay in their cell.

4. **Global AWS services** are used only for data that is not user data. CloudFront serves static UI assets and never caches user data. The ACM certificate for CloudFront lives in `us-east-1`. IAM, Route 53, and Organizations are control-plane only.

5. **Enforcement:**
   - service control policies deny actions outside each account's allowed Regions;
   - CDK assertion tests fail the build on disallowed Regions, cross-Region references, global tables, or replication;
   - the PR template's security review asks whether data crosses a Region.

6. **Third parties.** When a user brings their own AI key (BYOT), their chosen provider processes the data under that provider's terms and location. The product discloses this. JobDeputy does not relay the data through another JobDeputy Region.

## Why

This is legal and trust hygiene for users in three jurisdictions. Designing for cells now costs almost nothing, while retrofitting residency later means migrating data.

## Consequences

- There is no single global view of users. Cross-Region analytics use only aggregated, non-personal metrics.
- Login needs a way to find a user's Region without a global directory, for example Region-specific subdomains plus a Region picker. This is decided in the auth task.
- Operations such as deploys, alarms, and dashboards are repeated per cell, automated through the cell loop in CDK and CI.
