data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  selected_azs = length(var.availability_zones) > 0 ? var.availability_zones : slice(data.aws_availability_zones.available.names, 0, 2)
}

module "vpc" {
  source = "./submodules/vpc"

  name       = "${var.name_prefix}-vpc"
  cidr_block = var.vpc_cidr
  tags       = var.tags
}

module "internet_gateway" {
  source = "./submodules/internet-gateway"

  name   = "${var.name_prefix}-igw"
  vpc_id = module.vpc.id
  tags   = var.tags
}

module "subnets" {
  source = "./submodules/subnets"

  name_prefix                          = var.name_prefix
  vpc_id                               = module.vpc.id
  availability_zones                   = local.selected_azs
  public_subnet_cidrs                  = var.public_subnet_cidrs
  private_subnet_cidrs                 = var.private_subnet_cidrs
  monitoring_subnet_cidrs              = var.monitoring_subnet_cidrs
  monitoring_subnet_availability_zones = var.monitoring_subnet_availability_zones
  tags                                 = var.tags
}

module "nat_gateway" {
  source = "./submodules/nat-gateway"

  name_prefix        = var.name_prefix
  enable_nat_gateway = var.enable_nat_gateway
  single_nat_gateway = var.single_nat_gateway
  public_subnet_ids  = module.subnets.public_subnet_ids
  tags               = var.tags

  depends_on = [module.internet_gateway]
}

module "route_tables" {
  source = "./submodules/route-tables"

  name_prefix                         = var.name_prefix
  vpc_id                              = module.vpc.id
  internet_gateway_id                 = module.internet_gateway.id
  public_subnet_ids                   = module.subnets.public_subnet_ids
  private_subnet_ids                  = module.subnets.private_subnet_ids
  monitoring_subnet_ids               = module.subnets.monitoring_subnet_ids
  enable_nat_gateway                  = var.enable_nat_gateway
  enable_monitoring_nat_gateway_route = var.enable_monitoring_nat_gateway_route
  single_nat_gateway                  = var.single_nat_gateway
  nat_gateway_ids                     = module.nat_gateway.nat_gateway_ids
  tags                                = var.tags
}
