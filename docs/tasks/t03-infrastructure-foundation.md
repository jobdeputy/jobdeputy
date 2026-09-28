# T03: Infrastructure foundation

- **Status:** planned
- **Depends on:** T02

## Goal

The AWS foundation and pipeline for the stack in [0003](../decisions/0003-serverless-aws-stack.md) are in place. A contributor can run the unit tests locally, deploy a personal dev stack with one command, and CI tests every PR and deploys `main` to `dev`.

## Scope

- In: AWS account, Region, and budget alarms; the GitHub OIDC role; the pnpm monorepo and CDK app skeleton; personal, `dev`, and `prod` stages; the CI test job; the deploy workflow; secrets handling; and the cloud-session setup script.
- Out: application features.

## Research

To do. The AWS CLI and CDK bootstrap status on the maintainer's machine are not yet checked. Docker may still be needed to build container-image Lambdas (T06).

## Decision

Pending.

## Done when

- [ ] One command deploys a personal dev stack, and one command runs the unit tests.
- [ ] CI runs lint and tests.
- [ ] Setup is documented in `README.md` and `CLAUDE.md`.
- [ ] A Claude Code cloud environment setup script installs the same tools, so cloud sessions can run the tests. It is documented in `CONTRIBUTING.md`.
