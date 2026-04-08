terraform {
  backend "s3" {
    bucket   = "ranch-tfstate"
    key      = "prod/terraform.tfstate"
    endpoint = "https://fsn1.your-objectstorage.com"
    region   = "main"

    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    force_path_style            = true
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
  source              = "../../modules/cluster"
  environment         = var.environment
  location            = var.location
  hcloud_token        = var.hcloud_token
  ssh_public_key_path = var.ssh_public_key_path
  network_id          = module.network.network_id
  firewall_id         = module.network.firewall_id
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
