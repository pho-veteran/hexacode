# S3 Buckets Module - Hexacode Storage
# Creates frontend, problem-assets, and submission-artifacts buckets

resource "aws_s3_bucket" "frontend" {
  bucket = "hexacode-${var.environment}-frontend"

  tags = {
    Name        = "hexacode-${var.environment}-frontend"
    Environment = var.environment
  }
}

resource "aws_s3_bucket_ownership_controls" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket" "problem_assets" {
  bucket = "hexacode-${var.environment}-problem-assets"

  tags = {
    Name        = "hexacode-${var.environment}-problem-assets"
    Environment = var.environment
  }
}

resource "aws_s3_bucket_ownership_controls" "problem_assets" {
  bucket = aws_s3_bucket.problem_assets.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "problem_assets" {
  bucket = aws_s3_bucket.problem_assets.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "problem_assets" {
  bucket = aws_s3_bucket.problem_assets.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "problem_assets" {
  bucket = aws_s3_bucket.problem_assets.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "problem_assets" {
  bucket = aws_s3_bucket.problem_assets.id

  rule {
    id     = "compiled-checker-90day-expiry"
    status = "Enabled"

    filter {
      tag {
        key   = "lifecycle"
        value = "compiled-checker"
      }
    }

    expiration {
      days = 90
    }
  }
}

resource "aws_s3_bucket" "submission_artifacts" {
  bucket = "hexacode-${var.environment}-submission-artifacts"

  tags = {
    Name        = "hexacode-${var.environment}-submission-artifacts"
    Environment = var.environment
  }
}

resource "aws_s3_bucket_ownership_controls" "submission_artifacts" {
  bucket = aws_s3_bucket.submission_artifacts.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "submission_artifacts" {
  bucket = aws_s3_bucket.submission_artifacts.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "submission_artifacts" {
  bucket = aws_s3_bucket.submission_artifacts.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "submission_artifacts" {
  bucket = aws_s3_bucket.submission_artifacts.id

  versioning_configuration {
    status = "Enabled"
  }
}