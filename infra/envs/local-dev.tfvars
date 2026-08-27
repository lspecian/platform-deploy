# Local dev. Each environment gets its own emulator instance on its own port,
# with its own account ID — see docs/adr/0002-emulator-constraints.md for why
# one shared instance with three accounts does not work.
target      = "local"
environment = "dev"
region      = "eu-central-1"
endpoint    = "http://localhost:4566"
