terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Bootstrap state lives locally — you can't store the backend's own state
  # in the bucket it is creating (chicken/egg). Keep terraform.tfstate in
  # this directory under version-control ignore.
  backend "local" {
    path = "terraform.tfstate"
  }
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "bucket_name" {
  type    = string
  default = "ranch-terraform-state"
}

variable "lock_table_name" {
  type    = string
  default = "ranch-terraform-locks"
}

provider "aws" {
  region = var.region
}

# S3 Bucket for Terraform State
resource "aws_s3_bucket" "terraform_state" {
  bucket = var.bucket_name

  # Prevent accidental destroy — state loss = cluster loss of management.
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}

# DynamoDB Table for State Locking
resource "aws_dynamodb_table" "terraform_locks" {
  name         = var.lock_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}

output "terraform_state_bucket" {
  value       = aws_s3_bucket.terraform_state.id
  description = "S3 Bucket for Terraform State"
}

output "dynamodb_lock_table" {
  value       = aws_dynamodb_table.terraform_locks.name
  description = "DynamoDB Table for Terraform State Locking"
}

output "backend_config_snippet" {
  description = "Paste this into the terraform block of each environment's main.tf"
  value       = <<-EOT
    backend "s3" {
      bucket         = "${aws_s3_bucket.terraform_state.id}"
      key            = "<env-name>/terraform.tfstate"  # e.g. dreamvention/terraform.tfstate
      region         = "${var.region}"
      dynamodb_table = "${aws_dynamodb_table.terraform_locks.name}"
      encrypt        = true
    }
  EOT
}
