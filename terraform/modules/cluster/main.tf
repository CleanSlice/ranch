terraform {
  required_providers {
    hcloud = {
      source = "hetznercloud/hcloud"
    }
  }
}

variable "environment" {
  type = string
}

variable "location" {
  type = string
}

variable "hcloud_token" {
  type      = string
  sensitive = true
}

variable "ssh_public_key_path" {
  type = string
}

variable "ssh_private_key_path" {
  type = string
}

variable "network_id" {
  type = number
}

variable "firewall_id" {
  type = number
}

module "kube-hetzner" {
  source = "kube-hetzner/kube-hetzner/hcloud"

  providers = {
    hcloud = hcloud
  }

  hcloud_token = var.hcloud_token

  ssh_public_key  = file(var.ssh_public_key_path)
  ssh_private_key = file(var.ssh_private_key_path)

  network_region = "eu-central"

  # Use existing x86 snapshot, skip ARM
  microos_x86_snapshot_id = "374341457"
  microos_arm_snapshot_id = "374341457"

  # Minimal setup: 1 CP node (also runs workloads)
  # Scale up later: 3 CP + 2 system + 1 agent
  control_plane_nodepools = [
    {
      name        = "cp"
      server_type = "cx33"
      location    = var.location
      labels      = []
      taints      = []
      count       = 1
    }
  ]

  agent_nodepools = []

  load_balancer_type     = "lb11"
  load_balancer_location = var.location
}

output "kubeconfig" {
  value     = module.kube-hetzner.kubeconfig
  sensitive = true
}

output "load_balancer_ip" {
  value = module.kube-hetzner.ingress_public_ipv4
}
