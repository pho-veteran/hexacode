output "cloudfront_web_acl_arn" {
  description = "ARN of the CloudFront-scope AWS WAF web ACL."
  value       = aws_wafv2_web_acl.cloudfront.arn
}

output "regional_web_acl_arn" {
  description = "ARN of the regional AWS WAF web ACL."
  value       = aws_wafv2_web_acl.regional.arn
}
