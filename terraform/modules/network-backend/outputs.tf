output "vpc_id" {
  description = "VPC ID."
  value       = module.vpc.id
}

output "vpc_cidr" {
  description = "VPC CIDR block."
  value       = module.vpc.cidr_block
}

output "internet_gateway_id" {
  description = "Internet Gateway ID."
  value       = module.internet_gateway.id
}

output "public_subnet_ids" {
  description = "IDs of public subnets."
  value       = module.subnets.public_subnet_ids
}

output "private_subnet_ids" {
  description = "IDs of private subnets."
  value       = module.subnets.private_subnet_ids
}

output "monitoring_subnet_ids" {
  description = "IDs of monitoring subnets."
  value       = module.subnets.monitoring_subnet_ids
}

output "public_route_table_id" {
  description = "Public route table ID."
  value       = module.route_tables.public_route_table_id
}

output "private_route_table_id" {
  description = "First private route table ID (legacy compatibility output)."
  value       = module.route_tables.private_route_table_ids[0]
}

output "private_route_table_ids" {
  description = "Private route table IDs."
  value       = module.route_tables.private_route_table_ids
}

output "monitoring_route_table_ids" {
  description = "Monitoring route table IDs."
  value       = module.route_tables.monitoring_route_table_ids
}

output "nat_gateway_ids" {
  description = "NAT gateway IDs."
  value       = module.nat_gateway.nat_gateway_ids
}

output "availability_zones" {
  description = "AZs used for subnet placement."
  value       = local.selected_azs
}
