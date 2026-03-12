# Frontend S3 Migration Guide

## Target folders
- Drag-and-drop bundle target: `dhapp/frontend`
- Admin/config/security docs: `dhapp/admin`

## Build/export workflow
1. Ensure Docker Desktop is running.
2. Copy env template:
   - `cp dhapp/admin/frontend.build.env.example dhapp/admin/frontend.build.env`
3. Optional (recommended): generate env from SSM:
   - `AWS_REGION=eu-central-2 SSM_PREFIX=/patientsync/prod/frontend bash dhapp/admin/generate_frontend_build_env_from_ssm.sh`
4. Build/export:
   - `bash dhapp/admin/export_frontend_bundle.sh`
   - Or force generation from SSM during export:
     `LOAD_FRONTEND_ENV_FROM_SSM=true AWS_REGION=eu-central-2 SSM_PREFIX=/patientsync/prod/frontend bash dhapp/admin/export_frontend_bundle.sh`
   - Build metadata is written to `dhapp/admin/BUILD_INFO_FRONTEND.txt` (not to public bundle).
5. Verify bundle exists in `dhapp/frontend` (`index.html`, `static/`).

## Upload workflow
1. Set bucket:
   - `export S3_BUCKET=<your-frontend-bucket>`
2. Optional CloudFront invalidation:
   - `export CLOUDFRONT_DISTRIBUTION_ID=<distribution-id>`
3. Upload:
   - `bash dhapp/admin/upload_frontend_to_s3.sh`

## CloudFront behavior (recommended)
- Default behavior -> S3 origin (static frontend)
- `/api/*` behavior -> ALB origin (backend)

## Production rules
- Keep `REACT_APP_API_BASE` and `REACT_APP_API_URL` empty for same-origin mode.
- Do not set `REACT_APP_DEV_*` in production.
- Keep `GENERATE_SOURCEMAP=false` in production.
- Do not put secrets into frontend env variables.
- Upload script intentionally excludes `BUILD_INFO.txt`, `asset-manifest.json`, and `*.map` files from S3.
