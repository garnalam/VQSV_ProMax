#!/bin/sh
# Every deploy: a new save envelope build key first (deploy/rotate-build-key.mjs, run in the same
# Node image the build uses since the host has no Node), then the usual build and restart.
set -e
cd "$(dirname "$0")/.."
docker run --rm -v "$PWD/deploy:/app/deploy" -w /app node:24.22.1-bookworm-slim node deploy/rotate-build-key.mjs
docker compose -f deploy/compose.yaml up -d --build
