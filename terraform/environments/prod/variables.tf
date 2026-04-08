variable "hcloud_token" {
  type      = string
  sensitive = true
}

variable "environment" {
  type    = string
  default = "prod"
}

variable "location" {
  type    = string
  default = "fsn1"
}

variable "domain" {
  type = string
}

variable "admin_ip" {
  type = string
}

variable "ssh_public_key_path" {
  type    = string
  default = "~/.ssh/id_ed25519.pub"
}
