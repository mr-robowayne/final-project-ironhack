locals {
  normalized_certificate_arn = var.certificate_arn == null ? null : trimspace(var.certificate_arn)
  enable_https_listener      = var.enforce_https || (local.normalized_certificate_arn != null && length(local.normalized_certificate_arn) > 0)
  # CloudFront-origin prefix lists have high rule weights; avoid extra HTTP SG rules
  # when we already enforce HTTPS + redirect.
  enable_http_ingress = !(local.enable_https_listener && var.redirect_http_to_https)
  ingress_ipv4_map = {
    for idx, cidr in var.allowed_ingress_cidrs_ipv4 : tostring(idx) => cidr
  }
  ingress_ipv6_map = {
    for idx, cidr in var.allowed_ingress_cidrs_ipv6 : tostring(idx) => cidr
  }
  ingress_prefix_list_map = {
    for idx, prefix_list_id in var.allowed_ingress_prefix_list_ids : tostring(idx) => prefix_list_id
  }
}

resource "aws_security_group" "this" {
  name        = "${var.name_prefix}-alb-sg"
  description = "Security group for internet-facing ALB."
  vpc_id      = var.vpc_id
  tags = merge(
    var.tags,
    {
      Name = "${var.name_prefix}-alb-sg"
      Tier = "public"
    }
  )
}

resource "aws_vpc_security_group_ingress_rule" "http_ipv4" {
  for_each = local.enable_http_ingress ? local.ingress_ipv4_map : {}

  security_group_id = aws_security_group.this.id
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = each.value
  description       = "Allow HTTP from IPv4 CIDR ${each.value}"
}

resource "aws_vpc_security_group_ingress_rule" "http_ipv6" {
  for_each = local.enable_http_ingress ? local.ingress_ipv6_map : {}

  security_group_id = aws_security_group.this.id
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv6         = each.value
  description       = "Allow HTTP from IPv6 CIDR ${each.value}"
}

resource "aws_vpc_security_group_ingress_rule" "http_prefix_list" {
  for_each = local.enable_http_ingress ? local.ingress_prefix_list_map : {}

  security_group_id = aws_security_group.this.id
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  prefix_list_id    = each.value
  description       = "Allow HTTP from prefix list ${each.value}"
}

resource "aws_vpc_security_group_ingress_rule" "https_ipv4" {
  for_each = local.enable_https_listener ? local.ingress_ipv4_map : {}

  security_group_id = aws_security_group.this.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = each.value
  description       = "Allow HTTPS from IPv4 CIDR ${each.value}"
}

resource "aws_vpc_security_group_ingress_rule" "https_ipv6" {
  for_each = local.enable_https_listener ? local.ingress_ipv6_map : {}

  security_group_id = aws_security_group.this.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv6         = each.value
  description       = "Allow HTTPS from IPv6 CIDR ${each.value}"
}

resource "aws_vpc_security_group_ingress_rule" "https_prefix_list" {
  for_each = local.enable_https_listener ? local.ingress_prefix_list_map : {}

  security_group_id = aws_security_group.this.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  prefix_list_id    = each.value
  description       = "Allow HTTPS from prefix list ${each.value}"
}

resource "aws_vpc_security_group_egress_rule" "all_ipv4" {
  security_group_id = aws_security_group.this.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
  description       = "Allow all outbound IPv4 traffic."
}

resource "aws_vpc_security_group_egress_rule" "all_ipv6" {
  security_group_id = aws_security_group.this.id
  ip_protocol       = "-1"
  cidr_ipv6         = "::/0"
  description       = "Allow all outbound IPv6 traffic."
}

resource "aws_lb" "this" {
  name               = "${var.name_prefix}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.this.id]
  subnets            = var.public_subnet_ids
  tags               = var.tags
}

resource "aws_lb_target_group" "this" {
  name                 = "${var.name_prefix}-tg"
  port                 = var.target_port
  protocol             = "HTTP"
  target_type          = "instance"
  vpc_id               = var.vpc_id
  deregistration_delay = var.deregistration_delay

  health_check {
    enabled             = true
    protocol            = "HTTP"
    path                = var.health_check_path
    matcher             = var.health_check_matcher
    healthy_threshold   = 3
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 15
  }

  tags = var.tags
}

resource "aws_lb_target_group_attachment" "this" {
  for_each = {
    for idx, instance_id in var.target_instance_ids : tostring(idx) => instance_id
  }

  target_group_arn = aws_lb_target_group.this.arn
  target_id        = each.value
  port             = var.target_port
}

resource "aws_lb_listener" "http_forward" {
  count = local.enable_https_listener && var.redirect_http_to_https ? 0 : 1

  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this.arn
  }
}

resource "aws_lb_listener" "http_redirect" {
  count = local.enable_https_listener && var.redirect_http_to_https ? 1 : 0

  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  count = local.enable_https_listener ? 1 : 0

  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = var.ssl_policy
  certificate_arn   = local.normalized_certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this.arn
  }
}
