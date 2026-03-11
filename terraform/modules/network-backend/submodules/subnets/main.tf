locals {
  public_subnet_count     = length(var.public_subnet_cidrs)
  private_subnet_count    = length(var.private_subnet_cidrs)
  monitoring_subnet_count = length(var.monitoring_subnet_cidrs)
  monitoring_subnet_azs = length(var.monitoring_subnet_availability_zones) > 0 ? var.monitoring_subnet_availability_zones : (
    [for _ in var.monitoring_subnet_cidrs : var.availability_zones[0]]
  )
}

resource "aws_subnet" "public" {
  count = local.public_subnet_count

  vpc_id                  = var.vpc_id
  cidr_block              = var.public_subnet_cidrs[count.index]
  availability_zone       = var.availability_zones[count.index]
  map_public_ip_on_launch = true

  tags = merge(
    var.tags,
    {
      Name = format("%s-public-%d", var.name_prefix, count.index + 1)
      Tier = "public"
    }
  )
}

resource "aws_subnet" "private" {
  count = local.private_subnet_count

  vpc_id                  = var.vpc_id
  cidr_block              = var.private_subnet_cidrs[count.index]
  availability_zone       = var.availability_zones[count.index]
  map_public_ip_on_launch = false

  tags = merge(
    var.tags,
    {
      Name = format("%s-private-%d", var.name_prefix, count.index + 1)
      Tier = "private"
    }
  )
}

resource "aws_subnet" "monitoring" {
  count = local.monitoring_subnet_count

  vpc_id                  = var.vpc_id
  cidr_block              = var.monitoring_subnet_cidrs[count.index]
  availability_zone       = local.monitoring_subnet_azs[count.index]
  map_public_ip_on_launch = false

  tags = merge(
    var.tags,
    {
      Name = format("%s-monitoring-%d", var.name_prefix, count.index + 1)
      Tier = "monitoring"
    }
  )
}
