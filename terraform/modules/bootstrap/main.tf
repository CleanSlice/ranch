terraform {
  required_providers {
    helm = {
      source = "hashicorp/helm"
    }
    kubectl = {
      source = "gavinbunney/kubectl"
    }
  }
}

variable "domain" {
  type = string
}

variable "environment" {
  type = string
}

resource "helm_release" "argocd" {
  name             = "argocd"
  repository       = "https://argoproj.github.io/argo-helm"
  chart            = "argo-cd"
  version          = "7.7.5"
  namespace        = "argocd"
  create_namespace = true

  values = [
    yamlencode({
      server = {
        ingress = {
          enabled    = true
          ingressClassName = "traefik"
          hosts      = ["argocd.${var.domain}"]
          tls = [{
            secretName = "argocd-tls"
            hosts      = ["argocd.${var.domain}"]
          }]
        }
      }
    })
  ]
}

resource "helm_release" "argo_workflows" {
  name             = "argo-workflows"
  repository       = "https://argoproj.github.io/argo-helm"
  chart            = "argo-workflows"
  version          = "0.41.1"
  namespace        = "argo"
  create_namespace = true

  values = [
    yamlencode({
      server = {
        ingress = {
          enabled = false
        }
      }
    })
  ]
}

resource "helm_release" "cnpg" {
  name             = "cnpg"
  repository       = "https://cloudnative-pg.github.io/charts"
  chart            = "cloudnative-pg"
  namespace        = "cnpg-system"
  create_namespace = true
}

resource "kubectl_manifest" "pg_cluster" {
  depends_on = [helm_release.cnpg]

  yaml_body = <<-YAML
    apiVersion: postgresql.cnpg.io/v1
    kind: Cluster
    metadata:
      name: ranch-db
      namespace: platform
    spec:
      instances: 2
      storage:
        size: 20Gi
        storageClass: hcloud-volumes
      postgresql:
        parameters:
          max_connections: "200"
  YAML
}

resource "kubectl_manifest" "agents_namespace" {
  yaml_body = <<-YAML
    apiVersion: v1
    kind: Namespace
    metadata:
      name: agents
      labels:
        app.kubernetes.io/part-of: ranch
  YAML
}

resource "kubectl_manifest" "platform_namespace" {
  yaml_body = <<-YAML
    apiVersion: v1
    kind: Namespace
    metadata:
      name: platform
      labels:
        app.kubernetes.io/part-of: ranch
  YAML
}

output "argocd_url" {
  value = "https://argocd.${var.domain}"
}
