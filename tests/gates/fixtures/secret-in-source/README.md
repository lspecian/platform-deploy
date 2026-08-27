# secret-in-source

Breaks exactly one rule: credentials committed to source.

## Why these are templates

The obvious way to build this fixture is to commit a fabricated AWS key. That is
what it did at first, and it was wrong three times over.

**GitHub push protection rejects the push.** Correctly — it cannot tell a
fabricated key from a real one, and neither can any other scanner. That is the
entire point of the fixture.

**It forces the repository's own scanners to be weakened.** Committing a
credential means adding it to a gitleaks allowlist and a semgrep ignore file,
because otherwise the repository's own secret gate is permanently red. Those
exclusions are then load-bearing and permanent, and every future secret in that
path is invisible.

**Fabricated keys are often allowlisted anyway.** The first version used AWS's
canonical documentation key, `AKIAIOSFODNN7EXAMPLE`, which scanners deliberately
ignore so that copying an example out of the docs does not fail a build. The
fixture matched nothing and the test failed — which is how this was found.

So the fixture stores placeholders. `guardrails.test.ts` assembles a
credential-shaped value from fragments at runtime, writes it into a temporary
directory outside the repository, and runs the real scanners against that.

The result: this repository contains no credential-shaped string anywhere, needs
no scanner exclusions, and the guardrail is still verified against the real
tools on every commit.

## The two files

Two, because the scanners key on different things:

- `credentials.yaml.template` — gitleaks matches on keyword proximity
  (`aws_access_key_id:` adjacent to a key-shaped value). A committed config file
  is how these leak in practice.
- `config.ts.template` — semgrep's rule matches the `AKIA` key shape anywhere in
  a TypeScript file, regardless of assignment style.
