# Deploying Plumb

Three ways to run Plumb on Kubernetes, all producing the same thing:

| | Use it when |
|---|---|
| [**Helm chart**](./helm/plumb) | You want the knobs. This is the source of truth. |
| [**Plain manifests**](./k8s) | You want to read the YAML, or you don't run Helm. Generated from the chart. |
| [**Terraform module**](./terraform) | Your cluster is already Terraform, and Plumb should be too. |

```bash
helm install plumb ./deploy/helm/plumb --namespace plumb --create-namespace
helm test plumb --namespace plumb
kubectl -n plumb port-forward svc/plumb 31337:31337
open http://127.0.0.1:31337/
```

---

## Read this before you deploy anything

**The bridge has no authentication.** Not weak authentication — none. Its
security model is *"this is bound to 127.0.0.1 on your laptop, and a human
clicked **Pair with Plumb** in the Figma plugin."* In a cluster the bind
address must be `0.0.0.0` for a Service to reach it at all, which means the
only thing standing between the bridge and the network is what you put there.

So the defaults are deliberately closed:

- `service.type: ClusterIP` — nothing outside the cluster.
- `networkPolicy.enabled: true` with **empty** selectors — nothing *inside* the
  cluster either. The only ingress rule by default is a narrow one for this
  release's own `helm test` pod.
- `ingress.enabled: false`.

Which leaves `kubectl port-forward` as the way in. That is not a workaround; it
is the right answer, and it is also the *only* way the Figma plugin can reach
an in-cluster bridge (see below). Port-forward tunnels through the API server,
so it is authenticated and audited by your cluster's RBAC, and it is not
subject to the NetworkPolicy.

If you widen any of that, put real authentication in front. The Terraform
module refuses to create an ingress with no annotations for exactly this
reason.

---

## What actually works in a cluster, and what doesn't

Plumb has two paths to Figma, and they containerise very differently.

### ✅ The REST path — fully works

`plumb_fig_outline`, `plumb_fig_node`, and the `verify` / `fit` CLIs read Figma
over `api.figma.com` with a `FIGMA_TOKEN`. Nothing about that needs a laptop.
This is what continuous design verification runs on.

### ✅ Plumb Studio — fully works, including over an ingress

Studio resolves its WebSocket from `location.host`, so it behaves correctly
behind an ingress or a port-forward. Set a long read timeout on the ingress
(`nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"`) — the Studio socket
is long-lived and most controllers cut it at 60s.

### ⚠️ The Figma plugin — port-forward only

`figma-plugin/ui.html` scans `127.0.0.1:31337`–`31346` to find a bridge. It has
no notion of a remote host, and Figma's plugin sandbox is not somewhere you can
inject one. So a plugin **cannot** dial a cluster Service directly, no matter
how you expose it.

What does work, and works well:

```bash
kubectl -n plumb port-forward svc/plumb 31337:31337
```

Now `127.0.0.1:31337` on the designer's machine *is* the in-cluster bridge, the
plugin finds it on its normal scan, and pairing behaves exactly as it does
locally. **Keep the local side of the forward on 31337** — that's the port the
plugin looks for.

### Why verify pods sit outside the NetworkPolicy

The bridge's egress rule allows public IPs on 443 and excludes RFC1918 — right
for the bridge, which only ever calls `api.figma.com`. But verify targets are
usually in-cluster Services, whose ClusterIPs live in exactly that excluded
range. So the policy is scoped by `app.kubernetes.io/component: bridge`, and
verify Jobs deliberately fall outside it.

That component label is load-bearing in two more places. Without it the Service
selector and the Deployment selector match *any* pod in the release — so a
running verify Job would be enrolled as a Service endpoint and handed bridge
traffic it cannot answer. The `helm test` pod has its own narrow ingress
allowance, and nothing else gets in.

If your namespace has its own default-deny egress policy, verify Jobs will need
a rule of their own to reach their targets.

### ⚠️ One replica, on purpose

The bridge holds pairing state, the streamed selection, and the node cache in
memory, and only one plugin may be paired with a process at a time. Two
replicas means a paired plugin's next request may land on a pod that has never
heard of it. `bridge.replicaCount` is capped at 1 in the values schema, and the
Deployment uses `Recreate` rather than `RollingUpdate` so a rollout never has
two bridges alive at once.

If you need many concurrent agents, run many *releases* (one per team or per
project), not many replicas — that is exactly what `PLUMB_SESSION_NAME` labels
in the plugin panel.

---

## Continuous design verification

This is the part that earns Plumb a place in a cluster rather than only on a
laptop.

A CronJob renders a URL you already serve, reads every `[data-plumb-id]`
element's box and computed styles, diffs them against the Figma node the page
was built from, and **exits non-zero when they have drifted**. A design
regression stops being something a designer notices in a review three weeks
later, and becomes a failing job with a timestamp and a delta list.

```yaml
# values.yaml
figma:
  existingSecret: plumb-figma        # holds FIGMA_TOKEN

verify:
  enabled: true
  schedule: "0 * * * *"
  fileKey: your_figma_file_key
  targets:
    - name: dashboard
      url: http://app.default.svc.cluster.local/dashboard
      node: "190:109884"            # ':' not '-' — a Figma URL gives you '-'
    - name: pricing
      url: http://app.default.svc.cluster.local/pricing
      node: "12:100"
      waitMs: 2500                  # let client-side rendering settle
```

Run one now instead of waiting for the schedule:

```bash
kubectl -n plumb create job --from=cronjob/plumb-verify-dashboard verify-now
kubectl -n plumb logs job/verify-now
```

The log is the `--json` verify result: matched/unmatched counts, coverage, and
every delta with its expected and actual value.

**It needs the `verifier` image.** The default image ships no browser, on
purpose — most deployments never render anything and Chromium roughly triples
the image. Build the other target:

```bash
docker build --target verifier -t your-registry/plumb-mcp:0.13.2-verifier .
```

The chart appends `verify.image.suffix` (default `-verifier`) to the tag, so
publishing `<tag>-verifier` alongside `<tag>` is all the wiring it needs.

Two things the manifests already handle, because Chromium in a hardened pod
fails on both otherwise: a memory-backed `/dev/shm` (the 64 MB container
default is not enough for a real page) and a writable `/tmp` for the browser
profile, since the root filesystem is read-only.

---

## Credentials

Only the REST path needs a token. The plugin path needs none — a token-free
release still serves Studio and answers a paired plugin.

**Preferred** — bring your own Secret, from External Secrets, Sealed Secrets,
SOPS, or your cloud's secret store:

```yaml
figma:
  existingSecret: plumb-figma
  existingSecretKey: FIGMA_TOKEN
```

**Convenient, for a trial only** — `figma.token: figd_...` makes the chart
create the Secret. That puts the token in your Helm release history, which is
itself a Secret in the namespace and readable by anyone who can run
`helm get values`. Same trade in Terraform with `figma_token`, which additionally
puts it in your state file.

The optional photo-provider keys (`assetProviders.*`) follow the same rules and
are only used by the prompt→design direction.

---

## Security posture

What the chart does by default, and why:

| Control | Setting | Why |
|---|---|---|
| Run as | non-root, UID/GID 65532 | Pinned in the Dockerfile so a base-image bump can't move it out from under `runAsUser` |
| Root filesystem | read-only | `/data` and `/tmp` are the only writable paths, both volumes |
| Capabilities | `drop: ["ALL"]` | Nothing here needs any |
| Privilege escalation | denied | — |
| Seccomp | `RuntimeDefault` | — |
| Service account token | not mounted | Plumb never calls the Kubernetes API |
| Pod Security Standard | `restricted` enforced on the namespace | The workload already satisfies it; enforcing means a regression is rejected by the API server rather than shipped |
| Ingress | deny-all NetworkPolicy | The bridge authenticates nobody |
| Egress | 443 to public IPs, plus DNS; RFC1918 excluded | `api.figma.com`, Google Fonts, and the asset providers, without giving it the cluster network |

Plain `NetworkPolicy` cannot express hostnames, so the egress rule is
"public internet on 443, not the cluster's private ranges". If you run Cilium,
Calico, or a service mesh, tighten it to the actual FQDNs — the network-egress
table in the [root README](../README.md#network-egress) lists every host Plumb
will ever contact.

---

## Everything here is validated in CI

Not just present — checked, on every push, by
[`.github/workflows/iac.yml`](../.github/workflows/iac.yml):

- `helm lint` on the chart, with default values and with everything turned on.
- `helm template` rendered and schema-validated against real Kubernetes API
  schemas with `kubeconform -strict`.
- The values schema exercised against inputs that **must** be rejected, so it
  can't silently stop validating.
- `deploy/k8s/plumb.yaml` regenerated and diffed — the plain manifests cannot
  drift from the chart.
- `terraform fmt -check`, `init`, and `validate` on the module and the example.
- **Policy scanning** with two tools that disagree usefully: **Trivy** gates on
  HIGH/CRITICAL across the Dockerfile, the Kubernetes manifests and the
  Terraform module (it is tfsec's maintained successor), and **Checkov** gates
  on *any* failed check, since open-source Checkov has no severities. Both are
  currently clean — 83 Kubernetes, 165 Helm, and 9 Dockerfile checks passing.
  Every Checkov suppression is listed with its reason in
  [`.checkov.yaml`](../.checkov.yaml); there are six, and each is a considered
  decision rather than a silenced finding.
- Both image targets built, the offline demo run inside the default image, and
  Chromium proven to render a page under the chart's exact securityContext —
  non-root, read-only root filesystem, all capabilities dropped.

Beyond CI, the chart has been installed on a real cluster (kind, with
NetworkPolicy enforced and the `restricted` Pod Security Standard on the
namespace): `helm test` passes, an unauthorised pod is genuinely blocked, only
the bridge is a Service endpoint, `port-forward` serves Studio, and a
`verify` CronJob schedules and runs. Three bugs in this chart were found that
way rather than by reading it.

Reproduce it locally:

```bash
npm run deploy:lint          # helm lint + kubeconform
npm run deploy:scan          # trivy + checkov, exactly as CI runs them
npm run deploy:manifests     # regenerate deploy/k8s/plumb.yaml
git diff --exit-code deploy/k8s
```

`deploy:scan` needs `brew install trivy checkov` (or the equivalent) locally.
CI installs pinned versions of the same two CLIs and runs the same script —
deliberately not the vendors' marketplace actions, because a security job
should not pull unpinned third-party code to do its scanning, and two code
paths would drift. A clean local scan means a clean CI scan.

---

## Uninstall

```bash
helm uninstall plumb --namespace plumb
kubectl delete namespace plumb          # also drops the PVC, if you enabled one
```

Nothing under `/data` is precious — exported assets, screenshots, and the
response cache all regenerate from Figma.
