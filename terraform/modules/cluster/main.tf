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

  # 1 CP node (runs system + control plane) + 1 agent node (runs ranch agents)
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

  agent_nodepools = [
    {
      name        = "agent"
      server_type = "cx43"
      location    = var.location
      labels      = ["node-role=agents"]
      taints      = ["workload=agent:NoSchedule"]
      count       = 1
    }
  ]

  load_balancer_type     = "lb11"
  load_balancer_location = var.location

  # Allow outbound Postgres so pods can reach external DB (Neon, Supabase, etc.)
  extra_firewall_rules = [
    {
      description     = "Postgres (Neon / external)"
      direction       = "out"
      protocol        = "tcp"
      port            = "5432"
      source_ips      = []
      destination_ips = ["0.0.0.0/0", "::/0"]
    }
  ]
}

# ---------------------------------------------------------------------
# Load Balancer listeners
#
# kube-hetzner creates the LB (k3s-traefik) when agent_nodepools is non-empty,
# but does NOT create the port listeners. hcloud-cloud-controller-manager is
# supposed to add them from traefik Service annotations, but it skips LBs that
# carry the `provisioner=terraform` label, so we manage the listeners here.
#
# Destination ports = traefik Service NodePorts. These are k8s-assigned and
# not guaranteed stable across helm reinstalls — if traefik is recreated and
# gets new NodePorts, update these values to match `kubectl get svc -n traefik
# traefik`.
# ---------------------------------------------------------------------

data "hcloud_load_balancer" "traefik" {
  name       = "k3s-traefik"
  depends_on = [module.kube-hetzner]
}

resource "hcloud_load_balancer_service" "traefik_http" {
  load_balancer_id = data.hcloud_load_balancer.traefik.id
  protocol         = "tcp"
  listen_port      = 80
  destination_port = 30376
  proxyprotocol    = true

  health_check {
    protocol = "tcp"
    port     = 30376
    interval = 15
    timeout  = 10
    retries  = 3
  }
}

resource "hcloud_load_balancer_service" "traefik_https" {
  load_balancer_id = data.hcloud_load_balancer.traefik.id
  protocol         = "tcp"
  listen_port      = 443
  destination_port = 31019
  proxyprotocol    = true

  health_check {
    protocol = "tcp"
    port     = 31019
    interval = 15
    timeout  = 10
    retries  = 3
  }
}

output "kubeconfig" {
  value     = module.kube-hetzner.kubeconfig
  sensitive = true
}

output "load_balancer_ip" {
  value = data.hcloud_load_balancer.traefik.ipv4
}
