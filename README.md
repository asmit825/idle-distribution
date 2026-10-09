# idleDistribution

A browser game about building warehouse pallets: stack cartons high and stable without crushing them, against the clock. A Rust physics engine compiled to WebAssembly runs the stacking, and React + Three.js draw it.

**Play:** [idlemullet.com/idle-distribution](https://idlemullet.com/idle-distribution) · **Changes:** [Releases](https://github.com/asmit825/idle-distribution/releases) · **Domain rules:** [CONTEXT.md](./CONTEXT.md)

## Modes

| Mode | Goal |
|---|---|
| **1 · Floor Rush** | 60 seconds, 100 cartons in four waves of 25. Place as many as you can at high quality. |
| **2 · Conveyor** | Pick cartons off a moving line. Five overflow diversions trigger an Estop; ship before that happens. |
| **3 · Gallery** | Browse your saved pallets in 3D. |

Both game modes also have a **Sandbox** style with no clock or overflow. Sandbox rounds are left out of your stats.

**Scoring:** Quality starts at 100% and loses points for crushed cartons, overhang, and an off-center load, with a bonus for interlocked layers. Score = cases × quality. Grades: S ≥ 90, A ≥ 80, B ≥ 70, C ≥ 60.

**Controls:** Drag a carton onto the pallet. `R` rotates, `F` flips, arrows/WASD nudge, `Delete` removes. Drag empty space to orbit, scroll to zoom, right-drag to pan. On phones, use the D-pad.

**URL shortcuts:** `?mode=1`, `?mode=2`, or `?gallery=true`. Add `&seed=<number>` to replay a specific layout.

## Run it locally

Requires Node 22.12+ and stable Rust.

```sh
npm ci
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129 --locked
npm run dev
```

`npm run dev` builds the Wasm engine first. Rebuild with `npm run build:wasm` after Rust changes.

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Wasm + typecheck + production build into `dist/` |
| `npm test` | Rust, Wasm, unit, and browser tests (run `npx playwright install chromium` once) |
| `npm run test:all` | Adds benchmarks, touch e2e, perf, and cross-browser checks |
| `npm run version:next` | Show the version this commit would release as |

## Versioning

Versioning is automatic. Each deploy to `main` works out its version from the commit messages since the last release tag (`scripts/version.mjs`):

| Commit prefix | Example | Bump |
|---|---|---|
| `fix:` / `perf:` | `fix: carton clips through pallet` | 0.1.0 → 0.1.1 |
| `feat:` | `feat: add night shift mode` | 0.1.0 → 0.2.0 |
| `feat!:` or `BREAKING CHANGE:` in the body | `feat!: new save format` | 0.1.0 → 1.0.0 |
| `chore:` / `ci:` / `docs:` / `test:` / `refactor:` | `docs: update README` | no release |

CI then tags `vX.Y.Z` and publishes a [GitHub Release](https://github.com/asmit825/idle-distribution/releases) listing those commits. That's the version history. The landing page footer shows the version and build commit, e.g. `v0.1.0 · 86d266b`. When you squash-merge a PR, its title becomes the commit message, so give it a prefix too.

`npm run version:next` prints the version the current commit would ship as. Don't edit `version` in `package.json`; it only sets the first release, and Docker builds (which have no git history) fall back to it.

## Project layout

```
crates/pallet_sim/   Rust engine: catalog, stacking physics, scoring, Mode 1/2 rules
src/                 React app
  components/        Landing page, HUD, gallery, modals
  rendering/         Three.js scene: pallet, cartons, conveyor, warehouse
  controls/          Pointer input and placement
  storage/           IndexedDB saves and backup import/export
tests/               Browser, e2e, perf, and Wasm tests
server/              Cloudflare Worker (worker.js) and Express server (index.js)
```

## Deployment

Pushing to `main` runs CI (`.github/workflows/ci.yml`). If tests pass, it deploys `dist/` to Cloudflare Workers with `wrangler deploy` (see `wrangler.jsonc`), using secrets from Doppler. A `Dockerfile` is also available for self-hosting with the Express server on port 8080.
