locals {
  nat_gateway_count = var.enable_nat_gateway ? (var.single_nat_gateway ? 1 : length(var.public_subnet_ids)) : 0
}

resource "aws_eip" "nat" {
  count = local.nat_gateway_count

  domain = "vpc"

  tags = merge(
    var.tags,
    {
      Name = format("%s-nat-eip-%d", var.name_prefix, count.index + 1)
    }
  )
}

resource "aws_nat_gateway" "this" {
  count = local.nat_gateway_count

  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = var.public_subnet_ids[var.single_nat_gateway ? 0 : count.index]

  tags = merge(
    var.tags,
    {
      Name = format("%s-nat-%d", var.name_prefix, count.index + 1)
    }
  )
}
