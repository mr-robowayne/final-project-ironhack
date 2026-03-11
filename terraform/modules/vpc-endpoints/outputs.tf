output "security_group_id" {
  description = "Security group ID attached to interface endpoints."
  value       = aws_security_group.this.id
}

output "interface_endpoint_ids" {
  description = "Map of interface endpoint IDs by service key."
  value       = { for service, endpoint in aws_vpc_endpoint.interface : service => endpoint.id }
}

output "interface_endpoint_dns_entries" {
  description = "Map of interface endpoint DNS entries by service key."
  value       = { for service, endpoint in aws_vpc_endpoint.interface : service => endpoint.dns_entry }
}

output "s3_gateway_endpoint_id" {
  description = "S3 gateway endpoint ID."
  value       = try(aws_vpc_endpoint.s3_gateway[0].id, null)
}
