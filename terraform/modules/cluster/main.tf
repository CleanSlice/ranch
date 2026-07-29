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

# Elastic agent capacity (cluster-autoscaler). Base = 1 static agent node
# (see agent_nodepools); the autoscaler adds 0..agent_autoscaler_max extra
# cx43 nodes on demand. Each cx43 fits roughly ~28 agents at the 512Mi memory
# request, so max=3 ≈ up to ~110 agents total. Raise agent_autoscaler_max to
# grow the ceiling (mind the Hetzner project server limit).
variable "agent_autoscaler_min" {
  type    = number
  default = 0
}

variable "agent_autoscaler_max" {
  type    = number
  default = 3
}

module "kube-hetzner" {
  source = "kube-hetzner/kube-hetzner/hcloud"
  # Pinned: the source was UNPINNED, so `terraform init` resolved to the latest
  # (3.0.1), which requires Terraform >= 1.10.1 and helm provider >= 3.1.1 —
  # incompatible with this repo's TF 1.9.8 pin and `helm ~> 2.12`, so init/plan
  # failed. 2.21.0 is the last 2.x, built for TF 1.9 + helm 2.x, and supports
  # autoscaler_nodepools with per-pool labels/taints. Bump deliberately (and
  # raise the provider/TF constraints together) when moving to 3.x.
  version = "2.21.0"

  providers = {
    hcloud = hcloud
  }

  hcloud_token = var.hcloud_token

  ssh_public_key  = file(var.ssh_public_key_path)
  ssh_private_key = file(var.ssh_private_key_path)

  network_region = "eu-central"

  # Don't let the in-cluster system-upgrade-controller auto-upgrade k3s/OS.
  # Those upgrades cordon+drain a node and briefly bounce the API server; when
  # they fire during a terraform apply the run can be interrupted mid-upgrade
  # and leave a node cordoned (as happened on the first rollouts). Pin them so
  # node upgrades are a deliberate, supervised action instead.
  automatically_upgrade_k3s = false
  automatically_upgrade_os  = false

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

  # Elastic burst capacity for agents. The static "agent" pool above is the
  # always-on warm base (count=1); cluster-autoscaler adds up to var.agent_max
  # extra nodes when agent pods go Pending ("Insufficient memory/cpu") and
  # removes them once idle. Same label+taint as the static pool so agent pods —
  # which set nodeSelector node-role=agents and tolerate workload=agent:NoSchedule
  # (see api agent-workflow.manifest.ts) — schedule onto autoscaled nodes too.
  #
  # NOTE: autoscaler_nodepools uses a DIFFERENT labels/taints shape than the
  # static pools above — labels is a map, taints a list of {key,value,effect}.
  autoscaler_nodepools = [
    {
      name        = "agent-as"
      server_type = "cx43"
      location    = var.location
      min_nodes   = var.agent_autoscaler_min
      max_nodes   = var.agent_autoscaler_max
      labels = {
        "node-role" = "agents"
      }
      taints = [
        {
          key    = "workload"
          value  = "agent"
          effect = "NoSchedule"
        }
      ]
    }
  ]

  # --ignore-daemonsets-utilization: don't let per-node DaemonSets (kube-proxy,
  #   CNI, metrics) keep a node "utilized" and block scale-down.
  # --enforce-node-group-min-size: reconcile a pool back up to min_nodes if it
  #   ever drifts below.
  cluster_autoscaler_extra_args = [
    "--ignore-daemonsets-utilization=true",
    "--enforce-node-group-min-size=true",
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

# NOTE: no depends_on here. A depends_on on a data source forces it to be
# re-read on every apply where the referenced module changes, which makes its
# `id` "known after apply" and cascades into a forced REPLACE of the
# hcloud_load_balancer_service listeners below — i.e. a brief 80/443 outage on
# every run. The LB already exists (kube-hetzner created it), so we read it
# directly. On a from-scratch bootstrap where the LB doesn't exist yet, run
# apply twice (cluster first, then listeners) — the kube-hetzner default flow.
data "hcloud_load_balancer" "traefik" {
  name = "k3s-traefik"
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
