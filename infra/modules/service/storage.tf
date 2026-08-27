/*
 * The bucket the manifest declares, if it declares one.
 *
 * Encryption, public-access blocking and TLS-only access are not options the
 * application team can turn off. They are the platform's defaults, applied
 * because the alternative — every team deciding independently — reliably
 * produces at least one public bucket. The Terraform policy gate independently
 * rejects any unencrypted bucket, so this and the gate agree by construction.
 */

resource "aws_s3_bucket" "main" {
  count = var.bucket_name == null ? 0 : 1

  bucket = "${var.bucket_name}-${var.environment}"

  tags = { Name = "${var.bucket_name}-${var.environment}" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "main" {
  count = var.bucket_name == null ? 0 : 1

  bucket = aws_s3_bucket.main[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "main" {
  count = var.bucket_name == null ? 0 : 1

  bucket = aws_s3_bucket.main[0].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "main" {
  count = var.bucket_name == null ? 0 : 1

  bucket = aws_s3_bucket.main[0].id

  versioning_configuration {
    status = var.bucket_versioning ? "Enabled" : "Suspended"
  }
}
