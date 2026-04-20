terraform {
  required_version = ">= 1.5.0"

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.45"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.12"
    }
    kubectl = {
      source  = "gavinbunney/kubectl"
      version = "~> 1.14"
    }
  }

  backend "local" {
    path = "terraform.tfstate"
  }
}

provider "hcloud" {
  token = var.hcloud_token
}

module "network" {
  source      = "../../modules/network"
  environment = var.environment
  location    = var.location
  admin_ip    = var.admin_ip
}

module "cluster" {
  source               = "../../modules/cluster"
  environment          = var.environment
  location             = var.location
  hcloud_token         = var.hcloud_token
  ssh_public_key_path  = var.ssh_public_key_path
  ssh_private_key_path = var.ssh_private_key_path
  network_id           = module.network.network_id
  firewall_id          = module.network.firewall_id

  providers = {
    hcloud = hcloud
  }
}

provider "helm" {
  kubernetes {
    config_path = module.cluster.kubeconfig
  }
}

provider "kubectl" {
  config_path = module.cluster.kubeconfig
}

module "bootstrap" {
  source      = "../../modules/bootstrap"
  domain      = var.domain
  environment = var.environment

  depends_on = [module.cluster]
}

module "dns" {
  source           = "../../modules/dns"
  domain           = var.domain
  environment      = var.environment
  load_balancer_ip = module.cluster.load_balancer_ip
}

output "kubeconfig" {
  value     = module.cluster.kubeconfig
  sensitive = true
}

output "argocd_url" {
  value = module.bootstrap.argocd_url
}

output "dns_records" {
  value = module.dns.dns_records_needed
}
