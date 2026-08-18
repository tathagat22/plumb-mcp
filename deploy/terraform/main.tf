locals {
  # The chart accepts the token either inline or as a Secret reference. Prefer
  # a Secret the operator manages; fall back to one this module creates only
  # when `figma_token` was supplied, and never invent a placeholder.
  managed_secret_name = var.figma_token != null ? "${var.release_name}-figma-tf" : null
  figma_secret_name   = coalesce(var.figma_existing_secret, local.managed_secret_name, "")

  verify_targets = [
    for t in try(var.verify.targets, []) : merge(
      {
        name = t.name
        url  = t.url
        node = t.node
      },
      t.selector == null ? {} : { selector = t.selector },
      t.wait_ms == null ? {} : { waitMs = t.wait_ms },
    )
  ]

  values = {
    fullnameOverride = var.release_name

    image = {
      repository = var.image_repository
      tag        = var.image_tag
    }

    figma = {
      existingSecret = local.figma_secret_name
    }

    service = {
      type = var.service_type
    }

    ingress = try(var.ingress.enabled, false) ? {
      enabled     = true
      className   = try(var.ingress.class_name, "")
      annotations = try(var.ingress.annotations, {})
      hosts = [{
        host  = var.ingress.host
        paths = [{ path = "/", pathType = "Prefix" }]
      }]
      tls = try(var.ingress.tls_secret, "") == "" ? [] : [{
        secretName = var.ingress.tls_secret
        hosts      = [var.ingress.host]
      }]
    } : { enabled = false }

    networkPolicy = {
      enabled = true
      allowFromPodSelector = length(var.network_policy_allow_pod_labels) == 0 ? {} : {
        matchLabels = var.network_policy_allow_pod_labels
      }
    }

    persistence = {
      enabled      = try(var.persistence.enabled, false)
      size         = try(var.persistence.size, "5Gi")
      storageClass = try(var.persistence.storage_class, "")
    }

    bridge = {
      resources = {
        requests = {
          cpu    = try(var.resources.cpu_request, "50m")
          memory = try(var.resources.memory_request, "128Mi")
        }
        limits = {
          memory = try(var.resources.memory_limit, "512Mi")
        }
      }
    }

    verify = {
      enabled  = try(var.verify.enabled, false)
      schedule = try(var.verify.schedule, "0 * * * *")
      fileKey  = try(var.verify.file_key, "")
      targets  = local.verify_targets
    }

    commonLabels = var.common_labels
  }
}

resource "kubernetes_namespace_v1" "this" {
  count = var.create_namespace ? 1 : 0

  metadata {
    name = var.namespace
    labels = merge(var.common_labels, {
      "app.kubernetes.io/part-of" = "plumb"
      # Plumb runs unprivileged, non-root, read-only-rootfs, no capabilities,
      # so it satisfies the strictest Pod Security Standard. Enforcing it here
      # means a future change that regresses that gets rejected by the API
      # server rather than quietly shipping.
      "pod-security.kubernetes.io/enforce"         = "restricted"
      "pod-security.kubernetes.io/enforce-version" = "latest"
    })
  }
}

# Created only when the caller passed a token inline. The token is in Terraform
# state either way — that is the trade `figma_token` makes, and why
# `figma_existing_secret` is the documented default.
resource "kubernetes_secret_v1" "figma" {
  count = var.figma_token != null && var.figma_existing_secret == null ? 1 : 0

  metadata {
    name      = local.managed_secret_name
    namespace = var.namespace
    labels    = merge(var.common_labels, { "app.kubernetes.io/part-of" = "plumb" })
  }

  type = "Opaque"

  data = {
    FIGMA_TOKEN = var.figma_token
  }

  depends_on = [kubernetes_namespace_v1.this]
}

resource "helm_release" "plumb" {
  name      = var.release_name
  namespace = var.namespace

  chart   = var.chart_path
  version = var.chart_version

  # Wait for the Deployment to report ready before the apply succeeds — without
  # this Terraform returns green the moment the manifests are accepted, which
  # says nothing about whether Plumb actually came up.
  wait          = true
  atomic        = var.atomic
  timeout       = var.timeout_seconds
  recreate_pods = false

  values = compact([
    yamlencode(local.values),
    var.extra_values,
  ])

  depends_on = [
    kubernetes_namespace_v1.this,
    kubernetes_secret_v1.figma,
  ]
}
