output "alb_arn" {
  description = "Application Load Balancer ARN."
  value       = aws_lb.this.arn
}

output "dns_name" {
  description = "Application Load Balancer DNS name."
  value       = aws_lb.this.dns_name
}

output "zone_id" {
  description = "Route53 hosted zone ID of the ALB."
  value       = aws_lb.this.zone_id
}

output "security_group_id" {
  description = "Security group ID attached to the ALB."
  value       = aws_security_group.this.id
}

output "target_group_arn" {
  description = "Target group ARN used by the ALB."
  value       = aws_lb_target_group.this.arn
}

output "http_listener_arn" {
  description = "HTTP listener ARN."
  value       = try(aws_lb_listener.http_forward[0].arn, aws_lb_listener.http_redirect[0].arn)
}

output "https_listener_arn" {
  description = "HTTPS listener ARN if certificate is configured."
  value       = try(aws_lb_listener.https[0].arn, null)
}
