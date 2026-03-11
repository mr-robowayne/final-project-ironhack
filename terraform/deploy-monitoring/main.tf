provider "aws" {
  region = var.aws_region
}

locals {
  name_prefix = "${var.project_name}-${var.environment}"

  tags = merge(
    {
      Environment   = "production"
      DataResidency = "CH"
      Compliance    = "DSGVO"
      PIIData       = "true"
      ManagedBy     = "Terraform"
      Project       = var.project_name
    },
    var.tags
  )
}

module "monitoring" {
  source = "../modules/monitoring"

  name_prefix                    = local.name_prefix
  vpc_id                         = var.vpc_id
  monitoring_subnet_id           = var.monitoring_subnet_id
  backend_security_group_id      = var.backend_security_group_id
  vpc_endpoint_security_group_id = var.vpc_endpoint_security_group_id
  kms_key_arn                    = var.kms_key_arn
  instance_type                  = var.monitoring_instance_type
  root_volume_size               = var.monitoring_root_volume_size
  tags                           = local.tags
}

module "alarms" {
  source = "../modules/alarms"

  name_prefix                 = local.name_prefix
  alert_email                 = var.alert_email
  rds_instance_identifier     = var.rds_instance_identifier
  valkey_replication_group_id = var.valkey_replication_group_id
  alb_arn                     = var.alb_arn
  ec2_instance_ids            = var.ec2_instance_ids
  monitoring_instance_id      = module.monitoring.instance_id
  ec2_ebs_write_ops_threshold = var.ec2_ebs_write_ops_threshold
  tags                        = local.tags
}
