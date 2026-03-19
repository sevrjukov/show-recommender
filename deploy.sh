#!/usr/bin/env zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
source "$SCRIPT_DIR/prod.env.properties"

usage() {
  echo "Usage: $0 [--profile <aws-profile>] [--openai-key <key>]"
  exit 1
}

while [[ $# -gt 0 ]]; do
  case $1 in
    --profile)   AWS_PROFILE="$2"; shift 2 ;;
    --openai-key) OPENAI_KEY="$2"; shift 2 ;;
    *) usage ;;
  esac
done

[[ -z "$AWS_PROFILE" || -z "$OPENAI_KEY" ]] && usage

cdk deploy --all \
  --profile "$AWS_PROFILE" \
  --context "openaiKey=$OPENAI_KEY"
