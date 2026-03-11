output "public_subnet_ids" {
  description = "IDs of created public subnets."
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "IDs of created private subnets."
  value       = aws_subnet.private[*].id
}

output "monitoring_subnet_ids" {
  description = "IDs of created monitoring subnets."
  value       = aws_subnet.monitoring[*].id
}
