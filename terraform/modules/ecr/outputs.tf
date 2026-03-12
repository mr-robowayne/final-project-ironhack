output "repository_urls" {
  description = "Map of repository name to repository URL."
  value       = { for name, repo in aws_ecr_repository.this : name => repo.repository_url }
}

output "repository_arns" {
  description = "Map of repository name to repository ARN."
  value       = { for name, repo in aws_ecr_repository.this : name => repo.arn }
}

output "registry_url" {
  description = "ECR registry URL (account_id.dkr.ecr.region.amazonaws.com)."
  value       = length(aws_ecr_repository.this) > 0 ? split("/", values(aws_ecr_repository.this)[0].repository_url)[0] : ""
}
