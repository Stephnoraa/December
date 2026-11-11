#!/usr/bin/env bash
# Deploys the API image to Cloud Run from infra/cloudrun/service.yaml.
# Required env: GCP_PROJECT, REGION, APP_ENV (staging|production), IMAGE, API_PUBLIC_URL,
# CUSTOMER_APP_URL, STAFF_APP_URL, PUBLIC_ASSET_BASE_URL, S3_ENDPOINT, S3_BUCKET,
# RUNTIME_SERVICE_ACCOUNT. Optional: MAX_INSTANCES (default 4).
set -euo pipefail
: "${GCP_PROJECT:?}" "${REGION:?}" "${APP_ENV:?}" "${IMAGE:?}"
export SERVICE_NAME="${SERVICE_NAME:-qr-api-${APP_ENV}}"
export MAX_INSTANCES="${MAX_INSTANCES:-4}"
rendered="$(mktemp)"
envsubst < "$(dirname "$0")/service.yaml" > "$rendered"
gcloud run services replace "$rendered" --project "$GCP_PROJECT" --region "$REGION"
# Public API (auth is handled by the app).
gcloud run services add-iam-policy-binding "$SERVICE_NAME" --project "$GCP_PROJECT" --region "$REGION" \
  --member=allUsers --role=roles/run.invoker >/dev/null
gcloud run services describe "$SERVICE_NAME" --project "$GCP_PROJECT" --region "$REGION" --format='value(status.url)'
