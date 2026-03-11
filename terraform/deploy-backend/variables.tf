variable "project_name" {
  description = "Project name used in resource naming."
  type        = string
}

variable "environment" {
  description = "Environment name (e.g. dev, stage, prod)."
  type        = string
}

variable "aws_region" {
  description = "AWS region where network resources are created."
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.50.0.0/16"
}

variable "availability_zones" {
  description = "Exactly two AZs in the selected region."
  type        = list(string)

  validation {
    condition     = length(var.availability_zones) == 2 && length(distinct(var.availability_zones)) == 2
    error_message = "availability_zones must contain exactly 2 distinct AZ names."
  }
}

variable "public_subnet_cidrs" {
  description = "CIDRs for two public subnets."
  type        = list(string)
  default     = ["10.50.1.0/24", "10.50.2.0/24"]

  validation {
    condition     = length(var.public_subnet_cidrs) == 2 && length(distinct(var.public_subnet_cidrs)) == 2
    error_message = "public_subnet_cidrs must contain exactly 2 distinct CIDR blocks."
  }
}

variable "private_subnet_cidrs" {
  description = "CIDRs for two private subnets."
  type        = list(string)
  default     = ["10.50.11.0/24", "10.50.12.0/24"]

  validation {
    condition     = length(var.private_subnet_cidrs) == 2 && length(distinct(var.private_subnet_cidrs)) == 2
    error_message = "private_subnet_cidrs must contain exactly 2 distinct CIDR blocks."
  }
}

variable "monitoring_subnet_cidrs" {
  description = "CIDRs for monitoring subnets (no internet route)."
  type        = list(string)
  default     = ["10.50.31.0/24"]
}

variable "monitoring_subnet_availability_zones" {
  description = "AZs for monitoring subnets. If empty, first AZ is used."
  type        = list(string)
  default     = ["eu-central-2a"]

  validation {
    condition     = length(var.monitoring_subnet_availability_zones) == 0 || length(var.monitoring_subnet_availability_zones) == length(var.monitoring_subnet_cidrs)
    error_message = "monitoring_subnet_availability_zones must be empty or match monitoring_subnet_cidrs length."
  }
}

variable "enable_nat_gateway" {
  description = "Enable NAT gateway for private subnet outbound internet access."
  type        = bool
  default     = true
}

variable "single_nat_gateway" {
  description = "Use a single NAT gateway instead of one per AZ."
  type        = bool
  default     = false
}

variable "enable_monitoring_nat_gateway_route" {
  description = "Route monitoring subnet default traffic through NAT for updates/image pulls."
  type        = bool
  default     = true
}

variable "private_instance_type" {
  description = "EC2 instance type for private subnet instances."
  type        = string
  default     = "t3a.medium"
}

variable "private_instance_ami_owner" {
  description = "Owner account ID for Ubuntu AMI lookup."
  type        = string
  default     = "099720109477"
}

variable "private_instance_ami_name_pattern" {
  description = "AMI name pattern for Ubuntu private instances."
  type        = string
  default     = "ubuntu/images/hvm-ssd*/ubuntu-jammy-22.04-amd64-server-*"
}

variable "private_instance_root_volume_size" {
  description = "Root volume size (GiB) for private instances."
  type        = number
  default     = 30
}

variable "private_instance_root_volume_type" {
  description = "Root volume type for private instances."
  type        = string
  default     = "gp3"
}

variable "private_instance_enable_detailed_monitoring" {
  description = "Enable detailed monitoring for private instances."
  type        = bool
  default     = true
}

variable "private_instance_enable_ssm_profile" {
  description = "Create and attach an SSM instance profile for private instances."
  type        = bool
  default     = true
}

variable "create_alb" {
  description = "Whether to create an internet-facing Application Load Balancer."
  type        = bool
  default     = true

  validation {
    condition = !var.create_alb || !var.alb_enforce_https || (
      (var.alb_certificate_arn != null && length(trimspace(var.alb_certificate_arn)) > 0) ||
      var.create_alb_certificate
    )
    error_message = "When create_alb=true and alb_enforce_https=true, set alb_certificate_arn or enable create_alb_certificate."
  }

  validation {
    condition = !var.create_alb || var.alb_allow_cloudfront_only || (
      length(var.alb_allowed_ingress_cidrs_ipv4) +
      length(var.alb_allowed_ingress_cidrs_ipv6) +
      length(var.alb_allowed_ingress_prefix_list_ids)
    ) > 0
    error_message = "When create_alb=true, configure ALB ingress sources or set alb_allow_cloudfront_only=true."
  }
}

variable "alb_target_port" {
  description = "Application port on EC2 targets for the ALB target group."
  type        = number
  default     = 80
}

variable "alb_health_check_path" {
  description = "Health check path for ALB target group."
  type        = string
  default     = "/"
}

variable "alb_health_check_matcher" {
  description = "Expected HTTP codes for ALB health checks."
  type        = string
  default     = "200-399"
}

variable "alb_certificate_arn" {
  description = "Optional ACM certificate ARN in the same region as ALB for HTTPS listener."
  type        = string
  default     = null
}

variable "create_alb_certificate" {
  description = "Create and validate an ACM certificate in aws_region for the ALB listener."
  type        = bool
  default     = true
}

variable "alb_certificate_domain_name" {
  description = "Domain name for ALB ACM certificate (for example api.example.com)."
  type        = string
  default     = "api.doktorhausag-faellanden.ch"
}

variable "alb_certificate_subject_alternative_names" {
  description = "Optional SANs for ALB ACM certificate."
  type        = list(string)
  default     = []
}

variable "alb_certificate_zone_name" {
  description = "Public Route53 zone used for ALB ACM DNS validation."
  type        = string
  default     = "doktorhausag-faellanden.ch"
}

variable "alb_certificate_wait_for_validation" {
  description = "Wait until ALB ACM certificate is validated before continuing."
  type        = bool
  default     = true
}

variable "alb_enforce_https" {
  description = "Require HTTPS listener configuration for ALB."
  type        = bool
  default     = true
}

variable "alb_redirect_http_to_https" {
  description = "Redirect HTTP to HTTPS when alb_certificate_arn is set."
  type        = bool
  default     = true
}

variable "alb_ssl_policy" {
  description = "SSL policy for ALB HTTPS listener."
  type        = string
  default     = "ELBSecurityPolicy-TLS13-1-2-2021-06"
}

variable "alb_allowed_ingress_cidrs_ipv4" {
  description = "IPv4 CIDRs allowed to access the ALB."
  type        = list(string)
  default     = []
}

variable "alb_allowed_ingress_cidrs_ipv6" {
  description = "IPv6 CIDRs allowed to access the ALB."
  type        = list(string)
  default     = []
}

variable "alb_allowed_ingress_prefix_list_ids" {
  description = "Prefix list IDs allowed to access the ALB."
  type        = list(string)
  default     = []
}

variable "alb_allow_cloudfront_only" {
  description = "Automatically allow CloudFront origin-facing managed prefix list to access the ALB."
  type        = bool
  default     = true
}

variable "alb_allow_world_ipv4" {
  description = "Allow public IPv4 ingress (0.0.0.0/0) to ALB."
  type        = bool
  default     = false

  validation {
    condition     = var.alb_allow_world_ipv4 || !contains(var.alb_allowed_ingress_cidrs_ipv4, "0.0.0.0/0")
    error_message = "0.0.0.0/0 is blocked by default. Set alb_allow_world_ipv4=true only when explicitly required."
  }
}

variable "create_alb_dns_record" {
  description = "Create Route53 alias records (A/AAAA) for ALB."
  type        = bool
  default     = true
}

variable "alb_dns_zone_name" {
  description = "Public Route53 hosted zone name where ALB DNS record is created."
  type        = string
  default     = "doktorhausag-faellanden.ch"
}

variable "alb_dns_record_name" {
  description = "Record name for ALB endpoint (for example api)."
  type        = string
  default     = "api"
}

variable "create_vpc_endpoints" {
  description = "Create private VPC endpoints for AWS services used by backend instances."
  type        = bool
  default     = true
}

variable "vpc_endpoints_enable_ssm" {
  description = "Create VPC endpoint for SSM."
  type        = bool
  default     = true
}

variable "vpc_endpoints_enable_ssmmessages" {
  description = "Create VPC endpoint for SSM Messages."
  type        = bool
  default     = true
}

variable "vpc_endpoints_enable_ec2messages" {
  description = "Create VPC endpoint for EC2 Messages."
  type        = bool
  default     = true
}

variable "vpc_endpoints_enable_logs" {
  description = "Create VPC endpoint for CloudWatch Logs."
  type        = bool
  default     = true
}

variable "vpc_endpoints_enable_secretsmanager" {
  description = "Create VPC endpoint for Secrets Manager."
  type        = bool
  default     = true
}

variable "vpc_endpoints_enable_ecr_api" {
  description = "Create VPC endpoint for ECR API."
  type        = bool
  default     = true
}

variable "vpc_endpoints_enable_ecr_dkr" {
  description = "Create VPC endpoint for ECR DKR."
  type        = bool
  default     = true
}

variable "vpc_endpoints_enable_s3_gateway" {
  description = "Create S3 gateway VPC endpoint."
  type        = bool
  default     = true
}

variable "rds_ssm_parameter_prefix" {
  description = "SSM parameter prefix for RDS connection metadata from deploy-data (e.g. /patientsync/prod/data/rds). Set to null to skip RDS access policy on EC2."
  type        = string
  default     = null
}

variable "rds_kms_alias_name" {
  description = "KMS alias name for RDS encryption key from deploy-data (e.g. alias/patientsync-prod-rds-data). Set to null to skip KMS access policy on EC2."
  type        = string
  default     = null
}

variable "tags" {
  description = "Additional tags to apply to all resources."
  type        = map(string)
  default     = {}
}
