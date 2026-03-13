locals {
  alb_dimension     = split("loadbalancer/", var.alb_arn)[1]
  dashboard_name    = "${var.name_prefix}-infrastructure"
  widget_width      = 6
  widget_height     = 6
  full_widget_width = 12

  # EC2 CPU metrics for all backend instances
  ec2_cpu_metrics = [
    for id in var.ec2_instance_ids : [
      "AWS/EC2", "CPUUtilization", "InstanceId", id
    ]
  ]

  # EC2 custom memory metrics (from CloudWatch Agent)
  ec2_memory_metrics = [
    for id in var.ec2_instance_ids : [
      var.custom_metrics_namespace, "mem_used_percent", "InstanceId", id
    ]
  ]

  # EC2 custom disk metrics (from CloudWatch Agent)
  ec2_disk_metrics = [
    for id in var.ec2_instance_ids : [
      var.custom_metrics_namespace, "disk_used_percent", "InstanceId", id, "path", "/", "fstype", "ext4"
    ]
  ]

  # EC2 network metrics
  ec2_network_in_metrics = [
    for id in var.ec2_instance_ids : [
      "AWS/EC2", "NetworkIn", "InstanceId", id
    ]
  ]

  ec2_network_out_metrics = [
    for id in var.ec2_instance_ids : [
      "AWS/EC2", "NetworkOut", "InstanceId", id
    ]
  ]
}

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = local.dashboard_name
  dashboard_body = jsonencode({
    widgets = concat(
      # ─── Section: EC2 Backend Instances ───
      [
        {
          type   = "text"
          x      = 0
          y      = 0
          width  = 24
          height = 1
          properties = {
            markdown = "# EC2 Backend Instances"
          }
        },
        {
          type   = "metric"
          x      = 0
          y      = 1
          width  = local.widget_width
          height = local.widget_height
          properties = {
            title   = "EC2 CPU Utilization (%)"
            view    = "timeSeries"
            stacked = false
            region  = var.aws_region
            stat    = "Average"
            period  = 300
            metrics = local.ec2_cpu_metrics
            yAxis = {
              left = { min = 0, max = 100 }
            }
            annotations = {
              horizontal = [
                { label = "Alarm threshold", value = 80, color = "#d13212" }
              ]
            }
          }
        },
        {
          type   = "metric"
          x      = local.widget_width
          y      = 1
          width  = local.widget_width
          height = local.widget_height
          properties = {
            title   = "EC2 Memory Used (%)"
            view    = "timeSeries"
            stacked = false
            region  = var.aws_region
            stat    = "Average"
            period  = 300
            metrics = local.ec2_memory_metrics
            yAxis = {
              left = { min = 0, max = 100 }
            }
            annotations = {
              horizontal = [
                { label = "Alarm threshold", value = 80, color = "#d13212" }
              ]
            }
          }
        },
        {
          type   = "metric"
          x      = local.widget_width * 2
          y      = 1
          width  = local.widget_width
          height = local.widget_height
          properties = {
            title   = "EC2 Disk Used (%)"
            view    = "timeSeries"
            stacked = false
            region  = var.aws_region
            stat    = "Average"
            period  = 300
            metrics = local.ec2_disk_metrics
            yAxis = {
              left = { min = 0, max = 100 }
            }
            annotations = {
              horizontal = [
                { label = "Alarm threshold", value = 85, color = "#d13212" }
              ]
            }
          }
        },
        {
          type   = "metric"
          x      = local.widget_width * 3
          y      = 1
          width  = local.widget_width
          height = local.widget_height
          properties = {
            title   = "EC2 Network I/O (bytes)"
            view    = "timeSeries"
            stacked = false
            region  = var.aws_region
            stat    = "Average"
            period  = 300
            metrics = concat(local.ec2_network_in_metrics, local.ec2_network_out_metrics)
          }
        },
      ],

      # ─── Section: Application Load Balancer ───
      [
        {
          type   = "text"
          x      = 0
          y      = 7
          width  = 24
          height = 1
          properties = {
            markdown = "# Application Load Balancer"
          }
        },
        {
          type   = "metric"
          x      = 0
          y      = 8
          width  = local.widget_width
          height = local.widget_height
          properties = {
            title   = "ALB Request Count"
            view    = "timeSeries"
            stacked = false
            region  = var.aws_region
            stat    = "Sum"
            period  = 60
            metrics = [
              ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", local.alb_dimension]
            ]
          }
        },
        {
          type   = "metric"
          x      = local.widget_width
          y      = 8
          width  = local.widget_width
          height = local.widget_height
          properties = {
            title   = "ALB Target Response Time (s)"
            view    = "timeSeries"
            stacked = false
            region  = var.aws_region
            stat    = "Average"
            period  = 60
            metrics = [
              ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", local.alb_dimension]
            ]
            annotations = {
              horizontal = [
                { label = "Alarm threshold", value = 2, color = "#d13212" }
              ]
            }
          }
        },
        {
          type   = "metric"
          x      = local.widget_width * 2
          y      = 8
          width  = local.widget_width
          height = local.widget_height
          properties = {
            title   = "ALB HTTP Errors"
            view    = "timeSeries"
            stacked = true
            region  = var.aws_region
            stat    = "Sum"
            period  = 60
            metrics = [
              ["AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", "LoadBalancer", local.alb_dimension, { color = "#d13212", label = "5xx" }],
              ["AWS/ApplicationELB", "HTTPCode_Target_4XX_Count", "LoadBalancer", local.alb_dimension, { color = "#ff9900", label = "4xx" }]
            ]
          }
        },
        {
          type   = "metric"
          x      = local.widget_width * 3
          y      = 8
          width  = local.widget_width
          height = local.widget_height
          properties = {
            title   = "ALB Healthy / Unhealthy Hosts"
            view    = "timeSeries"
            stacked = false
            region  = var.aws_region
            stat    = "Average"
            period  = 60
            metrics = [
              ["AWS/ApplicationELB", "HealthyHostCount", "LoadBalancer", local.alb_dimension, { color = "#2ca02c", label = "Healthy" }],
              ["AWS/ApplicationELB", "UnHealthyHostCount", "LoadBalancer", local.alb_dimension, { color = "#d13212", label = "Unhealthy" }]
            ]
          }
        },
      ],

      # ─── Section: RDS PostgreSQL ───
      [
        {
          type   = "text"
          x      = 0
          y      = 14
          width  = 24
          height = 1
          properties = {
            markdown = "# RDS PostgreSQL"
          }
        },
        {
          type   = "metric"
          x      = 0
          y      = 15
          width  = local.widget_width
          height = local.widget_height
          properties = {
            title   = "RDS CPU Utilization (%)"
            view    = "timeSeries"
            stacked = false
            region  = var.aws_region
            stat    = "Average"
            period  = 300
            metrics = [
              ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", var.rds_instance_identifier]
            ]
            yAxis = {
              left = { min = 0, max = 100 }
            }
            annotations = {
              horizontal = [
                { label = "Alarm threshold", value = 80, color = "#d13212" }
              ]
            }
          }
        },
        {
          type   = "metric"
          x      = local.widget_width
          y      = 15
          width  = local.widget_width
          height = local.widget_height
          properties = {
            title   = "RDS Freeable Memory (bytes)"
            view    = "timeSeries"
            stacked = false
            region  = var.aws_region
            stat    = "Average"
            period  = 300
            metrics = [
              ["AWS/RDS", "FreeableMemory", "DBInstanceIdentifier", var.rds_instance_identifier]
            ]
            annotations = {
              horizontal = [
                { label = "Alarm threshold (256 MiB)", value = 268435456, color = "#d13212" }
              ]
            }
          }
        },
        {
          type   = "metric"
          x      = local.widget_width * 2
          y      = 15
          width  = local.widget_width
          height = local.widget_height
          properties = {
            title   = "RDS Free Storage Space (bytes)"
            view    = "timeSeries"
            stacked = false
            region  = var.aws_region
            stat    = "Average"
            period  = 300
            metrics = [
              ["AWS/RDS", "FreeStorageSpace", "DBInstanceIdentifier", var.rds_instance_identifier]
            ]
            annotations = {
              horizontal = [
                { label = "Alarm threshold (10 GiB)", value = 10737418240, color = "#d13212" }
              ]
            }
          }
        },
        {
          type   = "metric"
          x      = local.widget_width * 3
          y      = 15
          width  = local.widget_width
          height = local.widget_height
          properties = {
            title   = "RDS Database Connections"
            view    = "timeSeries"
            stacked = false
            region  = var.aws_region
            stat    = "Average"
            period  = 300
            metrics = [
              ["AWS/RDS", "DatabaseConnections", "DBInstanceIdentifier", var.rds_instance_identifier]
            ]
            annotations = {
              horizontal = [
                { label = "Alarm threshold", value = 100, color = "#d13212" }
              ]
            }
          }
        },
      ],

      # ─── Section: RDS Performance ───
      [
        {
          type   = "metric"
          x      = 0
          y      = 21
          width  = local.widget_width
          height = local.widget_height
          properties = {
            title   = "RDS Read Latency (ms)"
            view    = "timeSeries"
            stacked = false
            region  = var.aws_region
            stat    = "Average"
            period  = 300
            metrics = [
              ["AWS/RDS", "ReadLatency", "DBInstanceIdentifier", var.rds_instance_identifier]
            ]
            annotations = {
              horizontal = [
                { label = "Alarm threshold (20ms)", value = 0.02, color = "#d13212" }
              ]
            }
          }
        },
        {
          type   = "metric"
          x      = local.widget_width
          y      = 21
          width  = local.widget_width
          height = local.widget_height
          properties = {
            title   = "RDS Write Latency (ms)"
            view    = "timeSeries"
            stacked = false
            region  = var.aws_region
            stat    = "Average"
            period  = 300
            metrics = [
              ["AWS/RDS", "WriteLatency", "DBInstanceIdentifier", var.rds_instance_identifier]
            ]
            annotations = {
              horizontal = [
                { label = "Alarm threshold (50ms)", value = 0.05, color = "#d13212" }
              ]
            }
          }
        },
        {
          type   = "metric"
          x      = local.widget_width * 2
          y      = 21
          width  = local.widget_width
          height = local.widget_height
          properties = {
            title   = "RDS Read/Write IOPS"
            view    = "timeSeries"
            stacked = false
            region  = var.aws_region
            stat    = "Average"
            period  = 300
            metrics = [
              ["AWS/RDS", "ReadIOPS", "DBInstanceIdentifier", var.rds_instance_identifier, { label = "Read IOPS" }],
              ["AWS/RDS", "WriteIOPS", "DBInstanceIdentifier", var.rds_instance_identifier, { label = "Write IOPS" }]
            ]
          }
        },
        {
          type   = "metric"
          x      = local.widget_width * 3
          y      = 21
          width  = local.widget_width
          height = local.widget_height
          properties = {
            title   = "RDS Replica Lag (s)"
            view    = "timeSeries"
            stacked = false
            region  = var.aws_region
            stat    = "Maximum"
            period  = 60
            metrics = [
              ["AWS/RDS", "ReplicaLag", "DBInstanceIdentifier", var.rds_instance_identifier]
            ]
            annotations = {
              horizontal = [
                { label = "Alarm threshold", value = 30, color = "#d13212" }
              ]
            }
          }
        },
      ],

      # ─── Section: Application Logs ───
      length(var.log_group_names) > 0 ? [
        {
          type   = "text"
          x      = 0
          y      = 27
          width  = 24
          height = 1
          properties = {
            markdown = "# Application Logs"
          }
        },
        {
          type   = "log"
          x      = 0
          y      = 28
          width  = local.full_widget_width
          height = local.widget_height
          properties = {
            title  = "Backend API Logs (Recent)"
            region = var.aws_region
            query  = "SOURCE '${lookup(var.log_group_names, "backend_api", "")}' | fields @timestamp, @message | sort @timestamp desc | limit 50"
            view   = "table"
          }
        },
        {
          type   = "log"
          x      = local.full_widget_width
          y      = 28
          width  = local.full_widget_width
          height = local.widget_height
          properties = {
            title  = "Nginx Access Logs (Recent)"
            region = var.aws_region
            query  = "SOURCE '${lookup(var.log_group_names, "nginx", "")}' | fields @timestamp, @message | sort @timestamp desc | limit 50"
            view   = "table"
          }
        },
      ] : [],

      # ─── Section: Monitoring EC2 Instance ───
      [
        {
          type   = "text"
          x      = 0
          y      = 34
          width  = 24
          height = 1
          properties = {
            markdown = "# Monitoring Instance (Prometheus / Grafana / Loki)"
          }
        },
        {
          type   = "metric"
          x      = 0
          y      = 35
          width  = local.widget_width
          height = local.widget_height
          properties = {
            title   = "Monitoring EC2 CPU (%)"
            view    = "timeSeries"
            stacked = false
            region  = var.aws_region
            stat    = "Average"
            period  = 300
            metrics = [
              ["AWS/EC2", "CPUUtilization", "InstanceId", var.monitoring_instance_id]
            ]
            yAxis = {
              left = { min = 0, max = 100 }
            }
          }
        },
        {
          type   = "metric"
          x      = local.widget_width
          y      = 35
          width  = local.widget_width
          height = local.widget_height
          properties = {
            title   = "Monitoring EC2 Status Check"
            view    = "timeSeries"
            stacked = false
            region  = var.aws_region
            stat    = "Maximum"
            period  = 60
            metrics = [
              ["AWS/EC2", "StatusCheckFailed", "InstanceId", var.monitoring_instance_id, { color = "#d13212" }]
            ]
          }
        },
      ],

      # ─── Section: Alarm Status Overview ───
      [
        {
          type   = "text"
          x      = 0
          y      = 41
          width  = 24
          height = 1
          properties = {
            markdown = "# Alarm Status Overview"
          }
        },
        {
          type   = "alarm"
          x      = 0
          y      = 42
          width  = 24
          height = 3
          properties = {
            title  = "All Infrastructure Alarms"
            alarms = var.alarm_arns
          }
        },
      ]
    )
  })
}
