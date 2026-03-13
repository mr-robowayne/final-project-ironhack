output "sns_topic_arn" {
  description = "SNS topic ARN used for infrastructure alerts."
  value       = aws_sns_topic.alerts.arn
}

output "cloudwatch_alarm_arns" {
  description = "Map of CloudWatch alarm ARNs."
  value = merge(
    {
      rds_cpu_high                = aws_cloudwatch_metric_alarm.rds_cpu_high.arn
      rds_storage_low             = aws_cloudwatch_metric_alarm.rds_storage_low.arn
      rds_connections_high        = aws_cloudwatch_metric_alarm.rds_connections_high.arn
      rds_replica_lag_high        = aws_cloudwatch_metric_alarm.rds_replica_lag_high.arn
      rds_freeable_memory_low     = aws_cloudwatch_metric_alarm.rds_freeable_memory_low.arn
      valkey_cpu_high             = aws_cloudwatch_metric_alarm.valkey_cpu_high.arn
      valkey_memory_high          = aws_cloudwatch_metric_alarm.valkey_memory_high.arn
      valkey_connections_high     = aws_cloudwatch_metric_alarm.valkey_connections_high.arn
      valkey_replication_lag_high = aws_cloudwatch_metric_alarm.valkey_replication_lag_high.arn
      alb_target_5xx_high         = aws_cloudwatch_metric_alarm.alb_target_5xx_high.arn
      alb_target_4xx_high         = aws_cloudwatch_metric_alarm.alb_target_4xx_high.arn
      alb_response_time_high      = aws_cloudwatch_metric_alarm.alb_response_time_high.arn
      alb_unhealthy_hosts         = aws_cloudwatch_metric_alarm.alb_unhealthy_hosts.arn
      rds_read_latency_high       = aws_cloudwatch_metric_alarm.rds_read_latency_high.arn
      rds_write_latency_high      = aws_cloudwatch_metric_alarm.rds_write_latency_high.arn
      monitoring_cpu_high         = aws_cloudwatch_metric_alarm.monitoring_cpu_high.arn
      monitoring_status_failed    = aws_cloudwatch_metric_alarm.monitoring_status_failed.arn
    },
    { for id, alarm in aws_cloudwatch_metric_alarm.backend_cpu_high : "backend_${id}_cpu_high" => alarm.arn },
    { for id, alarm in aws_cloudwatch_metric_alarm.backend_status_failed : "backend_${id}_status_failed" => alarm.arn },
    { for id, alarm in aws_cloudwatch_metric_alarm.backend_ebs_write_ops_high : "backend_${id}_ebs_write_ops_high" => alarm.arn },
    { for id, alarm in aws_cloudwatch_metric_alarm.backend_memory_high : "backend_${id}_memory_high" => alarm.arn },
    { for id, alarm in aws_cloudwatch_metric_alarm.backend_disk_high : "backend_${id}_disk_high" => alarm.arn },
    var.enable_log_based_alarms && var.backend_api_log_group_name != "" ? {
      backend_error_rate_high = aws_cloudwatch_metric_alarm.backend_error_rate_high[0].arn
    } : {}
  )
}
