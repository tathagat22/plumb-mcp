variable "namespace" {
  description = "Namespace to install into."
  type        = string
  default     = "plumb"
}

variable "create_namespace" {
  description = "Create the namespace, with the `restricted` Pod Security Standard enforced."
  type        = bool
  default     = true
}

variable "release_name" {
  description = "Helm release name."
  type        = string
  default     = "plumb"
}

variable "chart_path" {
  description = <<-EOT
    Path to the chart. Defaults to the copy in this repository, so a checkout
    is self-sufficient. Point at a chart repository once you publish one.
  EOT
  type        = string
  default     = "../helm/plumb"
}

variable "chart_version" {
  description = "Chart version, when installing from a repository rather than a path."
  type        = string
  default     = null
}

variable "image_repository" {
  description = "Container image repository."
  type        = string
  default     = "ghcr.io/tathagat22/plumb-mcp"
}

variable "image_tag" {
  description = "Image tag. Empty uses the chart's appVersion. Pin a digest in production."
  type        = string
  default     = ""
}

# -----------------------------------------------------------------------------
# Credentials
# -----------------------------------------------------------------------------
variable "figma_token" {
  description = <<-EOT
    Figma read-only personal access token. Only the REST tools and the
    verify/fit CLIs need it; the plugin path does not.

    Setting this makes Terraform create and own the Secret, which means the
    token lands in Terraform state. If your state is not encrypted and access
    controlled, use `figma_existing_secret` instead and manage the Secret with
    External Secrets, Sealed Secrets, or your cloud's secret store.
  EOT
  type        = string
  default     = null
  sensitive   = true
}

variable "figma_existing_secret" {
  description = "Name of a Secret you manage yourself that holds a FIGMA_TOKEN key."
  type        = string
  default     = null
}

# -----------------------------------------------------------------------------
# Exposure — every one of these widens who can reach an unauthenticated bridge
# -----------------------------------------------------------------------------
variable "service_type" {
  description = "Service type. Leave ClusterIP unless you have read deploy/README.md § Security."
  type        = string
  default     = "ClusterIP"

  validation {
    condition     = contains(["ClusterIP", "NodePort", "LoadBalancer"], var.service_type)
    error_message = "service_type must be one of ClusterIP, NodePort, LoadBalancer."
  }
}

variable "ingress" {
  description = <<-EOT
    Optional ingress for Plumb Studio. The bridge has no authentication of its
    own, so `annotations` must carry whatever your controller uses to require
    it — this module refuses to create an unauthenticated ingress.
  EOT
  type = object({
    enabled     = optional(bool, false)
    class_name  = optional(string, "")
    host        = optional(string, "")
    tls_secret  = optional(string, "")
    annotations = optional(map(string), {})
  })
  default = {}

  validation {
    condition     = !try(var.ingress.enabled, false) || try(length(var.ingress.host), 0) > 0
    error_message = "ingress.host is required when ingress.enabled is true."
  }

  validation {
    condition     = !try(var.ingress.enabled, false) || length(try(var.ingress.annotations, {})) > 0
    error_message = <<-EOT
      Refusing to publish an unauthenticated bridge. plumb-mcp has no auth of
      its own, so an ingress must carry annotations that make your controller
      require it (nginx: auth-type/auth-secret, or an SSO forward-auth). Set
      ingress.annotations, or use `kubectl port-forward` instead.
    EOT
  }
}

variable "network_policy_allow_pod_labels" {
  description = "Pod labels allowed to reach the bridge. Empty means deny-all; use kubectl port-forward."
  type        = map(string)
  default     = {}
}

# -----------------------------------------------------------------------------
# Continuous design verification
# -----------------------------------------------------------------------------
variable "verify" {
  description = <<-EOT
    Scheduled design-drift checks. Each target renders a URL you already serve
    and diffs it against the Figma node it was built from; the Job fails when
    they have drifted. Requires a Figma token.
  EOT
  type = object({
    enabled  = optional(bool, false)
    schedule = optional(string, "0 * * * *")
    file_key = optional(string, "")
    targets = optional(list(object({
      name     = string
      url      = string
      node     = string
      selector = optional(string)
      wait_ms  = optional(number)
    })), [])
  })
  default = {}

  validation {
    condition     = !try(var.verify.enabled, false) || length(try(var.verify.targets, [])) > 0
    error_message = "verify.targets must list at least one target when verify.enabled is true."
  }
}

variable "persistence" {
  description = "Persist /data across restarts. Everything there is a regenerable cache, so this is optional."
  type = object({
    enabled       = optional(bool, false)
    size          = optional(string, "5Gi")
    storage_class = optional(string, "")
  })
  default = {}
}

variable "resources" {
  description = "Bridge container resources."
  type = object({
    cpu_request    = optional(string, "50m")
    memory_request = optional(string, "128Mi")
    memory_limit   = optional(string, "512Mi")
  })
  default = {}
}

variable "extra_values" {
  description = "Escape hatch: raw chart values merged last, as YAML."
  type        = string
  default     = ""
}

variable "common_labels" {
  description = "Labels applied to every object the chart renders."
  type        = map(string)
  default     = {}
}

variable "atomic" {
  description = "Roll the release back automatically if it fails to become ready."
  type        = bool
  default     = true
}

variable "timeout_seconds" {
  description = "How long to wait for the release to become ready."
  type        = number
  default     = 300
}
