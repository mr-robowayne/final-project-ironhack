output "ami_id" {
  description = "AMI ID used for private EC2 instances."
  value       = data.aws_ami.ubuntu.id
}

output "instance_ids" {
  description = "EC2 instance IDs in private subnets."
  value       = values(aws_instance.private)[*].id
}

output "instance_private_ips" {
  description = "Private IPs of EC2 instances in private subnets."
  value       = values(aws_instance.private)[*].private_ip
}

output "security_group_id" {
  description = "Security group ID attached to private EC2 instances."
  value       = aws_security_group.private_instances.id
}

output "instance_profile_name" {
  description = "IAM instance profile name attached to private instances (if enabled)."
  value       = var.enable_ssm_profile ? aws_iam_instance_profile.private_instances[0].name : null
}
