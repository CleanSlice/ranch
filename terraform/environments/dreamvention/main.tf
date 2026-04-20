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
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "ranch-terraform-state"
    key            = "dreamvention/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "ranch-terraform-locks"
    encrypt        = true
  }
}

provider "hcloud" {
  token = var.hcloud_token
}

provider "aws" {
  region = var.aws_region
}

module "storage" {
  source      = "../../modules/storage"
  environment = var.environment
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

# kube-hetzner writes kubeconfig to k3s_kubeconfig.yaml in the env directory on apply.
# Both providers point at the file path (the module output is content, not a path).
locals {
  kubeconfig_path = "${path.module}/k3s_kubeconfig.yaml"
}

provider "helm" {
  kubernetes {
    config_path = local.kubeconfig_path
  }
}

provider "kubectl" {
  config_path      = local.kubeconfig_path
  load_config_file = true
}

module "bootstrap" {
  source      = "../../modules/bootstrap"
  domain      = var.domain
  environment = var.environment

  depends_on = [module.cluster]
}

module "apps" {
  source = "../../modules/apps"
  domain = var.domain

  api_image   = var.api_image
  admin_image = var.admin_image
  app_image   = var.app_image

  database_url   = var.database_url
  jwt_secret     = var.jwt_secret
  bridle_api_key = var.bridle_api_key
  ghcr_username  = var.ghcr_username
  ghcr_pat       = var.ghcr_pat

  depends_on = [module.bootstrap]
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

output "agent_data_bucket" {
  value = module.storage.bucket_name
}

output "agent_data_region" {
  value = module.storage.bucket_region
}

output "agent_data_access_key_id" {
  value     = module.storage.access_key_id
  sensitive = true
}

output "agent_data_secret_access_key" {
  value     = module.storage.secret_access_key
  sensitive = true
}
