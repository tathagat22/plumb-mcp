# The smallest useful install: a locked-down bridge you reach with
# `kubectl port-forward`. No token, no ingress, nothing reachable from the
# cluster network.
#
#   terraform init && terraform apply
#   kubectl -n plumb port-forward svc/plumb 31337:31337
#   open http://127.0.0.1:31337/

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    # Pinned to a major here, unlike the module's wider range: the provider
    # *configuration* syntax changed in v3 (`kubernetes` went from a nested
    # block to an attribute), while `helm_release` itself is compatible with
    # both. A caller on v2 keeps the `kubernetes { ... }` block form below.
    helm = {
      source  = "hashicorp/helm"
      version = "~> 3.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = ">= 2.25, < 3.0"
    }
  }
}

provider "kubernetes" {
  config_path = pathexpand(var.kubeconfig)
}

provider "helm" {
  kubernetes = {
    config_path = pathexpand(var.kubeconfig)
  }
}

variable "kubeconfig" {
  description = "Path to the kubeconfig for the target cluster."
  type        = string
  default     = "~/.kube/config"
}

module "plumb" {
  source = "../.."

  namespace  = "plumb"
  chart_path = "${path.module}/../../../helm/plumb"
}

output "next_step" {
  value = module.plumb.port_forward_command
}
