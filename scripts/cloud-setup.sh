#!/usr/bin/env bash
# Setup script for Claude Code cloud environments (paste into the environment's
# setup script, or run it). Installs the repo toolchain so sessions can run
# `pnpm verify` and `pnpm synth`. No AWS credentials are needed or used.
set -euo pipefail
npm install -g corepack@latest >/dev/null
corepack enable pnpm
pnpm install --frozen-lockfile
