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
