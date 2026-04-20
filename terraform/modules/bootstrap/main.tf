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

variable "letsencrypt_email" {
  type    = string
  default = "dmitriyzhuk@gmail.com"
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

# ArgoCD (GitOps controller)
resource "helm_release" "argocd" {
  name             = "argocd"
  repository       = "https://argoproj.github.io/argo-helm"
  chart            = "argo-cd"
  version          = "9.4.17"
  namespace        = "argocd"
  create_namespace = true

  values = [
    yamlencode({
      server = {
        ingress = {
          enabled          = true
          ingressClassName = "traefik"
          hostname         = "argocd.${var.domain}"
          tls              = true
          annotations = {
            "cert-manager.io/cluster-issuer" = "letsencrypt-prod"
          }
        }
      }
      # Traefik terminates TLS; tell argocd-server not to do TLS itself.
      configs = {
        params = {
          "server.insecure" = true
        }
      }
    })
  ]
}

# Argo Workflows (agent pods orchestrator)
resource "helm_release" "argo_workflows" {
  name             = "argo-workflows"
  repository       = "https://argoproj.github.io/argo-helm"
  chart            = "argo-workflows"
  version          = "1.0.7"
  namespace        = "argo"
  create_namespace = true

  values = [
    yamlencode({
      server = {
        secure = false
        extraArgs = [
          "--auth-mode=server",
        ]
        ingress = {
          enabled = false
        }
      }
    })
  ]
}

# CloudNativePG operator (kept installed but no Cluster CR — we use external Postgres)
resource "helm_release" "cnpg" {
  name             = "cnpg"
  repository       = "https://cloudnative-pg.github.io/charts"
  chart            = "cloudnative-pg"
  version          = "0.28.0"
  namespace        = "cnpg-system"
  create_namespace = true
}

# Let's Encrypt ClusterIssuer (cert-manager ships in the kube-hetzner module)
resource "kubectl_manifest" "letsencrypt_cluster_issuer" {
  yaml_body = <<-YAML
    apiVersion: cert-manager.io/v1
    kind: ClusterIssuer
    metadata:
      name: letsencrypt-prod
    spec:
      acme:
        server: https://acme-v02.api.letsencrypt.org/directory
        email: ${var.letsencrypt_email}
        privateKeySecretRef:
          name: letsencrypt-prod
        solvers:
          - http01:
              ingress:
                class: traefik
  YAML
}

output "argocd_url" {
  value = "https://argocd.${var.domain}"
}
