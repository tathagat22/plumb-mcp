#!/usr/bin/env bash
# Policy-scan every piece of infrastructure this repo ships.
#
# Two scanners, because they disagree usefully:
#   - Trivy   gates on HIGH/CRITICAL and covers Dockerfile + Kubernetes +
#             Terraform in one pass. It is the maintained successor to tfsec.
#   - Checkov gates on ANY failed check, since open-source Checkov has no
#             severities. Every suppression is listed and justified in
#             .checkov.yaml.
#
# Two Checkov invocations rather than one: the Dockerfile lives at the repo
# root, and widening the scan to `.` would drag in node_modules and every
# unrelated YAML. Targets go on the command line because a `directory` key in
# .checkov.yaml would override them.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

for tool in trivy checkov; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "$tool is required. brew install trivy checkov" >&2
    exit 1
  }
done

echo "── Trivy: Dockerfile, Kubernetes, Terraform (gate: HIGH/CRITICAL) ──"
trivy config \
  --severity HIGH,CRITICAL \
  --exit-code 1 \
  --disable-telemetry \
  --skip-dirs '**/node_modules' \
  --skip-dirs '**/.terraform' \
  .

echo
echo "── Checkov: deploy/ (gate: any failed check) ──"
checkov --compact --quiet -d deploy

echo
echo "── Checkov: Dockerfile ──"
checkov --compact --quiet -f Dockerfile

echo
echo "✓ all infrastructure policy scans clean"
