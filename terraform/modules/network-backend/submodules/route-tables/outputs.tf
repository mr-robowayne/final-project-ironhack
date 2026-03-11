output "public_route_table_id" {
  description = "Public route table ID."
  value       = aws_route_table.public.id
}

output "private_route_table_ids" {
  description = "Private route table IDs."
  value       = aws_route_table.private[*].id
}

output "monitoring_route_table_ids" {
  description = "Monitoring route table IDs."
  value       = aws_route_table.monitoring[*].id
}
