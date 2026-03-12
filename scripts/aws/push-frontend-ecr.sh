#!/usr/bin/env bash
# =============================================================================
# push-frontend-ecr.sh — Frontend Docker-Image in AWS ECR pushen.
#
# Verwendung:
#   ./scripts/aws/push-frontend-ecr.sh                # Tag = git short SHA
#   ./scripts/aws/push-frontend-ecr.sh --dry-run      # Nur anzeigen, nicht pushen
#   IMAGE_TAG=v1.2.3 ./scripts/aws/push-frontend-ecr.sh
#
# Voraussetzungen:
#   - Docker
#   - AWS CLI konfiguriert (aws configure oder IAM Role)
#   - Image muss vorher mit docker-build-frontend.sh gebaut worden sein
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# ── Konfiguration ────────────────────────────────────────────────────────────
AWS_REGION="eu-central-2"
REGISTRY="648786395667.dkr.ecr.${AWS_REGION}.amazonaws.com"
PROJECT="patientsync-prod"
IMAGE_NAME="${REGISTRY}/${PROJECT}-frontend"
ECR_REPO="${PROJECT}-frontend"

# ── Flags parsen ─────────────────────────────────────────────────────────────
DRY_RUN=false
for arg in "$@"; do
  case "${arg}" in
    --dry-run) DRY_RUN=true ;;
  esac
done

# ── Tag-Aufloesung ──────────────────────────────────────────────────────────
TAG="${IMAGE_TAG:-$(git -C "${PROJECT_ROOT}" rev-parse --short HEAD 2>/dev/null || echo 'local')}"

echo ""
echo "========================================================================"
echo "  patientsync — Frontend ECR Push"
echo "========================================================================"
echo "  Image    : ${IMAGE_NAME}:${TAG}"
echo "  Registry : ${REGISTRY}"
echo "  Dry-Run  : $( [[ "${DRY_RUN}" == true ]] && echo 'ja' || echo 'nein' )"
echo ""

# ── Pruefen, ob das Image lokal existiert ────────────────────────────────────
if ! docker image inspect "${IMAGE_NAME}:${TAG}" &>/dev/null; then
  echo "[FAIL] Image nicht gefunden: ${IMAGE_NAME}:${TAG}" >&2
  echo "       Bitte zuerst bauen: ./scripts/aws/docker-build-frontend.sh" >&2
  exit 1
fi
echo "[OK] Lokales Image gefunden: ${IMAGE_NAME}:${TAG}"

# ── ECR Login ────────────────────────────────────────────────────────────────
echo ""
echo "[auth] ECR Login..."
if [[ "${DRY_RUN}" == true ]]; then
  echo "[dry-run] aws ecr get-login-password | docker login ${REGISTRY}"
else
  aws ecr get-login-password --region "${AWS_REGION}" | \
    docker login --username AWS --password-stdin "${REGISTRY}"
fi

# ── ECR Repository sicherstellen ─────────────────────────────────────────────
if [[ "${DRY_RUN}" == false ]]; then
  if ! aws ecr describe-repositories \
    --repository-names "${ECR_REPO}" \
    --region "${AWS_REGION}" &>/dev/null; then
    echo "[ecr] Repository ${ECR_REPO} existiert nicht, wird erstellt..."
    aws ecr create-repository \
      --repository-name "${ECR_REPO}" \
      --region "${AWS_REGION}" \
      --image-scanning-configuration scanOnPush=true \
      --encryption-configuration encryptionType=AES256 >/dev/null
    echo "[ecr] Repository erstellt."
  fi
fi

# ── Image taggen und pushen ──────────────────────────────────────────────────
echo ""
echo "----------------------------------------------------------------------"
echo "[push] Pushing ${IMAGE_NAME}:${TAG} ..."

if [[ "${DRY_RUN}" == true ]]; then
  echo "[dry-run] docker push ${IMAGE_NAME}:${TAG}"
  echo "[dry-run] docker push ${IMAGE_NAME}:latest"
else
  docker push "${IMAGE_NAME}:${TAG}"
  echo "[push] ${IMAGE_NAME}:${TAG} gepusht."

  # latest Tag pushen
  docker tag "${IMAGE_NAME}:${TAG}" "${IMAGE_NAME}:latest"
  docker push "${IMAGE_NAME}:latest"
  echo "[push] ${IMAGE_NAME}:latest gepusht."
fi

# ── Push verifizieren ────────────────────────────────────────────────────────
echo ""
echo "----------------------------------------------------------------------"
echo "[verify] Pruefe Image in ECR..."

if [[ "${DRY_RUN}" == true ]]; then
  echo "[dry-run] aws ecr describe-images --repository-name ${ECR_REPO} --image-ids imageTag=${TAG}"
else
  ecr_result="$(aws ecr describe-images \
    --repository-name "${ECR_REPO}" \
    --image-ids imageTag="${TAG}" \
    --region "${AWS_REGION}" \
    --query 'imageDetails[0].{digest:imageDigest,pushedAt:imagePushedAt,size:imageSizeInBytes}' \
    --output table 2>/dev/null || true)"

  if [[ -n "${ecr_result}" ]]; then
    echo "[verify] Image erfolgreich in ECR gefunden:"
    echo "${ecr_result}"
  else
    echo "[FAIL] Image konnte in ECR nicht verifiziert werden!" >&2
    exit 1
  fi
fi

# ── Alte untagged Images aufraeumen (behalte letzte 5) ───────────────────────
echo ""
echo "----------------------------------------------------------------------"
echo "[cleanup] Raeume alte untagged Images auf..."

if [[ "${DRY_RUN}" == true ]]; then
  echo "[dry-run] Wuerde untagged Images entfernen (behalte letzte 5)"
else
  # Alle untagged Image Digests holen, sortiert nach Push-Datum (aelteste zuerst)
  untagged_digests="$(aws ecr describe-images \
    --repository-name "${ECR_REPO}" \
    --region "${AWS_REGION}" \
    --filter tagStatus=UNTAGGED \
    --query 'sort_by(imageDetails, &imagePushedAt)[*].imageDigest' \
    --output text 2>/dev/null || true)"

  if [[ -n "${untagged_digests}" ]]; then
    # In Array umwandeln
    read -ra digests <<< "${untagged_digests}"
    total=${#digests[@]}

    if (( total > 5 )); then
      to_delete=$(( total - 5 ))
      echo "[cleanup] ${total} untagged Images gefunden, loesche ${to_delete} aelteste..."

      delete_ids=""
      for (( i=0; i<to_delete; i++ )); do
        delete_ids+="imageDigest=${digests[$i]} "
      done

      # Batch-Delete (max 100 pro Aufruf)
      image_ids_json="["
      for (( i=0; i<to_delete; i++ )); do
        [[ $i -gt 0 ]] && image_ids_json+=","
        image_ids_json+="{\"imageDigest\":\"${digests[$i]}\"}"
      done
      image_ids_json+="]"

      aws ecr batch-delete-image \
        --repository-name "${ECR_REPO}" \
        --region "${AWS_REGION}" \
        --image-ids "${image_ids_json}" >/dev/null

      echo "[cleanup] ${to_delete} untagged Images geloescht."
    else
      echo "[cleanup] Nur ${total} untagged Images vorhanden — nichts zu loeschen."
    fi
  else
    echo "[cleanup] Keine untagged Images gefunden."
  fi
fi

# ── Zusammenfassung ──────────────────────────────────────────────────────────
echo ""
echo "========================================================================"
if [[ "${DRY_RUN}" == true ]]; then
  echo "  [DRY-RUN] Keine Aenderungen vorgenommen."
else
  echo "  Image erfolgreich gepusht:"
  echo "    ${IMAGE_NAME}:${TAG}"
  echo "    ${IMAGE_NAME}:latest"
  echo ""
  echo "  Ansible Deploy:"
  echo "    cd ansible && ansible-playbook playbooks/deploy.yml --ask-vault-pass -e image_tag=${TAG}"
fi
echo "========================================================================"
