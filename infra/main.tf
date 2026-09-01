/*
 * The service manifest drives the infrastructure.
 *
 * No application developer writes HCL. They edit `service.yaml`; this file
 * turns that document into inputs, and the module below turns those inputs
 * into cloud resources. Adding a bucket to a service is a four-line change to
 * a YAML file that a teammate can review, not a Terraform pull request.
 *
 * The manifest is schema-validated before it ever reaches Terraform — by the
 * CLI locally, by the pre-commit hook, and by a blocking pipeline gate — so
 * the lookups below can assume the shape is already correct.
 */
locals {
  # Absolute when the deploy script passes one, module-relative otherwise.
  manifest_file = startswith(var.manifest_path, "/") ? var.manifest_path : "${path.module}/${var.manifest_path}"
  manifest      = yamldecode(file(local.manifest_file))

  runtime = local.manifest.runtime
  env     = try(local.manifest.environments[var.environment], {})

  # Defaults live here rather than in the schema so that omitting a field means
  # "give me the platform default" and the default can change centrally.
  cpu      = try(local.runtime.cpu, 256)
  memory   = try(local.runtime.memory, 512)
  port     = local.runtime.port
  replicas = try(local.env.replicas, 1)

  liveness  = try(local.runtime.healthcheck.liveness, "/healthz")
  readiness = try(local.runtime.healthcheck.readiness, "/readyz")

  bucket = try(local.manifest.resources.bucket, null)

  # A host port unique to this service *and* environment.
  #
  # The emulator publishes every task port onto the host, so any two tasks
  # asking for the same one collide and the second silently never starts. An
  # offset per environment was enough while there was one service; with several
  # it has to vary by service too.
  #
  # Derived from a hash so it needs no central registry — a platform that
  # requires someone to hand out port numbers is a platform with a queue in
  # front of it. The value is irrelevant to anyone: traffic reaches the service
  # through its load balancer, which routes to the container address directly.
  # This exists only to stop the host publish colliding.
  host_port = 30000 + (parseint(substr(md5("${local.manifest.name}-${var.environment}"), 0, 6), 16) % 20000)

  # Environment-scoped so the same manifest yields non-colliding resources in
  # each environment, and so a name in a log or console makes it obvious which
  # environment it belongs to.
  name_prefix = "${local.manifest.name}-${var.environment}"
}

module "service" {
  source = "./modules/service"

  name        = local.manifest.name
  name_prefix = local.name_prefix
  owner       = local.manifest.owner
  environment = var.environment
  region      = var.region
  is_local    = local.is_local
  endpoint    = var.endpoint
  host_port   = local.host_port

  image    = var.image
  port     = local.port
  cpu      = local.cpu
  memory   = local.memory
  replicas = local.replicas

  liveness_path  = local.liveness
  readiness_path = local.readiness

  vpc_cidr          = var.vpc_cidr
  bucket_name       = try(local.bucket.name, null)
  bucket_versioning = try(local.bucket.versioning, false)
}
