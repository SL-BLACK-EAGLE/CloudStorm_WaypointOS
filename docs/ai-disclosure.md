# AI disclosure

Team CloudStorm used AI tools openly. This page says what was AI-assisted, what people did, and how AI output was checked. It is kept up to date as the build goes on.

## Tools

- **Claude Code (Claude Opus 5.5)**: wrote most of the application code, tests, Docker setup and these docs, working in the repository under the team's direction.
- **Claude Design and the Figma MCP**: used for the Designathon screens that this build implements.

## What people did

- Read the challenge booklet and decided the product scope, the four roles and the walkthrough.
- **Designed the delivery-planning algorithm.** A teammate wrote the Python planner (`tools/planner-oracle`) and the flowchart (`docs/delivery-planning-flowchart.md`). The TypeScript planner is a port of that work, checked against it.
- Made the architecture and product decisions when asked:
  - the planner approach (TS port + Python oracle)
  - the sign-up model (request, then dispatcher approval)
  - the repository layout
  - which managed services to use
- Reviewed the screens in the browser, tried the flows, and asked for changes (for example, a notification bell for every role, including drivers).
- Own the accounts and secrets (Clerk, Neon, Convex, Upstash). No secret was pasted into prompts or committed.

## What AI generated, and how it was checked

| Area | AI-generated | Checked by |
|---|---|---|
| Planner (TS port) | Code and tests | Golden-file parity with the Python oracle on the same inputs; the 2B allocation passes the organisers' `check_allocation.py`; 62 unit, flowchart, parity and optimiser tests; parity also runs in CI on a synthetic operation, because the real data may not leave the team |
| Improvement pass (optimiser) | Code and tests | Tested guarantees on every synthetic and real plan: never drops a served order, never lowers served priority, every vehicle-day passes every rule, deterministic |
| Database schema, seed, migrations | Code | Seeding the booklet data locally and on Neon; `pnpm --filter @waypoint/db inspect` counts |
| Screens and server actions | Code | TypeScript strict typecheck on every change; each flow driven in a real browser, with visible results (toasts, state changes, notifications on the other role's screen) |
| Offline sync and conflicts | Code | Airplane-mode test: events queued offline, synced on reconnect, a replay returns `DUPLICATE`, and a stop changed while offline opens a DG-02 conflict |
| Realtime (outbox → Convex) | Code | A dispatcher message appears on the driver's open page without a reload; Convex `signals` table inspected |
| Docker stack | Dockerfile and compose | A clean `docker compose up`: all jobs exit 0, the app is healthy, and auto-plan gives the same result as in development |
| Docs | Text | Read by the team; every figure is checked against the code |

AI output was never accepted just because it compiled. A change counted as done only after it had been exercised in the running app.

## AI inside the product

The app does **not** call an LLM at runtime today:

- **Deferral explanations** ("why was my order moved?") come from deterministic templates filled with the planner's facts (`apps/web/src/lib/explain.ts`). Every sentence can be traced to a rule, a number or a dispatcher's recorded reason.

- **Forecasts and service-time predictions** come from the separate Datathon models (Task 1, Task 2A), loaded as files and labelled as such on screen.

## Data

The competition dataset is confidential (booklet p.22):

- It is **git-ignored** (`seed-data/`) and **excluded from Docker images** (`.dockerignore`); the seed job mounts it read-only at run time.
- While building the seed and the upload parsers, Claude Code read file headers and a few sample rows in the local session. The data was not uploaded anywhere else, and the hosted databases hold it only for the running demo.
