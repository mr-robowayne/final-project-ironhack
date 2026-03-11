locals {
  private_route_table_count    = length(var.private_subnet_ids)
  monitoring_route_table_count = length(var.monitoring_subnet_ids)
}

resource "aws_route_table" "public" {
  vpc_id = var.vpc_id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = var.internet_gateway_id
  }

  tags = merge(
    var.tags,
    {
      Name = "${var.name_prefix}-public-rt"
    }
  )
}

resource "aws_route_table" "private" {
  count = local.private_route_table_count

  vpc_id = var.vpc_id

  tags = merge(
    var.tags,
    {
      Name = format("%s-private-rt-%d", var.name_prefix, count.index + 1)
    }
  )
}

resource "aws_route" "private_default" {
  count = var.enable_nat_gateway ? local.private_route_table_count : 0

  route_table_id         = aws_route_table.private[count.index].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = var.nat_gateway_ids[var.single_nat_gateway ? 0 : count.index]
}

resource "aws_route_table_association" "public" {
  count = length(var.public_subnet_ids)

  subnet_id      = var.public_subnet_ids[count.index]
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private" {
  count = local.private_route_table_count

  subnet_id      = var.private_subnet_ids[count.index]
  route_table_id = aws_route_table.private[count.index].id
}

resource "aws_route_table" "monitoring" {
  count = local.monitoring_route_table_count

  vpc_id = var.vpc_id

  tags = merge(
    var.tags,
    {
      Name = format("%s-monitoring-rt-%d", var.name_prefix, count.index + 1)
    }
  )
}

resource "aws_route" "monitoring_default" {
  count = var.enable_nat_gateway && var.enable_monitoring_nat_gateway_route ? local.monitoring_route_table_count : 0

  route_table_id         = aws_route_table.monitoring[count.index].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = var.nat_gateway_ids[var.single_nat_gateway ? 0 : (count.index % length(var.nat_gateway_ids))]
}

resource "aws_route_table_association" "monitoring" {
  count = local.monitoring_route_table_count

  subnet_id      = var.monitoring_subnet_ids[count.index]
  route_table_id = aws_route_table.monitoring[count.index].id
}
