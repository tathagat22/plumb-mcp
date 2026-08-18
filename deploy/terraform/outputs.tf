output "namespace" {
  description = "Namespace Plumb was installed into."
  value       = var.namespace
}

output "release_name" {
  description = "Helm release name."
  value       = helm_release.plumb.name
}

output "chart_version" {
  description = "Chart version that was installed."
  value       = helm_release.plumb.version
}

output "app_version" {
  description = "plumb-mcp version behind the installed chart."
  value       = helm_release.plumb.metadata[0].app_version
}

output "service_name" {
  description = "In-cluster Service name for the bridge."
  value       = var.release_name
}

output "port_forward_command" {
  description = <<-EOT
    How to reach Studio, and the only way the Figma plugin can pair with an
    in-cluster bridge — the plugin scans 127.0.0.1:31337-31346, so the local
    port has to stay 31337.
  EOT
  value       = "kubectl -n ${var.namespace} port-forward svc/${var.release_name} 31337:31337"
}

output "studio_url" {
  description = "Where Studio is published, if an ingress was created."
  value = try(var.ingress.enabled, false) ? format(
    "%s://%s",
    try(var.ingress.tls_secret, "") == "" ? "http" : "https",
    var.ingress.host,
  ) : null
}

output "verify_targets" {
  description = "Screens under continuous design verification."
  value       = [for t in local.verify_targets : t.name]
}
