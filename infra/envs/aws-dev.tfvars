# Real AWS. Manual dispatch only — nothing in CI targets this file.
# Everything it creates is tagged Platform=tarmac and removable with `make destroy-aws`.
target      = "aws"
environment = "dev"
region      = "eu-central-1"
