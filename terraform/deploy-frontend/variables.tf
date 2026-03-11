variable "project_name" {
  description = "Project name used in resource naming."
  type        = string
}

variable "environment" {
  description = "Environment name (for example: prod)."
  type        = string
}

variable "aws_region" {
  description = "AWS region for regional resources (S3 origin bucket, Route53 data lookup)."
  type        = string
}

variable "route53_zone_name" {
  description = "Public Route53 hosted zone name."
  type        = string
}

variable "route53_private_zone" {
  description = "Whether the Route53 hosted zone is private."
  type        = bool
  default     = false
}

variable "frontend_subdomain" {
  description = "Subdomain for frontend public access."
  type        = string
  default     = "dhpatientsync"
}

variable "enable_alb_api_origin" {
  description = "Enable ALB as additional CloudFront origin for dynamic/API traffic."
  type        = bool
  default     = true
}

variable "alb_origin_domain_name" {
  description = "Domain name used as CloudFront API origin (must resolve to ALB and match ALB TLS certificate)."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = !var.enable_alb_api_origin || (var.alb_origin_domain_name != null && length(trimspace(var.alb_origin_domain_name)) > 0)
    error_message = "alb_origin_domain_name must be set when enable_alb_api_origin is true."
  }
}

variable "alb_origin_path_pattern" {
  description = "Path pattern routed from CloudFront to ALB origin."
  type        = string
  default     = "/api/*"
}

variable "create_frontend_dns_record" {
  description = "Create Route53 alias records (A and AAAA) to CloudFront."
  type        = bool
  default     = true
}

variable "frontend_bucket_name" {
  description = "Name of the private S3 bucket used as CloudFront origin."
  type        = string
}

variable "frontend_bucket_force_destroy" {
  description = "Whether to allow deleting frontend bucket with objects."
  type        = bool
  default     = false
}

variable "frontend_bucket_kms_key_arn" {
  description = "Optional KMS key ARN for frontend bucket encryption."
  type        = string
  default     = null

  validation {
    condition     = var.frontend_bucket_kms_key_arn == null || can(regex(":${var.aws_region}:", var.frontend_bucket_kms_key_arn))
    error_message = "frontend_bucket_kms_key_arn must be in aws_region."
  }
}

variable "create_public_access_kms_key" {
  description = "Create managed KMS keys for public-access storage (regional) and WAF logs (us-east-1) when ARNs are not provided."
  type        = bool
  default     = true
}

variable "public_access_kms_key_arn" {
  description = "Optional KMS key ARN override for public-access storage resources."
  type        = string
  default     = null

  validation {
    condition     = var.public_access_kms_key_arn == null || can(regex(":${var.aws_region}:", var.public_access_kms_key_arn))
    error_message = "public_access_kms_key_arn must be in aws_region."
  }
}

variable "default_root_object" {
  description = "Default object served for root path."
  type        = string
  default     = "index.html"
}

variable "cloudfront_price_class" {
  description = "CloudFront price class."
  type        = string
  default     = "PriceClass_100"
}

variable "geo_allowed_countries" {
  description = "ISO country codes allowed to access the frontend via CloudFront."
  type        = list(string)
  default = [
    "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR",
    "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL",
    "PL", "PT", "RO", "SK", "SI", "ES", "SE", "CH"
  ]
}

variable "enable_cloudfront_access_logs" {
  description = "Enable CloudFront standard logging v2 delivery to S3."
  type        = bool
  default     = true
}

variable "cloudfront_log_bucket_name" {
  description = "Optional explicit S3 bucket name for CloudFront standard logging v2."
  type        = string
  default     = null
}

variable "cloudfront_log_bucket_kms_key_arn" {
  description = "Optional KMS key ARN for CloudFront log bucket encryption."
  type        = string
  default     = null

  validation {
    condition     = var.cloudfront_log_bucket_kms_key_arn == null || can(regex(":${var.aws_region}:", var.cloudfront_log_bucket_kms_key_arn))
    error_message = "cloudfront_log_bucket_kms_key_arn must be in aws_region."
  }
}

variable "cloudfront_log_bucket_force_destroy" {
  description = "Allow deleting log bucket with objects."
  type        = bool
  default     = false
}

variable "cloudfront_log_prefix" {
  description = "Optional S3 prefix for CloudFront standard logging v2 objects."
  type        = string
  default     = "cloudfront/"
}

variable "cloudfront_log_retention_days" {
  description = "Retention in days for CloudFront access logs in S3. Set null to disable expiration."
  type        = number
  default     = 365
  nullable    = true

  validation {
    condition     = var.cloudfront_log_retention_days == null || var.cloudfront_log_retention_days > 0
    error_message = "cloudfront_log_retention_days must be null or greater than 0."
  }
}

variable "enable_waf_logs" {
  description = "Enable WAF logs in CloudWatch Logs."
  type        = bool
  default     = true
}

variable "waf_log_group_name" {
  description = "Optional explicit WAF log group name. Must start with aws-waf-logs-."
  type        = string
  default     = null

  validation {
    condition     = var.waf_log_group_name == null || startswith(var.waf_log_group_name, "aws-waf-logs-")
    error_message = "waf_log_group_name must start with aws-waf-logs-."
  }
}

variable "waf_log_retention_days" {
  description = "Retention (days) for WAF log group."
  type        = number
  default     = 365
}

variable "waf_log_group_kms_key_arn" {
  description = "Optional KMS key ARN for WAF CloudWatch log group encryption (must be in us-east-1)."
  type        = string
  default     = null

  validation {
    condition     = var.waf_log_group_kms_key_arn == null || can(regex(":us-east-1:", var.waf_log_group_kms_key_arn))
    error_message = "waf_log_group_kms_key_arn must be in us-east-1."
  }
}

variable "enable_waf_rate_limit" {
  description = "Enable WAF rate limiting by source IP."
  type        = bool
  default     = true
}

variable "waf_rate_limit" {
  description = "Maximum requests per 5 minutes from a single IP before block."
  type        = number
  default     = 2000

  validation {
    condition     = var.waf_rate_limit >= 100
    error_message = "waf_rate_limit must be at least 100."
  }
}

variable "create_frontend_acm_certificate" {
  description = "Create ACM certificate in us-east-1 for CloudFront."
  type        = bool
  default     = false
}

variable "frontend_acm_subject_alternative_names" {
  description = "Optional SAN entries for new ACM certificate."
  type        = list(string)
  default     = []
}

variable "frontend_acm_wait_for_validation" {
  description = "Wait for ACM DNS validation."
  type        = bool
  default     = true
}

variable "frontend_acm_certificate_arn" {
  description = "Existing ACM certificate ARN for CloudFront."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.create_frontend_acm_certificate || var.frontend_acm_certificate_arn != null || var.frontend_acm_certificate_id != null
    error_message = "Provide frontend_acm_certificate_arn or frontend_acm_certificate_id, or set create_frontend_acm_certificate=true."
  }

  validation {
    condition     = var.create_frontend_acm_certificate || var.frontend_acm_certificate_arn == null || can(regex(":acm:us-east-1:", var.frontend_acm_certificate_arn))
    error_message = "CloudFront requires ACM certificates in us-east-1."
  }
}

variable "frontend_acm_certificate_id" {
  description = "Existing ACM certificate ID if ARN is not provided."
  type        = string
  default     = null
  nullable    = true
}

variable "frontend_acm_certificate_region" {
  description = "Region of existing ACM certificate when frontend_acm_certificate_id is used."
  type        = string
  default     = "us-east-1"

  validation {
    condition     = var.create_frontend_acm_certificate || var.frontend_acm_certificate_id == null || var.frontend_acm_certificate_region == "us-east-1"
    error_message = "When frontend_acm_certificate_id is used for CloudFront, frontend_acm_certificate_region must be us-east-1."
  }
}

variable "tags" {
  description = "Additional tags to apply to resources."
  type        = map(string)
  default     = {}
}
