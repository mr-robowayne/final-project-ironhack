bucket         = "patientsync-prod-tfstate"
key            = "deploy-documents/terraform.tfstate"
region         = "eu-central-2"
dynamodb_table = "patientsync-prod-tf-locks"
encrypt        = true
assume_role = {
  role_arn = "arn:aws:iam::648786395667:role/patientsync-prod-tf-backend-role"
}
