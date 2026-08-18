#!/usr/bin/env bash
# Regenerate deploy/k8s/plumb.yaml from the Helm chart.
#
# The plain manifests exist so `kubectl apply -f` works without Helm, but two
# hand-maintained copies of the same deployment drift within a release. So they
# are generated, committed, and checked in CI: `npm run deploy:manifests` then
# `git diff --exit-code deploy/k8s`.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
chart="$root/deploy/helm/plumb"
out="$root/deploy/k8s/plumb.yaml"

if ! command -v helm >/dev/null 2>&1; then
  echo "helm is required: https://helm.sh/docs/intro/install/" >&2
  exit 1
fi

{
  cat <<'HEADER'
# GENERATED FILE — DO NOT EDIT.
#
# Rendered from deploy/helm/plumb with deploy/k8s/values.yaml by
# `npm run deploy:manifests`. Edit the chart or those values, then regenerate.
# CI fails if this file is out of date.
#
#   kubectl create namespace plumb
#   kubectl apply -n plumb -f deploy/k8s/plumb.yaml
#   kubectl -n plumb port-forward svc/plumb 31337:31337
#
# See deploy/README.md for what this does and does not expose.
HEADER
  # `helm template` emits its test hook too; a static apply shouldn't create a
  # Pod that runs once and exits, so it is filtered out here.
  helm template plumb "$chart" \
    --namespace plumb \
    --values "$root/deploy/k8s/values.yaml" \
    --api-versions networking.k8s.io/v1 \
    | awk '/^# Source: plumb\/templates\/tests\//{skip=1} /^---$/{skip=0} !skip'
} > "$out"

echo "✓ wrote $out"
