data "aws_ssm_parameter" "amazon_linux_2023_ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.1-x86_64"
}

data "aws_iam_policy_document" "assume_role" {
  statement {
    effect = "Allow"
    actions = [
      "sts:AssumeRole"
    ]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "monitoring" {
  name               = "${var.name_prefix}-monitoring-ec2-role"
  assume_role_policy = data.aws_iam_policy_document.assume_role.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "ec2_discovery" {
  name = "${var.name_prefix}-monitoring-ec2-discovery"
  role = aws_iam_role.monitoring.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ec2:DescribeInstances",
          "ec2:DescribeTags"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_instance_profile" "monitoring" {
  name = "${var.name_prefix}-monitoring-ec2-profile"
  role = aws_iam_role.monitoring.name
}

resource "aws_security_group" "monitoring" {
  name        = "${var.name_prefix}-monitoring-sg"
  description = "Security group for monitoring EC2 instance."
  vpc_id      = var.vpc_id
  tags = merge(
    var.tags,
    {
      Name = "${var.name_prefix}-monitoring-sg"
      Tier = "monitoring"
    }
  )
}

resource "aws_vpc_security_group_egress_rule" "https_to_vpc_endpoints" {
  security_group_id            = aws_security_group.monitoring.id
  referenced_security_group_id = var.vpc_endpoint_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
  description                  = "Allow HTTPS traffic to VPC interface endpoints."
}

resource "aws_vpc_security_group_egress_rule" "https_to_internet" {
  count = var.allow_https_egress_to_internet ? 1 : 0

  security_group_id = aws_security_group.monitoring.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
  description       = "Allow outbound HTTPS to internet destinations via NAT."
}

resource "aws_vpc_security_group_ingress_rule" "vpc_endpoints_from_monitoring" {
  security_group_id            = var.vpc_endpoint_security_group_id
  referenced_security_group_id = aws_security_group.monitoring.id
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
  description                  = "Allow monitoring instance to connect to VPC interface endpoints over TLS."
}

resource "aws_vpc_security_group_egress_rule" "prometheus_to_backend" {
  security_group_id            = aws_security_group.monitoring.id
  referenced_security_group_id = var.backend_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = 9090
  to_port                      = 9090
  description                  = "Allow Prometheus scrape traffic to backend workloads on 9090."
}

resource "aws_vpc_security_group_egress_rule" "node_exporter_to_backend" {
  security_group_id            = aws_security_group.monitoring.id
  referenced_security_group_id = var.backend_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = 9100
  to_port                      = 9100
  description                  = "Allow Prometheus scrape traffic to backend workloads on 9100."
}

resource "aws_vpc_security_group_ingress_rule" "backend_prometheus" {
  security_group_id            = var.backend_security_group_id
  referenced_security_group_id = aws_security_group.monitoring.id
  ip_protocol                  = "tcp"
  from_port                    = 9090
  to_port                      = 9090
  description                  = "Allow monitoring server to scrape backend metrics on 9090."
}

resource "aws_vpc_security_group_ingress_rule" "backend_node_exporter" {
  security_group_id            = var.backend_security_group_id
  referenced_security_group_id = aws_security_group.monitoring.id
  ip_protocol                  = "tcp"
  from_port                    = 9100
  to_port                      = 9100
  description                  = "Allow monitoring server to scrape backend node exporter on 9100."
}

locals {
  user_data = <<-EOT
    #!/bin/bash
    set -euo pipefail

    dnf update -y
    dnf install -y docker
    systemctl enable --now docker
    usermod -aG docker ec2-user

    curl -L "https://github.com/docker/compose/releases/download/v2.29.7/docker-compose-linux-x86_64" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose

    mkdir -p /opt/monitoring

    cat >/opt/monitoring/prometheus.yml <<'PROM'
    global:
      scrape_interval: 15s

    scrape_configs:
      - job_name: 'prometheus'
        static_configs:
          - targets: ['localhost:9090']
    PROM

    cat >/opt/monitoring/docker-compose.yml <<'COMPOSE'
    version: "3.9"
    services:
      grafana:
        image: grafana/grafana-oss:latest
        container_name: grafana
        restart: unless-stopped
        ports:
          - "3000:3000"
      prometheus:
        image: prom/prometheus:latest
        container_name: prometheus
        restart: unless-stopped
        command: ["--config.file=/etc/prometheus/prometheus.yml"]
        volumes:
          - /opt/monitoring/prometheus.yml:/etc/prometheus/prometheus.yml:ro
        ports:
          - "9090:9090"
      loki:
        image: grafana/loki:latest
        container_name: loki
        restart: unless-stopped
        command: ["-config.file=/etc/loki/local-config.yaml"]
        ports:
          - "3100:3100"
    COMPOSE

    cd /opt/monitoring
    /usr/local/bin/docker-compose up -d
  EOT
}

resource "aws_instance" "monitoring" {
  ami                         = data.aws_ssm_parameter.amazon_linux_2023_ami.value
  instance_type               = var.instance_type
  subnet_id                   = var.monitoring_subnet_id
  associate_public_ip_address = false
  iam_instance_profile        = aws_iam_instance_profile.monitoring.name
  vpc_security_group_ids      = [aws_security_group.monitoring.id]
  monitoring                  = true
  user_data                   = local.user_data

  root_block_device {
    volume_size = var.root_volume_size
    volume_type = "gp3"
    encrypted   = true
    kms_key_id  = var.kms_key_arn
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
    instance_metadata_tags      = "enabled"
  }

  tags = merge(
    var.tags,
    {
      Name = "${var.name_prefix}-monitoring-ec2"
      Tier = "monitoring"
    }
  )

  depends_on = [
    aws_iam_role_policy_attachment.ssm_core,
    aws_iam_role_policy.ec2_discovery
  ]
}
