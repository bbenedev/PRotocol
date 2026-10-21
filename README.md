# PRotocol

**Status: milestone 1 of 6 done.** The evaluator (the rules that turn branch requirements
and evidence into a verdict) is written and tested. It does not talk to GitHub yet.

```bash
npm install
npm run check      # type check + 51 tests, no network needed
```

Requires Node.js 22.18 or newer.

PRotocol is a planned read-only GitHub App that explains, in one check on every pull
request, whether it can be merged, what is missing, why a green check may not count
(it ran on an older commit or against an older base), and who needs to act. An optional
Discord bot gives maintainers the same view for every open pull request.

It does not enforce anything: GitHub rulesets and branch protection stay the authority.
It never runs code from the repository.

## Why this scope

The research in [docs/01-validacion.md](docs/01-validacion.md) found that enforcing checks
and approvals, approval policies, merge queues and auto-merge are already covered by GitHub
itself and by maintained open-source tools such as
[policy-bot](https://github.com/palantir/policy-bot) and [Kodiak](https://github.com/chdsbd/kodiak).
PRotocol focuses on what is left: explaining the state and the freshness of the evidence.

## Documents (in Spanish)

| | |
|---|---|
| [A. Validation](docs/01-validacion.md) | Competitors, gaps, go / revise / no-go |
| [B. Product](docs/02-producto.md) | Goals, non-goals, requirements, metrics |
| [C. Architecture](docs/03-arquitectura.md) | Components, verdict rules, event flow, schema, security |
| [D. Repository](docs/04-repositorio.md) | Layout, tooling, licence |
| [E. Plan](docs/05-plan.md) | Milestones with done criteria |
| [F. Readiness](docs/06-preparacion.md) | Open assumptions and decisions |

## License

Apache-2.0 (planned).
