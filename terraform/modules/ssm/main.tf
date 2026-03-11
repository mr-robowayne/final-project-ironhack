resource "aws_ssm_document" "this" {
  name            = var.name
  document_type   = var.document_type
  document_format = var.document_format
  target_type     = var.target_type
  content         = var.content
  tags            = var.tags
}
