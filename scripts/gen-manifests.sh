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
  # Two passes, both load-bearing:
  #
  #   1. Drop the test-hook templates. A static `kubectl apply` should not
  #      create a Pod that runs once and exits, nor the NetworkPolicy that
  #      exists only for it.
  #   2. Tidy the separators that leaves behind. Skipping a document strands
  #      its leading `---`, and Helm 3 and Helm 4 disagree about emitting a
  #      blank line before one — which made the checked-in file depend on
  #      whichever version the committer happened to have, and the drift check
  #      fail for reasons that had nothing to do with the chart.
  #
  #      So: hold each `---` until a real line proves a document follows it,
  #      squeeze the blanks in between, and drop any separator still pending at
  #      EOF.
  helm template plumb "$chart" \
    --namespace plumb \
    --values "$root/deploy/k8s/values.yaml" \
    --api-versions networking.k8s.io/v1 \
    | awk '/^# Source: plumb\/templates\/tests\//{skip=1} /^---$/{skip=0} !skip' \
    | awk '
        /^---$/          { pending = 1; blanks = ""; next }
        /^[[:space:]]*$/ { blanks = blanks $0 "\n"; next }
                         {
                           if (pending) { print "---"; pending = 0; blanks = "" }
                           printf "%s", blanks; blanks = ""
                           print
                         }
        END              { printf "%s", blanks }
      '
} > "$out"

echo "✓ wrote $out"
