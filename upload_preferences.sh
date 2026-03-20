#!/usr/bin/env zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
source "$SCRIPT_DIR/prod.env.properties"

LOCAL_FILE="$SCRIPT_DIR/config/user-preferences.json"
ACCOUNT_ID=$(aws sts get-caller-identity --profile "$AWS_PROFILE" --query Account --output text)
BUCKET="show-recommender-data-${ACCOUNT_ID}"
S3_KEY="config/user-preferences.json"
BACKUP_KEY="config/user-preferences-$(date +%Y%m%d%H%M%S).json"

if [[ ! -f "$LOCAL_FILE" ]]; then
  echo "Error: $LOCAL_FILE not found"
  exit 1
fi

# Back up existing file if it exists
if aws s3 ls "s3://${BUCKET}/${S3_KEY}" --profile "$AWS_PROFILE" &>/dev/null; then
  echo "Backing up existing file to s3://${BUCKET}/${BACKUP_KEY}"
  aws s3 cp "s3://${BUCKET}/${S3_KEY}" "s3://${BUCKET}/${BACKUP_KEY}" --profile "$AWS_PROFILE"
fi

echo "Uploading $LOCAL_FILE to s3://${BUCKET}/${S3_KEY}"
aws s3 cp "$LOCAL_FILE" "s3://${BUCKET}/${S3_KEY}" \
  --content-type application/json \
  --profile "$AWS_PROFILE"

# Clear discarded events so they are re-evaluated against the new preferences.
# Sent events (events-sent.json) are intentionally preserved to avoid re-sending past digests.
DISCARDED_KEY="data/events-discarded.json"
echo "Clearing s3://${BUCKET}/${DISCARDED_KEY}"
echo '[]' | aws s3 cp - "s3://${BUCKET}/${DISCARDED_KEY}" \
  --content-type application/json \
  --profile "$AWS_PROFILE"

echo "Done."
