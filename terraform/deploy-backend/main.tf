provider "aws" {
  region = var.aws_region
}

data "aws_ec2_managed_prefix_list" "cloudfront_origin_facing" {
  count = var.create_alb && var.alb_allow_cloudfront_only ? 1 : 0
  name  = "com.amazonaws.global.cloudfront.origin-facing"
}

# ---------------------------------------------------------------------------
# RDS data layer — look up secret ARN and KMS key from deploy-data outputs
# ---------------------------------------------------------------------------

data "aws_ssm_parameter" "rds_secret_arn" {
  count = var.rds_ssm_parameter_prefix != null ? 1 : 0
  name  = "${var.rds_ssm_parameter_prefix}/secret_arn"
}

data "aws_kms_alias" "rds" {
  count = var.rds_kms_alias_name != null ? 1 : 0
  name  = var.rds_kms_alias_name
}

locals {
  name_prefix = "${var.project_name}-${var.environment}"
  effective_alb_ingress_prefix_list_ids = distinct(concat(
    var.alb_allowed_ingress_prefix_list_ids,
    var.create_alb && var.alb_allow_cloudfront_only ? [data.aws_ec2_managed_prefix_list.cloudfront_origin_facing[0].id] : []
  ))
  normalized_alb_certificate_zone_name = trimsuffix(var.alb_certificate_zone_name, ".")
  normalized_alb_dns_zone_name         = trimsuffix(var.alb_dns_zone_name, ".")
  effective_alb_certificate_arn = coalesce(
    var.alb_certificate_arn,
    try(module.alb_certificate[0].certificate_arn, null)
  )
  tags = merge(
    {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
    },
    var.tags
  )
}

data "aws_route53_zone" "alb_certificate" {
  count = var.create_alb && var.alb_enforce_https && var.create_alb_certificate && var.alb_certificate_arn == null ? 1 : 0

  name         = "${local.normalized_alb_certificate_zone_name}."
  private_zone = false
}

module "alb_certificate" {
  count  = var.create_alb && var.alb_enforce_https && var.create_alb_certificate && var.alb_certificate_arn == null ? 1 : 0
  source = "../modules/acm"

  domain_name               = var.alb_certificate_domain_name
  subject_alternative_names = var.alb_certificate_subject_alternative_names
  zone_id                   = data.aws_route53_zone.alb_certificate[0].zone_id
  wait_for_validation       = var.alb_certificate_wait_for_validation
  tags                      = local.tags
}

module "network" {
  source = "../modules/network-backend"

  name_prefix                          = local.name_prefix
  vpc_cidr                             = var.vpc_cidr
  availability_zones                   = var.availability_zones
  public_subnet_cidrs                  = var.public_subnet_cidrs
  private_subnet_cidrs                 = var.private_subnet_cidrs
  monitoring_subnet_cidrs              = var.monitoring_subnet_cidrs
  monitoring_subnet_availability_zones = var.monitoring_subnet_availability_zones
  enable_nat_gateway                   = var.enable_nat_gateway
  single_nat_gateway                   = var.single_nat_gateway
  enable_monitoring_nat_gateway_route  = var.enable_monitoring_nat_gateway_route
  tags                                 = local.tags
}

module "compute" {
  source = "../modules/compute"

  name_prefix                = local.name_prefix
  vpc_id                     = module.network.vpc_id
  vpc_cidr                   = var.vpc_cidr
  private_subnet_ids         = module.network.private_subnet_ids
  availability_zones         = module.network.availability_zones
  instance_type              = var.private_instance_type
  ami_owner                  = var.private_instance_ami_owner
  ami_name_pattern           = var.private_instance_ami_name_pattern
  root_volume_size           = var.private_instance_root_volume_size
  root_volume_type           = var.private_instance_root_volume_type
  enable_detailed_monitoring  = var.private_instance_enable_detailed_monitoring
  enable_ssm_profile          = var.private_instance_enable_ssm_profile
  backend_secret_arns         = var.rds_ssm_parameter_prefix != null ? [data.aws_ssm_parameter.rds_secret_arn[0].value] : []
  backend_kms_key_arns        = var.rds_kms_alias_name != null ? [data.aws_kms_alias.rds[0].target_key_arn] : []
  backend_ssm_parameter_paths = var.rds_ssm_parameter_prefix != null ? [var.rds_ssm_parameter_prefix] : []
  tags                        = local.tags
}

module "alb" {
  count  = var.create_alb ? 1 : 0
  source = "../modules/alb"

  name_prefix                     = local.name_prefix
  vpc_id                          = module.network.vpc_id
  public_subnet_ids               = module.network.public_subnet_ids
  target_instance_ids             = module.compute.instance_ids
  target_port                     = var.alb_target_port
  health_check_path               = var.alb_health_check_path
  health_check_matcher            = var.alb_health_check_matcher
  certificate_arn                 = local.effective_alb_certificate_arn
  enforce_https                   = var.alb_enforce_https
  redirect_http_to_https          = var.alb_redirect_http_to_https
  ssl_policy                      = var.alb_ssl_policy
  allowed_ingress_cidrs_ipv4      = var.alb_allowed_ingress_cidrs_ipv4
  allowed_ingress_cidrs_ipv6      = var.alb_allowed_ingress_cidrs_ipv6
  allowed_ingress_prefix_list_ids = local.effective_alb_ingress_prefix_list_ids
  tags                            = local.tags
}

resource "aws_vpc_security_group_ingress_rule" "private_from_alb" {
  count = var.create_alb ? 1 : 0

  security_group_id            = module.compute.security_group_id
  referenced_security_group_id = module.alb[0].security_group_id
  ip_protocol                  = "tcp"
  from_port                    = var.alb_target_port
  to_port                      = var.alb_target_port
  description                  = "Allow app traffic from ALB to private EC2 instances."
}

data "aws_route53_zone" "alb_dns" {
  count = var.create_alb && var.create_alb_dns_record ? 1 : 0

  name         = "${local.normalized_alb_dns_zone_name}."
  private_zone = false
}

resource "aws_route53_record" "alb_alias_a" {
  count = var.create_alb && var.create_alb_dns_record ? 1 : 0

  zone_id = data.aws_route53_zone.alb_dns[0].zone_id
  name    = var.alb_dns_record_name
  type    = "A"

  alias {
    name                   = module.alb[0].dns_name
    zone_id                = module.alb[0].zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "alb_alias_aaaa" {
  count = var.create_alb && var.create_alb_dns_record ? 1 : 0

  zone_id = data.aws_route53_zone.alb_dns[0].zone_id
  name    = var.alb_dns_record_name
  type    = "AAAA"

  alias {
    name                   = module.alb[0].dns_name
    zone_id                = module.alb[0].zone_id
    evaluate_target_health = false
  }
}

module "vpc_endpoints" {
  count  = var.create_vpc_endpoints ? 1 : 0
  source = "../modules/vpc-endpoints"

  name_prefix                = local.name_prefix
  vpc_id                     = module.network.vpc_id
  subnet_ids                 = module.network.private_subnet_ids
  route_table_ids            = module.network.private_route_table_ids
  allowed_security_group_ids = [module.compute.security_group_id]

  enable_ssm_endpoint            = var.vpc_endpoints_enable_ssm
  enable_ssmmessages_endpoint    = var.vpc_endpoints_enable_ssmmessages
  enable_ec2messages_endpoint    = var.vpc_endpoints_enable_ec2messages
  enable_logs_endpoint           = var.vpc_endpoints_enable_logs
  enable_secretsmanager_endpoint = var.vpc_endpoints_enable_secretsmanager
  enable_ecr_api_endpoint        = var.vpc_endpoints_enable_ecr_api
  enable_ecr_dkr_endpoint        = var.vpc_endpoints_enable_ecr_dkr
  enable_s3_gateway_endpoint     = var.vpc_endpoints_enable_s3_gateway
  tags                           = local.tags
}
