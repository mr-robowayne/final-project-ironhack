#!/bin/bash
set -e

ROOT=$(git rev-parse --show-toplevel)
DATE=$(date '+%Y-%m-%d')
TIME=$(date '+%H:%M:%S')
USER=$(git config user.name)

echo "[$DATE $TIME] triggered by: $USER" >> "$ROOT/.github/action-loggs/triggers.log"

git add "$ROOT/.github/action-loggs/triggers.log"
git commit -m "chore: trigger pipeline test"
git push origin development