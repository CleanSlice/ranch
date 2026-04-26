variable "hcloud_token" {
  type      = string
  sensitive = true
}

variable "environment" {
  type    = string
  default = "dreamvention"
}

variable "location" {
  type    = string
  default = "nbg1"
}

variable "aws_region" {
  type        = string
  default     = "us-east-1"
  description = "AWS region for S3 bucket and other AWS resources (matches backend bucket)"
}

variable "domain" {
  type = string
}

variable "admin_ip" {
  type = string
}

variable "ssh_public_key_path" {
  type    = string
  default = "~/.ssh/ranch-hetzner.pub"
}

variable "ssh_private_key_path" {
  type    = string
  default = "~/.ssh/ranch-hetzner"
}

# ---------------------------------------------------------------------
# Apps module inputs (ranch-api / ranch-admin + agent workflow)
# ---------------------------------------------------------------------

variable "api_image" {
  type    = string
  default = "ghcr.io/cleanslice/ranch-api:latest"
}

variable "admin_image" {
  type    = string
  default = "ghcr.io/cleanslice/ranch-admin:latest"
}

variable "app_image" {
  type    = string
  default = "ghcr.io/cleanslice/ranch-app:latest"
}

variable "database_url" {
  type        = string
  sensitive   = true
  description = "Full Postgres URI (e.g. Neon) — prefer TF_VAR_database_url over tfvars"
}

variable "jwt_secret" {
  type      = string
  sensitive = true
}

variable "bridle_api_key" {
  type      = string
  sensitive = true
}

variable "ghcr_username" {
  type    = string
  default = "dmitriyzhuk"
}

variable "ghcr_pat" {
  type        = string
  sensitive   = true
  description = "GitHub PAT with read:packages for pulling private images"
}
