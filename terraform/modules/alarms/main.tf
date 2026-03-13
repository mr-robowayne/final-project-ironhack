locals {
  alb_dimension = split("loadbalancer/", var.alb_arn)[1]
}

resource "aws_sns_topic" "alerts" {
  name = "${var.name_prefix}-infrastructure-alerts"
  tags = var.tags
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu_high" {
  alarm_name          = "${var.name_prefix}-rds-cpu-high"
  alarm_description   = "RDS CPU utilization above 80%."
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    DBInstanceIdentifier = var.rds_instance_identifier
  }
  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "rds_storage_low" {
  alarm_name          = "${var.name_prefix}-rds-free-storage-low"
  alarm_description   = "RDS free storage space below 10GiB."
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 1
  threshold           = 10737418240
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    DBInstanceIdentifier = var.rds_instance_identifier
  }
  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "rds_connections_high" {
  alarm_name          = "${var.name_prefix}-rds-connections-high"
  alarm_description   = "RDS connections above 100."
  namespace           = "AWS/RDS"
  metric_name         = "DatabaseConnections"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 100
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    DBInstanceIdentifier = var.rds_instance_identifier
  }
  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "rds_replica_lag_high" {
  alarm_name          = "${var.name_prefix}-rds-replica-lag-high"
  alarm_description   = "RDS replica lag above 30 seconds."
  namespace           = "AWS/RDS"
  metric_name         = "ReplicaLag"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 30
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    DBInstanceIdentifier = var.rds_instance_identifier
  }
  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "rds_freeable_memory_low" {
  alarm_name          = "${var.name_prefix}-rds-freeable-memory-low"
  alarm_description   = "RDS freeable memory below 256MiB."
  namespace           = "AWS/RDS"
  metric_name         = "FreeableMemory"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 268435456
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    DBInstanceIdentifier = var.rds_instance_identifier
  }
  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "valkey_cpu_high" {
  alarm_name          = "${var.name_prefix}-valkey-cpu-high"
  alarm_description   = "Valkey engine CPU utilization above 80%."
  namespace           = "AWS/ElastiCache"
  metric_name         = "EngineCPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    ReplicationGroupId = var.valkey_replication_group_id
  }
  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "valkey_memory_high" {
  alarm_name          = "${var.name_prefix}-valkey-memory-usage-high"
  alarm_description   = "Valkey database memory usage percentage above 80%."
  namespace           = "AWS/ElastiCache"
  metric_name         = "DatabaseMemoryUsagePercentage"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    ReplicationGroupId = var.valkey_replication_group_id
  }
  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "valkey_connections_high" {
  alarm_name          = "${var.name_prefix}-valkey-connections-high"
  alarm_description   = "Valkey current connections above 500."
  namespace           = "AWS/ElastiCache"
  metric_name         = "CurrConnections"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 500
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    ReplicationGroupId = var.valkey_replication_group_id
  }
  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "valkey_replication_lag_high" {
  alarm_name          = "${var.name_prefix}-valkey-replication-lag-high"
  alarm_description   = "Valkey replication lag above 30 seconds."
  namespace           = "AWS/ElastiCache"
  metric_name         = "ReplicationLag"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 30
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    ReplicationGroupId = var.valkey_replication_group_id
  }
  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "alb_target_5xx_high" {
  alarm_name          = "${var.name_prefix}-alb-target-5xx-high"
  alarm_description   = "ALB target 5xx count above 10."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 10
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    LoadBalancer = local.alb_dimension
  }
  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "alb_target_4xx_high" {
  alarm_name          = "${var.name_prefix}-alb-target-4xx-high"
  alarm_description   = "ALB target 4xx count above 50."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_4XX_Count"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 50
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    LoadBalancer = local.alb_dimension
  }
  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "alb_response_time_high" {
  alarm_name          = "${var.name_prefix}-alb-target-response-time-high"
  alarm_description   = "ALB target response time above 2 seconds."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "TargetResponseTime"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 2
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    LoadBalancer = local.alb_dimension
  }
  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "alb_unhealthy_hosts" {
  alarm_name          = "${var.name_prefix}-alb-unhealthy-hosts"
  alarm_description   = "ALB unhealthy hosts greater than 0."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "UnHealthyHostCount"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    LoadBalancer = local.alb_dimension
  }
  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "backend_cpu_high" {
  for_each = toset(var.ec2_instance_ids)

  alarm_name          = "${var.name_prefix}-backend-${each.value}-cpu-high"
  alarm_description   = "Backend EC2 CPU utilization above 80%."
  namespace           = "AWS/EC2"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    InstanceId = each.value
  }
  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "backend_status_failed" {
  for_each = toset(var.ec2_instance_ids)

  alarm_name          = "${var.name_prefix}-backend-${each.value}-status-check-failed"
  alarm_description   = "Backend EC2 instance status check failed."
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    InstanceId = each.value
  }
  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "backend_ebs_write_ops_high" {
  for_each = toset(var.ec2_instance_ids)

  alarm_name          = "${var.name_prefix}-backend-${each.value}-ebs-write-ops-high"
  alarm_description   = "Backend EC2 EBS write operations too high."
  namespace           = "AWS/EC2"
  metric_name         = "EBSWriteOps"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = var.ec2_ebs_write_ops_threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    InstanceId = each.value
  }
  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "monitoring_cpu_high" {
  alarm_name          = "${var.name_prefix}-monitoring-cpu-high"
  alarm_description   = "Monitoring EC2 CPU utilization above 80%."
  namespace           = "AWS/EC2"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    InstanceId = var.monitoring_instance_id
  }
  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "monitoring_status_failed" {
  alarm_name          = "${var.name_prefix}-monitoring-status-check-failed"
  alarm_description   = "Monitoring EC2 instance status check failed."
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    InstanceId = var.monitoring_instance_id
  }
  tags = var.tags
}

# ─── RDS Read/Write Latency Alarms ───

resource "aws_cloudwatch_metric_alarm" "rds_read_latency_high" {
  alarm_name          = "${var.name_prefix}-rds-read-latency-high"
  alarm_description   = "RDS read latency above ${var.rds_read_latency_threshold * 1000}ms."
  namespace           = "AWS/RDS"
  metric_name         = "ReadLatency"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = var.rds_read_latency_threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    DBInstanceIdentifier = var.rds_instance_identifier
  }
  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "rds_write_latency_high" {
  alarm_name          = "${var.name_prefix}-rds-write-latency-high"
  alarm_description   = "RDS write latency above ${var.rds_write_latency_threshold * 1000}ms."
  namespace           = "AWS/RDS"
  metric_name         = "WriteLatency"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = var.rds_write_latency_threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    DBInstanceIdentifier = var.rds_instance_identifier
  }
  tags = var.tags
}

# ─── EC2 Memory & Disk Alarms (CloudWatch Agent custom metrics) ───

resource "aws_cloudwatch_metric_alarm" "backend_memory_high" {
  for_each = var.enable_cloudwatch_agent_alarms ? toset(var.ec2_instance_ids) : toset([])

  alarm_name          = "${var.name_prefix}-backend-${each.value}-memory-high"
  alarm_description   = "Backend EC2 memory usage above ${var.ec2_memory_threshold}%."
  namespace           = var.custom_metrics_namespace
  metric_name         = "mem_used_percent"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = var.ec2_memory_threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    InstanceId = each.value
  }
  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "backend_disk_high" {
  for_each = var.enable_cloudwatch_agent_alarms ? toset(var.ec2_instance_ids) : toset([])

  alarm_name          = "${var.name_prefix}-backend-${each.value}-disk-high"
  alarm_description   = "Backend EC2 disk usage above ${var.ec2_disk_threshold}%."
  namespace           = var.custom_metrics_namespace
  metric_name         = "disk_used_percent"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = var.ec2_disk_threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    InstanceId = each.value
    path       = "/"
    fstype     = "ext4"
  }
  tags = var.tags
}

# ─── Log-Based Metric Filters & Alarms ───

resource "aws_cloudwatch_log_metric_filter" "backend_error_rate" {
  count = var.enable_log_based_alarms && var.backend_api_log_group_name != "" ? 1 : 0

  name           = "${var.name_prefix}-backend-error-rate"
  log_group_name = var.backend_api_log_group_name
  pattern        = "ERROR"

  metric_transformation {
    name          = "BackendErrorCount"
    namespace     = var.custom_metrics_namespace
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "backend_error_rate_high" {
  count = var.enable_log_based_alarms && var.backend_api_log_group_name != "" ? 1 : 0

  alarm_name          = "${var.name_prefix}-backend-error-rate-high"
  alarm_description   = "Backend API error rate above 10 errors in 5 minutes."
  namespace           = var.custom_metrics_namespace
  metric_name         = "BackendErrorCount"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 10
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = var.tags
}
