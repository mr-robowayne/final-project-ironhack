variable "name" {
  description = "Name tag for the internet gateway."
  type        = string
}

variable "vpc_id" {
  description = "VPC ID where the internet gateway is attached."
  type        = string
}

variable "tags" {
  description = "Tags applied to the internet gateway."
  type        = map(string)
  default     = {}
}
