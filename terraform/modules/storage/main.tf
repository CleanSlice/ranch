terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

variable "environment" {
  type        = string
  description = "Environment name - used as suffix on bucket + IAM user (e.g. dreamvention)"
}

variable "bucket_name" {
  type        = string
  default     = ""
  description = "Override full bucket name. Defaults to ranch-agent-data-<environment>."
}

variable "create_iam_user" {
  type        = bool
  default     = true
  description = "Create an IAM user + access key scoped to this bucket. Disable if agents authenticate via IRSA or another mechanism."
}

variable "secret_name_prefix" {
  type        = string
  default     = "ranch-agent/"
  description = "Secrets Manager name prefix the agent IAM user can create/read. Each agent has one secret at ranch-agent/agent-<id>."
}

locals {
  bucket_name        = var.bucket_name != "" ? var.bucket_name : "ranch-agent-data-${var.environment}"
  reins_bucket_name  = "ranch-reins-sources-${var.environment}"
  iam_user           = "ranch-agent-${var.environment}"
}

# ---------------------------------------------------------------------
# S3 bucket for agent data (workflow artifacts, logs, etc.)
# ---------------------------------------------------------------------

resource "aws_s3_bucket" "agent_data" {
  bucket = local.bucket_name
}

resource "aws_s3_bucket_versioning" "agent_data" {
  bucket = aws_s3_bucket.agent_data.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "agent_data" {
  bucket = aws_s3_bucket.agent_data.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "agent_data" {
  bucket = aws_s3_bucket.agent_data.id

  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}

# ---------------------------------------------------------------------
# S3 bucket for Reins / Knowledge source files (PDFs, docs, archives
# uploaded by operators via the knowledge admin UI). ranch-api stores
# files here under <knowledgeId>/<uuid>-<filename>; LightRAG ingests
# them through ranch-api which fetches the bytes back from S3.
# ---------------------------------------------------------------------

resource "aws_s3_bucket" "reins_sources" {
  bucket = local.reins_bucket_name
}

resource "aws_s3_bucket_versioning" "reins_sources" {
  bucket = aws_s3_bucket.reins_sources.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "reins_sources" {
  bucket = aws_s3_bucket.reins_sources.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "reins_sources" {
  bucket = aws_s3_bucket.reins_sources.id

  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}

# ---------------------------------------------------------------------
# Postgres backups bucket retired.
#
# The original lightrag-postgres lived on CloudNativePG with
# barmanObjectStore writing to ranch-pg-backups-<env>. We migrated to a
# plain Postgres Deployment that does not back up; the bucket is now
# unused. The `removed` block instructs terraform to drop these
# resources from state without deleting the AWS bucket itself, so any
# residual backup archive stays around for manual cleanup.
# Requires terraform >= 1.7. On older versions, replace with
# `terraform state rm` before deleting the resource blocks.
# ---------------------------------------------------------------------

removed {
  from = aws_s3_bucket.pg_backups
  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_s3_bucket_versioning.pg_backups
  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_s3_bucket_server_side_encryption_configuration.pg_backups
  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_s3_bucket_public_access_block.pg_backups
  lifecycle {
    destroy = false
  }
}

# ---------------------------------------------------------------------
# IAM user scoped to this bucket (optional)
# ---------------------------------------------------------------------

resource "aws_iam_user" "agent" {
  count = var.create_iam_user ? 1 : 0
  name  = local.iam_user
}

data "aws_iam_policy_document" "agent_bucket_access" {
  count = var.create_iam_user ? 1 : 0

  statement {
    sid     = "BucketLevel"
    actions = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [aws_s3_bucket.agent_data.arn]
  }

  statement {
    sid = "ObjectLevel"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:AbortMultipartUpload",
      "s3:ListMultipartUploadParts",
    ]
    resources = ["${aws_s3_bucket.agent_data.arn}/*"]
  }

  statement {
    sid = "SecretsManagerScoped"
    actions = [
      "secretsmanager:CreateSecret",
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
      "secretsmanager:PutSecretValue",
      "secretsmanager:UpdateSecret",
      "secretsmanager:TagResource",
    ]
    resources = ["arn:aws:secretsmanager:*:*:secret:${var.secret_name_prefix}*"]
  }

  statement {
    sid       = "ReinsSourcesBucketLevel"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [aws_s3_bucket.reins_sources.arn]
  }

  statement {
    sid = "ReinsSourcesObjectLevel"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:AbortMultipartUpload",
      "s3:ListMultipartUploadParts",
    ]
    resources = ["${aws_s3_bucket.reins_sources.arn}/*"]
  }
}

resource "aws_iam_user_policy" "agent_bucket_access" {
  count  = var.create_iam_user ? 1 : 0
  name   = "ranch-agent-data-access"
  user   = aws_iam_user.agent[0].name
  policy = data.aws_iam_policy_document.agent_bucket_access[0].json
}

resource "aws_iam_access_key" "agent" {
  count = var.create_iam_user ? 1 : 0
  user  = aws_iam_user.agent[0].name
}

# ---------------------------------------------------------------------
# Outputs
# ---------------------------------------------------------------------

output "bucket_name" {
  value = aws_s3_bucket.agent_data.id
}

output "bucket_arn" {
  value = aws_s3_bucket.agent_data.arn
}

output "bucket_region" {
  value = aws_s3_bucket.agent_data.region
}

output "access_key_id" {
  value     = try(aws_iam_access_key.agent[0].id, null)
  sensitive = true
}

output "secret_access_key" {
  value     = try(aws_iam_access_key.agent[0].secret, null)
  sensitive = true
}

output "reins_sources_bucket_name" {
  value = aws_s3_bucket.reins_sources.id
}

output "reins_sources_bucket_region" {
  value = aws_s3_bucket.reins_sources.region
}
