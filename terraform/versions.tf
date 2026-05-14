terraform {
  backend "s3" {}

  required_version = ">= 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.33"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
    opensearch = {
      source  = "opensearch-project/opensearch"
      version = "~> 2.3"
    }
  }
}