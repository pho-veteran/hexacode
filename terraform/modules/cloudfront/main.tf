# CloudFront Module
# Creates the CloudFront distribution for the frontend SPA

# Origin Access Control
resource "aws_cloudfront_origin_access_control" "frontend" {
  name = "hexacode-${var.environment}-oac"

  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# CloudFront Distribution
resource "aws_cloudfront_distribution" "frontend" {
  enabled = true

  price_class = "PriceClass_All"

  origin {
    domain_name = "${var.frontend_bucket_name}.s3.${var.region}.amazonaws.com"
    origin_id   = "hexacode-frontend-s3"

    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  default_root_object = "index.html"

  default_cache_behavior {
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "hexacode-frontend-s3"
    compress               = true

    # Use managed optimized cache policy (CachingOptimized)
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  }

  # Custom error responses for SPA routing - return index.html with 200 for 403/404
  custom_error_response {
    error_code         = 403
    response_page_path = "/index.html"
    response_code      = 200
  }

  custom_error_response {
    error_code         = 404
    response_page_path = "/index.html"
    response_code      = 200
  }

  # Geo restrictions
  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = {
    Name = "hexacode-${var.environment}-cloudfront"
  }
}

# S3 Bucket Policy for CloudFront OAC
data "aws_caller_identity" "current" {}

resource "aws_s3_bucket_policy" "frontend_cloudfront" {
  bucket = var.frontend_bucket_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontAccess"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action = [
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          var.frontend_bucket_arn,
          "${var.frontend_bucket_arn}/*"
        ]
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.frontend.arn
          }
        }
      }
    ]
  })
}
