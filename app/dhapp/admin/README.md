# DHAPP Frontend Admin Kit

## Goal
Prepare and upload the production frontend bundle for S3/CloudFront while keeping secrets out of frontend code.

## Files
- `export_frontend_bundle.sh`: builds frontend image and exports static bundle to `dhapp/frontend`
- `upload_frontend_to_s3.sh`: uploads `dhapp/frontend` to S3 with cache rules + optional CloudFront invalidation
- `generate_frontend_build_env_from_ssm.sh`: generates `frontend.build.env` from AWS SSM Parameter Store
- `BUILD_INFO_FRONTEND.txt`: export metadata kept outside the public bundle
- `frontend.build.env.example`: non-secret frontend build config
- `ENVIRONMENT_AND_SECRETS_MATRIX.md`: what goes to Parameter Store vs Secrets Manager
- `DSGVO_SECURITY_ANALYSE_FRONTEND_2026-03-11.md`: frontend DSGVO/security analysis and action plan

## Quick Start
1. `cp dhapp/admin/frontend.build.env.example dhapp/admin/frontend.build.env`
2. Optional (recommended): generate values from SSM
   `AWS_REGION=eu-central-2 SSM_PREFIX=/patientsync/prod/frontend bash dhapp/admin/generate_frontend_build_env_from_ssm.sh`
3. Edit values only if needed (keep dev vars empty in production).
4. `bash dhapp/admin/export_frontend_bundle.sh`
5. `export S3_BUCKET=<bucket>`
6. Optional: `export CLOUDFRONT_DISTRIBUTION_ID=<id>`
7. `bash dhapp/admin/upload_frontend_to_s3.sh`

## Critical Production Rules
- Never put secrets into `REACT_APP_*` variables.
- Use Same-Origin routing (`/api/*` -> ALB) to avoid token leakage and CORS complexity.
- Keep `REACT_APP_DEV_*` empty in production builds.
- Keep `GENERATE_SOURCEMAP=false` for production exports.
- Do not publish `BUILD_INFO.txt`, `asset-manifest.json`, or `*.map` files to S3.
