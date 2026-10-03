#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "LinkTide requires Node.js 22+."
  echo "Install Node.js, then run this installer again."
  exit 1
fi

if ! command -v corepack >/dev/null 2>&1; then
  echo "Corepack was not found. LinkTide expects Node.js with Corepack available."
  exit 1
fi

echo "Enabling Corepack..."
corepack enable

echo "Running LinkTide setup..."
corepack pnpm setup

echo
echo "Install complete."
echo "After adding your LM Studio + Brave Search settings to .env, run:"
echo "  pnpm start"
