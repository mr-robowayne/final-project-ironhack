variable "repositories" {
  description = "List of ECR repository names to create."
  type        = list(string)
}

variable "image_count_limit" {
  description = "Number of images to keep per repository (lifecycle policy)."
  type        = number
  default     = 10
}

variable "tags" {
  description = "Tags to apply to all ECR repositories."
  type        = map(string)
  default     = {}
}
