variable "name_prefix" {
  description = "Prefix used for naming compute resources."
  type        = string
}

variable "vpc_id" {
  description = "VPC ID where compute resources are created."
  type        = string
}

variable "vpc_cidr" {
  description = "VPC CIDR block used for internal egress rules."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs where instances are created (one instance per subnet)."
  type        = list(string)

  validation {
    condition     = length(var.private_subnet_ids) > 0
    error_message = "private_subnet_ids must contain at least one subnet ID."
  }
}

variable "availability_zones" {
  description = "Optional availability zones aligned to private_subnet_ids."
  type        = list(string)
  default     = []
}

variable "instance_type" {
  description = "EC2 instance type."
  type        = string
  default     = "t3a.medium"
}

variable "ami_owner" {
  description = "Owner account ID for Ubuntu AMI lookup."
  type        = string
  default     = "099720109477"
}

variable "ami_name_pattern" {
  description = "AMI name pattern for Ubuntu instances."
  type        = string
  default     = "ubuntu/images/hvm-ssd*/ubuntu-jammy-22.04-amd64-server-*"
}

variable "root_volume_size" {
  description = "Root volume size in GiB."
  type        = number
  default     = 30
}

variable "root_volume_type" {
  description = "Root volume type."
  type        = string
  default     = "gp3"
}

variable "enable_detailed_monitoring" {
  description = "Enable detailed monitoring."
  type        = bool
  default     = true
}

variable "enable_ssm_profile" {
  description = "Create and attach an SSM instance profile."
  type        = bool
  default     = true
}

variable "egress_https_cidrs_ipv4" {
  description = "IPv4 CIDRs allowed for outbound HTTPS from backend instances."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "private_egress_tcp_ports_to_vpc" {
  description = "TCP ports allowed from backend instances to VPC-internal destinations."
  type        = list(number)
  default     = [5432, 6379]
}

variable "allow_dns_to_vpc_resolver" {
  description = "Allow DNS (TCP/UDP 53) to the VPC resolver."
  type        = bool
  default     = true
}

variable "backend_secret_arns" {
  description = "Secrets Manager secret ARNs that backend EC2 instances are allowed to read (e.g. RDS managed secret)."
  type        = list(string)
  default     = []
}

variable "backend_kms_key_arns" {
  description = "KMS key ARNs that backend EC2 instances are allowed to use for decryption."
  type        = list(string)
  default     = []
}

variable "backend_ssm_parameter_paths" {
  description = "SSM Parameter Store path prefixes (without trailing slash) that backend EC2 instances are allowed to read (e.g. /patientsync/prod/data/rds)."
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Tags applied to all compute resources."
  type        = map(string)
  default     = {}
}
