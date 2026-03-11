output "vpc_id" {
  description = "VPC ID."
  value       = module.network.vpc_id
}

output "vpc_cidr" {
  description = "VPC CIDR."
  value       = module.network.vpc_cidr
}

output "internet_gateway_id" {
  description = "Internet Gateway ID."
  value       = module.network.internet_gateway_id
}

output "public_subnet_ids" {
  description = "Public subnet IDs."
  value       = module.network.public_subnet_ids
}

output "private_subnet_ids" {
  description = "Private subnet IDs."
  value       = module.network.private_subnet_ids
}

output "monitoring_subnet_ids" {
  description = "Monitoring subnet IDs."
  value       = module.network.monitoring_subnet_ids
}

output "public_route_table_id" {
  description = "Public route table ID."
  value       = module.network.public_route_table_id
}

output "private_route_table_id" {
  description = "Private route table ID."
  value       = module.network.private_route_table_id
}

output "private_route_table_ids" {
  description = "Private route table IDs."
  value       = module.network.private_route_table_ids
}

output "monitoring_route_table_ids" {
  description = "Monitoring route table IDs."
  value       = module.network.monitoring_route_table_ids
}

output "nat_gateway_ids" {
  description = "NAT gateway IDs."
  value       = module.network.nat_gateway_ids
}

output "availability_zones" {
  description = "AZs used by network module."
  value       = module.network.availability_zones
}

output "private_instance_ami_id" {
  description = "AMI ID used for private EC2 instances."
  value       = module.compute.ami_id
}

output "private_instance_ids" {
  description = "EC2 instance IDs in private subnets."
  value       = module.compute.instance_ids
}

output "private_instance_private_ips" {
  description = "Private IPs of EC2 instances in private subnets."
  value       = module.compute.instance_private_ips
}

output "private_instance_security_group_id" {
  description = "Security group ID attached to private EC2 instances."
  value       = module.compute.security_group_id
}

output "private_instance_profile_name" {
  description = "IAM instance profile name attached to private instances (if enabled)."
  value       = module.compute.instance_profile_name
}

output "alb_arn" {
  description = "Application Load Balancer ARN."
  value       = var.create_alb ? module.alb[0].alb_arn : null
}

output "alb_dns_name" {
  description = "Application Load Balancer DNS name."
  value       = var.create_alb ? module.alb[0].dns_name : null
}

output "alb_zone_id" {
  description = "Route53 hosted zone ID of the ALB."
  value       = var.create_alb ? module.alb[0].zone_id : null
}

output "alb_security_group_id" {
  description = "Security group ID attached to the ALB."
  value       = var.create_alb ? module.alb[0].security_group_id : null
}

output "alb_target_group_arn" {
  description = "Target group ARN used by the ALB."
  value       = var.create_alb ? module.alb[0].target_group_arn : null
}

output "alb_http_listener_arn" {
  description = "HTTP listener ARN."
  value       = var.create_alb ? module.alb[0].http_listener_arn : null
}

output "alb_https_listener_arn" {
  description = "HTTPS listener ARN if configured."
  value       = var.create_alb ? module.alb[0].https_listener_arn : null
}

output "alb_certificate_arn" {
  description = "Effective ACM certificate ARN used by ALB HTTPS listener."
  value       = local.effective_alb_certificate_arn
}

output "alb_public_fqdn" {
  description = "Public DNS name configured for ALB."
  value       = var.create_alb && var.create_alb_dns_record ? format("%s.%s", var.alb_dns_record_name, trimsuffix(var.alb_dns_zone_name, ".")) : null
}

output "alb_effective_ingress_prefix_list_ids" {
  description = "Effective prefix list IDs allowed to reach ALB."
  value       = local.effective_alb_ingress_prefix_list_ids
}

output "cloudfront_origin_facing_prefix_list_id" {
  description = "Managed prefix list ID for CloudFront origin-facing traffic."
  value       = var.create_alb && var.alb_allow_cloudfront_only ? data.aws_ec2_managed_prefix_list.cloudfront_origin_facing[0].id : null
}

output "vpc_endpoints_security_group_id" {
  description = "Security group ID attached to interface VPC endpoints."
  value       = var.create_vpc_endpoints ? module.vpc_endpoints[0].security_group_id : null
}

output "vpc_interface_endpoint_ids" {
  description = "Map of interface endpoint IDs by service."
  value       = var.create_vpc_endpoints ? module.vpc_endpoints[0].interface_endpoint_ids : {}
}

output "vpc_s3_gateway_endpoint_id" {
  description = "S3 gateway endpoint ID."
  value       = var.create_vpc_endpoints ? module.vpc_endpoints[0].s3_gateway_endpoint_id : null
}
