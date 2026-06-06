# Contributing to Kitto

Thanks for your interest in Kitto. This document covers the conventions the codebase
follows. Note that Kitto is published under a [personal-use license](LICENSE) — it is
source-available, not open-source — so please open an issue to discuss any substantial
change before sending a pull request.

## Development setup

See the [README](README.md#run-it-development) for prerequisites and how to run the app
in development (`pnpm install` → `pnpm tauri:dev`).

## Conventions

- **TypeScript strict mode.** Rust must be `clippy`-clean with no `unwrap()` in
  non-test code.
- **The state machine is pure and unit-tested** — no rendering or IO inside it.
  See [`src/state/machine.ts`](src/state/machine.ts) and its tests.
- **Conventional Commits**, small focused PRs.
- **No telemetry, ever.** No network calls.
- **Package manager: pnpm only** (never npm — a `pnpm-lock.yaml` is committed).
- **Dependency 7-day gap.** Never pin a dependency (pnpm or Rust crate) released within
  the last 7 days. Pick the newest version that is at least 7 days old — a quarantine
  window against freshly-published compromised or broken releases.

## Tests

```sh
pnpm test          # state-machine + logic unit tests (vitest)
pnpm test:watch    # watch mode
```

## Architecture

The product spec and design notes live in [`docs/`](docs/):

- [`docs/KITTO_SPEC.md`](docs/KITTO_SPEC.md) — product spec and milestone plan.
- [`docs/KITTO_AMBIENT.md`](docs/KITTO_AMBIENT.md) — the ambient-life layer.
