terraform {
  required_providers {
    kubectl = {
      source = "gavinbunney/kubectl"
    }
  }
}

variable "domain" {
  type        = string
  description = "Root hostname (e.g. ranch.cleanslice.org). app = {domain}, admin = admin.{domain}, api = api.{domain}"
}

variable "api_image" {
  type    = string
  default = "ghcr.io/cleanslice/ranch-api:latest"
}

variable "admin_image" {
  type    = string
  default = "ghcr.io/cleanslice/ranch-admin:latest"
}

variable "app_image" {
  type    = string
  default = "ghcr.io/cleanslice/ranch-app:latest"
}

variable "letsencrypt_issuer" {
  type    = string
  default = "letsencrypt-prod"
}

variable "database_url" {
  type      = string
  sensitive = true
}

variable "jwt_secret" {
  type      = string
  sensitive = true
}

variable "bridle_api_key" {
  type      = string
  sensitive = true
}

variable "ghcr_username" {
  type = string
}

variable "ghcr_pat" {
  type      = string
  sensitive = true
}

locals {
  api_host   = "api.${var.domain}"
  admin_host = "admin.${var.domain}"
  app_host   = var.domain
  cors_origin = join(",", [
    "https://${local.app_host}",
    "https://${local.admin_host}",
  ])

  dockerconfigjson = base64encode(jsonencode({
    auths = {
      "ghcr.io" = {
        username = var.ghcr_username
        password = var.ghcr_pat
        email    = "${var.ghcr_username}@users.noreply.github.com"
        auth     = base64encode("${var.ghcr_username}:${var.ghcr_pat}")
      }
    }
  }))
}

# ---------------------------------------------------------------------
# Secrets
# ---------------------------------------------------------------------

resource "kubectl_manifest" "ghcr_pull_secret" {
  yaml_body = <<-YAML
    apiVersion: v1
    kind: Secret
    metadata:
      name: ghcr
      namespace: platform
    type: kubernetes.io/dockerconfigjson
    data:
      .dockerconfigjson: ${local.dockerconfigjson}
  YAML
}

resource "kubectl_manifest" "ghcr_pull_secret_agents" {
  yaml_body = <<-YAML
    apiVersion: v1
    kind: Secret
    metadata:
      name: ghcr
      namespace: agents
    type: kubernetes.io/dockerconfigjson
    data:
      .dockerconfigjson: ${local.dockerconfigjson}
  YAML
}

resource "kubectl_manifest" "ranch_secrets" {
  yaml_body = <<-YAML
    apiVersion: v1
    kind: Secret
    metadata:
      name: ranch-secrets
      namespace: platform
    type: Opaque
    data:
      JWT_SECRET: ${base64encode(var.jwt_secret)}
      BRIDLE_API_KEY: ${base64encode(var.bridle_api_key)}
  YAML
}

resource "kubectl_manifest" "ranch_external_db" {
  yaml_body = <<-YAML
    apiVersion: v1
    kind: Secret
    metadata:
      name: ranch-external-db
      namespace: platform
    type: Opaque
    data:
      uri: ${base64encode(var.database_url)}
  YAML
}

# ---------------------------------------------------------------------
# Agents namespace: ServiceAccount + Role + RoleBinding for workflows
# ---------------------------------------------------------------------

resource "kubectl_manifest" "workflow_sa" {
  yaml_body = <<-YAML
    apiVersion: v1
    kind: ServiceAccount
    metadata:
      name: workflow
      namespace: agents
  YAML
}

resource "kubectl_manifest" "workflow_role" {
  yaml_body = <<-YAML
    apiVersion: rbac.authorization.k8s.io/v1
    kind: Role
    metadata:
      name: workflow
      namespace: agents
    rules:
      - apiGroups: [""]
        resources: ["pods", "pods/log"]
        verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
      - apiGroups: [""]
        resources: ["configmaps"]
        verbs: ["get", "list", "watch"]
      - apiGroups: ["argoproj.io"]
        resources:
          - workflows
          - workflows/finalizers
          - workflowtasksets
          - workflowtasksets/finalizers
          - workflowtaskresults
          - workflowtemplates
        verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  YAML
}

resource "kubectl_manifest" "workflow_rolebinding" {
  depends_on = [kubectl_manifest.workflow_sa, kubectl_manifest.workflow_role]
  yaml_body  = <<-YAML
    apiVersion: rbac.authorization.k8s.io/v1
    kind: RoleBinding
    metadata:
      name: workflow
      namespace: agents
    subjects:
      - kind: ServiceAccount
        name: workflow
        namespace: agents
    roleRef:
      kind: Role
      name: workflow
      apiGroup: rbac.authorization.k8s.io
  YAML
}

# ---------------------------------------------------------------------
# WorkflowTemplate that spawns each agent pod
# ---------------------------------------------------------------------

resource "kubectl_manifest" "agent_deployment_workflow" {
  depends_on        = [kubectl_manifest.workflow_sa]
  server_side_apply = true
  force_conflicts   = true
  yaml_body         = templatefile("${path.module}/templates/agent-deployment.yaml.tftpl", {})
}

# ---------------------------------------------------------------------
# ranch-api: Deployment + Service + Ingress
# ---------------------------------------------------------------------

resource "kubectl_manifest" "ranch_api_deployment" {
  depends_on = [
    kubectl_manifest.ghcr_pull_secret,
    kubectl_manifest.ranch_secrets,
    kubectl_manifest.ranch_external_db,
  ]
  yaml_body = templatefile("${path.module}/templates/ranch-api-deployment.yaml.tftpl", {
    image       = var.api_image
    cors_origin = local.cors_origin
  })
}

resource "kubectl_manifest" "ranch_api_service" {
  yaml_body = <<-YAML
    apiVersion: v1
    kind: Service
    metadata:
      name: ranch-api
      namespace: platform
    spec:
      selector:
        app: ranch-api
      ports:
        - name: http
          port: 80
          targetPort: 3333
  YAML
}

resource "kubectl_manifest" "ranch_api_ingress" {
  yaml_body = templatefile("${path.module}/templates/ranch-api-ingress.yaml.tftpl", {
    host   = local.api_host
    issuer = var.letsencrypt_issuer
  })
}

# ---------------------------------------------------------------------
# ranch-admin: Deployment + Service + Ingress
# ---------------------------------------------------------------------

resource "kubectl_manifest" "ranch_admin_deployment" {
  depends_on = [kubectl_manifest.ghcr_pull_secret]
  yaml_body = templatefile("${path.module}/templates/ranch-admin-deployment.yaml.tftpl", {
    image   = var.admin_image
    api_url = "https://${local.api_host}"
  })
}

resource "kubectl_manifest" "ranch_admin_service" {
  yaml_body = <<-YAML
    apiVersion: v1
    kind: Service
    metadata:
      name: ranch-admin
      namespace: platform
    spec:
      selector:
        app: ranch-admin
      ports:
        - name: http
          port: 80
          targetPort: 3002
  YAML
}

resource "kubectl_manifest" "ranch_admin_ingress" {
  yaml_body = templatefile("${path.module}/templates/ranch-admin-ingress.yaml.tftpl", {
    host   = local.admin_host
    issuer = var.letsencrypt_issuer
  })
}

# ---------------------------------------------------------------------
# ranch-app: Deployment + Service + Ingress
# ---------------------------------------------------------------------

resource "kubectl_manifest" "ranch_app_deployment" {
  depends_on       = [kubectl_manifest.ghcr_pull_secret]
  wait_for_rollout = false
  yaml_body = templatefile("${path.module}/templates/ranch-app-deployment.yaml.tftpl", {
    image   = var.app_image
    api_url = "https://${local.api_host}"
  })
}

resource "kubectl_manifest" "ranch_app_service" {
  yaml_body = <<-YAML
    apiVersion: v1
    kind: Service
    metadata:
      name: ranch-app
      namespace: platform
    spec:
      selector:
        app: ranch-app
      ports:
        - name: http
          port: 80
          targetPort: 3002
  YAML
}

resource "kubectl_manifest" "ranch_app_ingress" {
  yaml_body = templatefile("${path.module}/templates/ranch-app-ingress.yaml.tftpl", {
    host   = local.app_host
    issuer = var.letsencrypt_issuer
  })
}

output "app_url" {
  value = "https://${local.app_host}"
}

output "admin_url" {
  value = "https://${local.admin_host}"
}

output "api_url" {
  value = "https://${local.api_host}"
}
