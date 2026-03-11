output "id" {
  description = "VPC ID."
  value       = aws_vpc.this.id
}

output "cidr_block" {
  description = "VPC CIDR block."
  value       = aws_vpc.this.cidr_block
}
