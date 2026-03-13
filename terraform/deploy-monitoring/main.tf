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

# ─── Monitoring EC2 Instance (Prometheus / Grafana / Loki) ───

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
  enable_cloudwatch_agent        = var.enable_cloudwatch_agent
  tags                           = local.tags
}

# ─── CloudWatch Log Groups ───

module "cloudwatch_logs" {
  source = "../modules/cloudwatch-logs"

  kms_key_arn = var.kms_key_arn

  log_groups = {
    backend_api = {
      log_group_name = "/${var.project_name}/${var.environment}/backend-api"
      description    = "Backend API application logs from Docker containers."
    }
    nginx = {
      log_group_name = "/${var.project_name}/${var.environment}/nginx"
      description    = "Nginx reverse proxy access and error logs."
    }
    syslog = {
      log_group_name = "/${var.project_name}/${var.environment}/syslog"
      description    = "EC2 system logs (syslog)."
    }
    docker = {
      log_group_name = "/${var.project_name}/${var.environment}/docker"
      description    = "Docker daemon logs."
    }
  }

  retention_in_days = var.log_retention_days
  tags              = local.tags
}

# ─── CloudWatch Alarms ───

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

  # CloudWatch Agent custom metric alarms
  enable_cloudwatch_agent_alarms = var.enable_cloudwatch_agent
  custom_metrics_namespace       = var.custom_metrics_namespace
  ec2_memory_threshold           = var.ec2_memory_threshold
  ec2_disk_threshold             = var.ec2_disk_threshold

  # RDS latency alarms
  rds_read_latency_threshold  = var.rds_read_latency_threshold
  rds_write_latency_threshold = var.rds_write_latency_threshold

  # Log-based alarms
  enable_log_based_alarms    = var.enable_log_based_alarms
  backend_api_log_group_name = module.cloudwatch_logs.log_group_names["backend_api"]

  tags = local.tags
}

# ─── CloudWatch Dashboard ───

module "cloudwatch_dashboard" {
  source = "../modules/cloudwatch-dashboard"

  name_prefix              = local.name_prefix
  aws_region               = var.aws_region
  ec2_instance_ids         = var.ec2_instance_ids
  monitoring_instance_id   = module.monitoring.instance_id
  rds_instance_identifier  = var.rds_instance_identifier
  alb_arn                  = var.alb_arn
  log_group_names          = module.cloudwatch_logs.log_group_names
  custom_metrics_namespace = var.custom_metrics_namespace
  alarm_arns               = values(module.alarms.cloudwatch_alarm_arns)
  tags                     = local.tags
}

# ─── IAM Policy for Backend EC2 CloudWatch Agent ───

resource "aws_iam_policy" "backend_cloudwatch_agent" {
  count = var.enable_cloudwatch_agent ? 1 : 0

  name        = "${local.name_prefix}-backend-cloudwatch-agent"
  description = "Allows backend EC2 instances to push metrics and logs to CloudWatch via the CloudWatch Agent."

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "CloudWatchAgentMetrics"
        Effect = "Allow"
        Action = [
          "cloudwatch:PutMetricData"
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "cloudwatch:namespace" = var.custom_metrics_namespace
          }
        }
      },
      {
        Sid    = "CloudWatchAgentLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogStreams",
          "logs:DescribeLogGroups"
        ]
        Resource = [for arn in values(module.cloudwatch_logs.log_group_arns) : "${arn}:*"]
      },
      {
        Sid    = "CloudWatchAgentSSMConfig"
        Effect = "Allow"
        Action = [
          "ssm:GetParameter"
        ]
        Resource = aws_ssm_parameter.cloudwatch_agent_config[0].arn
      },
      {
        Sid    = "EC2DescribeTags"
        Effect = "Allow"
        Action = [
          "ec2:DescribeTags"
        ]
        Resource = "*"
      }
    ]
  })

  tags = local.tags
}

# ─── CloudWatch Agent Configuration in SSM Parameter Store ───

resource "aws_ssm_parameter" "cloudwatch_agent_config" {
  count = var.enable_cloudwatch_agent ? 1 : 0

  name        = "/${var.project_name}/${var.environment}/cloudwatch-agent/config"
  description = "CloudWatch Agent configuration for backend EC2 instances."
  type        = "String"

  value = jsonencode({
    agent = {
      metrics_collection_interval = 60
      run_as_user                 = "root"
      logfile                     = "/opt/aws/amazon-cloudwatch-agent/logs/amazon-cloudwatch-agent.log"
    }
    metrics = {
      namespace = var.custom_metrics_namespace
      append_dimensions = {
        InstanceId = "$${aws:InstanceId}"
      }
      metrics_collected = {
        mem = {
          measurement                 = ["mem_used_percent", "mem_available_percent"]
          metrics_collection_interval = 60
        }
        disk = {
          measurement                 = ["disk_used_percent", "disk_free"]
          resources                   = ["/"]
          metrics_collection_interval = 60
        }
        net = {
          measurement                 = ["bytes_sent", "bytes_recv"]
          metrics_collection_interval = 60
        }
      }
    }
    logs = {
      logs_collected = {
        files = {
          collect_list = [
            {
              file_path       = "/var/log/syslog"
              log_group_name  = "/${var.project_name}/${var.environment}/syslog"
              log_stream_name = "{instance_id}"
            },
            {
              file_path       = "/var/log/patientsync/*.log"
              log_group_name  = "/${var.project_name}/${var.environment}/backend-api"
              log_stream_name = "{instance_id}/{file_name}"
            },
            {
              file_path       = "/var/log/nginx/access.log"
              log_group_name  = "/${var.project_name}/${var.environment}/nginx"
              log_stream_name = "{instance_id}/access"
            },
            {
              file_path       = "/var/log/nginx/error.log"
              log_group_name  = "/${var.project_name}/${var.environment}/nginx"
              log_stream_name = "{instance_id}/error"
            },
            {
              file_path       = "/var/lib/docker/containers/*/*.log"
              log_group_name  = "/${var.project_name}/${var.environment}/docker"
              log_stream_name = "{instance_id}/{file_name}"
            }
          ]
        }
      }
    }
  })

  tags = local.tags
}
