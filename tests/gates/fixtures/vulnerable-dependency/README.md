# vulnerable-dependency

A recorded `npm audit --json` payload containing a real critical advisory
(prototype pollution in minimist).

It is a recorded payload rather than an actual vulnerable `package.json` for two
reasons. It makes the test deterministic and offline — a fixture that installs
packages fails when the registry is slow, and a red build nobody can reproduce
is a build people learn to re-run. And the gate being tested is the platform's
*decision logic*: which severities block, whether waivers apply, what happens to
malformed output. `npm audit` itself is not ours to test.

The trade-off is real and worth stating: this does not prove `npm audit` runs
correctly in CI. That is covered by the pipeline running it against the actual
dependency tree on every build.
