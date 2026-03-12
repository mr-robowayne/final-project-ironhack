#!/usr/bin/env bash
set -euo pipefail

IMAGE_TAG="${1:-local}"
export IMAGE_TAG

echo "[build] IMAGE_TAG=${IMAGE_TAG}"
docker compose -f docker-compose.images.yml build

echo "[done] Built images:"
docker images --format 'table {{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.Size}}' | rg '^dhapp/' || true
