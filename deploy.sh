#!/usr/bin/env zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
source "$SCRIPT_DIR/prod.env.properties"

usage() {
  echo "Usage: $0 --profile <aws-profile> --openai-key <key> --ticketmaster-key <key> --sender-email <email> --recipient-email <email> --openai-model <model>"
  exit 1
}

while [[ $# -gt 0 ]]; do
  case $1 in
    --profile)         AWS_PROFILE="$2"; shift 2 ;;
    --openai-key)      OPENAI_KEY="$2"; shift 2 ;;
    --ticketmaster-key) TICKETMASTER_KEY="$2"; shift 2 ;;
    --sender-email)    SENDER_EMAIL="$2"; shift 2 ;;
    --recipient-email) RECIPIENT_EMAIL="$2"; shift 2 ;;
    --openai-model)    OPENAI_MODEL="$2"; shift 2 ;;
    *) usage ;;
  esac
done

[[ -z "$AWS_PROFILE" || -z "$OPENAI_KEY" || -z "$TICKETMASTER_KEY" || -z "$SENDER_EMAIL" || -z "$RECIPIENT_EMAIL" || -z "$OPENAI_MODEL" ]] && usage

cdk deploy --all \
  --profile "$AWS_PROFILE" \
  --context "openaiKey=$OPENAI_KEY" \
  --context "ticketmasterKey=$TICKETMASTER_KEY" \
  --context "senderEmail=$SENDER_EMAIL" \
  --context "recipientEmail=$RECIPIENT_EMAIL" \
  --context "openaiModel=$OPENAI_MODEL"
