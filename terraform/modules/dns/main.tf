variable "domain" {
  type = string
}

variable "environment" {
  type = string
}

variable "load_balancer_ip" {
  type = string
}

# DNS records are managed manually (Variant 2).
# After `terraform apply`, add these A records at your DNS provider:

output "dns_records_needed" {
  value = {
    "api.${var.domain}"    = var.load_balancer_ip
    "app.${var.domain}"    = var.load_balancer_ip
    "admin.${var.domain}"  = var.load_balancer_ip
    "argocd.${var.domain}" = var.load_balancer_ip
  }
}
