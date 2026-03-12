#!/bin/bash
set -e

# --- KONFIGURATION ---
GITHUB_ORG="mr-robowayne"
REPO_NAME="patientsync"
AWS_ACCOUNT_ID="648786395667"
ROLE_NAME="patientsync-frontend-deploy-role"
# Passe diesen Bucket-Namen an, falls er anders heißt!
BUCKET_NAME="patientsync-prod-frontend" 
# ---------------------

echo "Erstelle Frontend Deploy Rolle: $ROLE_NAME"

OIDC_PROVIDER_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"

# 1. Trust Policy (Wer darf die Rolle nutzen? -> GitHub Actions)
cat > trust-policy-frontend.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "$OIDC_PROVIDER_ARN"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:${GITHUB_ORG}/${REPO_NAME}:*"
        },
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        }
      }
    }
  ]
}
EOF

# 2. Rolle erstellen
aws iam create-role --role-name "$ROLE_NAME" --assume-role-policy-document file://trust-policy-frontend.json || aws iam update-assume-role-policy --role-name "$ROLE_NAME" --policy-document file://trust-policy-frontend.json
rm trust-policy-frontend.json

# 3. Permissions Policy (Was darf die Rolle? -> S3 Sync, SSM Read, CloudFront)
cat > permission-policy-frontend.json <<EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "S3Upload",
            "Effect": "Allow",
            "Action": [
                "s3:PutObject",
                "s3:GetObject",
                "s3:ListBucket",
                "s3:DeleteObject",
                "s3:GetBucketLocation",
                "s3:GetBucketPolicy",
                "s3:GetBucketPolicyStatus",
                "s3:GetBucketEncryption",
                "s3:GetBucketPublicAccessBlock",
                "s3:GetBucketWebsite"
            ],
            "Resource": [
                "arn:aws:s3:::${BUCKET_NAME}",
                "arn:aws:s3:::${BUCKET_NAME}/*"
            ]
        },
        {
            "Sid": "ReadSSMParamsForBuild",
            "Effect": "Allow",
            "Action": "ssm:GetParameter",
            "Resource": "arn:aws:ssm:*:*:parameter/patientsync/*"
        },
        {
            "Sid": "CloudFrontInvalidation",
            "Effect": "Allow",
            "Action": [
                "cloudfront:CreateInvalidation",
                "cloudfront:GetDistribution",
                "cloudfront:GetDistributionConfig"
            ],
            "Resource": "*"
        },
        {
            "Sid": "AccountLevelChecks",
            "Effect": "Allow",
            "Action": "s3:GetAccountPublicAccessBlock",
            "Resource": "*"
        }
    ]
}
EOF

aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name "FrontendDeployPolicy" --policy-document file://permission-policy-frontend.json
rm permission-policy-frontend.json

echo "✅ Rolle erstellt: arn:aws:iam::${AWS_ACCOUNT_ID}:role/${ROLE_NAME}"