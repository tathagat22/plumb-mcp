# Terraform is here for the teams that already manage their cluster this way —
# it installs the Helm chart and, optionally, the Secret holding the Figma
# token, so Plumb lands in the same plan and state as everything else they run.
#
# It deliberately does NOT provision a cluster. Plumb is an application; which
# cloud, VPC, and node pool it lands on is your decision, not this module's.
terraform {
  required_version = ">= 1.5.0"

  required_providers {
    helm = {
      source  = "hashicorp/helm"
      version = ">= 2.12, < 4.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = ">= 2.25, < 3.0"
    }
  }
}
