variable "environment" {
  type = string
}

variable "location" {
  type = string
}

variable "network_id" {
  type = number
}

# Database is managed by CloudNativePG operator (installed in bootstrap module).
# PostgreSQL cluster is created via kubectl_manifest in bootstrap.

output "connection_note" {
  value = "Database is managed by CloudNativePG operator in the cluster. Connection string is available as a K8s secret: ranch-db-app in the platform namespace."
}
