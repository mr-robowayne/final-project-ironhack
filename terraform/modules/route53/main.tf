locals {
  normalized_zone_name = trimsuffix(var.zone_name, ".")
}

data "aws_route53_zone" "this" {
  name         = "${local.normalized_zone_name}."
  private_zone = var.private_zone
}

resource "aws_route53_record" "frontend" {
  count = var.create_record ? 1 : 0

  zone_id = data.aws_route53_zone.this.zone_id
  name    = var.record_name
  type    = "CNAME"
  ttl     = var.record_ttl
  records = [var.record_value]
}
