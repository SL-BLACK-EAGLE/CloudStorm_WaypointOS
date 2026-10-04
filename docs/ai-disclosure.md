# AI disclosure

Team CloudStorm built Waypoint Delivery OS with **Claude Code as a pair programmer**. The team owned the problem, the planning algorithm, the designs, the specification, the decisions and the quality bar. Claude Code wrote most of the application code to that specification, under review. This page says who did what and how AI output was checked. Every AI-assisted commit carries a `Co-Authored-By` line, so the repository history matches this page.

## Tools

- **Claude Code (Claude Opus 5.5)**: implementation, tests, Docker setup and first drafts of these docs, working in the repository under the team's direction.
- **Claude Design and the Figma MCP**: used while producing the Designathon screens that this build implements.

## Who did what

| Area | The team | Claude Code |
|---|---|---|
| **Problem and scope** | Analysed the booklet; chose the scope, the four roles and the end-to-end walkthrough; audited the finished build against the booklet and the Designathon screens before submission | - |
| **Specification** | Wrote the hackathon specification the build follows: the mandated stack, one job per managed service, the system-of-record entities, the repository layout, the planner requirements, the offline-first rules, every role's screens, the Docker one-command start and the quality bar | Worked from it; asked the team before any trade-off |
| **Delivery-planning algorithm** | **Designed the algorithm.** A teammate wrote the Python planner (`tools/planner-oracle`) and the complete flowchart (`docs/delivery-planning-flowchart.md`, F1–F9), with parameters fitted on the dataset and 38 test cases computed or traced by hand | Ported it to TypeScript, proved the port matches the team's planner with golden-file parity tests, and added the improvement pass on top |
| **Datathon models** | Built the Datathon Task 1 and Task 2A (demand forecast) models in the Datathon phase | Built the D-07 upload that reads the Task 2A submission CSV |
| **Product design** | Designed the 39 Designathon screens, the tokens and the three modes (light, dark, sunlight) and which role uses which | Implemented the screens; every departure is recorded in `DESIGN_DELTA.md` |
| **Architecture** | Chose the architecture: TS port checked by the Python oracle, sign-up by request with dispatcher approval, business data only in Postgres with Convex carrying change signals, the demo business clock. Added the architecture and ER diagram images in `docs/` | Implemented it and drafted `docs/architecture.md` |
| **Database schema, seed, migrations** | Specified the entities and the rules the data must enforce (roles and scope, deferral reasons and fairness, idempotent sync, a transactional outbox, an audit trail); checked seeded counts against the dataset | Wrote the Drizzle schema, migrations and seed code |
| **Screens and server actions** | Reviewed every screen in the browser against the designs and drove each flow; asked for changes and additions - a notification bell for every role, guided tours, phone-size layouts, and full alignment with the Designathon screens (which brought in DG-03 store consent) | Wrote the pages, components and server actions |
| **Testing and bug finding** | Tested as all four roles and reported defects - for example the plan and deferral pages failing after publish, and the units stepper overflowing on a phone | Fixed them, with typecheck, lint, tests and a browser re-check before each commit |
| **Deployment and operations** | Own every account and secret (Clerk, Neon, Convex, Upstash, Vercel); ran the cloud setup and deployment; set the rule that `main` only changes through reviewed pull requests with passing CI | Wrote the Dockerfile, compose stack, CI workflow and the setup script, which never prints a secret |
| **Submission** | Recorded the demo video; reviewed and edited the README for judges | Drafted the README, DESIGN_DELTA and docs for the team to edit |

## How AI output was checked

| Area | Checked by |
|---|---|
| Planner (TS port) | Golden-file parity with the team's Python planner on the same inputs; the 2B allocation passes the organisers' `check_allocation.py`; 62 unit, flowchart, parity and optimiser tests; parity also runs in CI on a synthetic operation, because the real data may not leave the team |
| Improvement pass | Tested guarantees on every synthetic and real plan: never drops a served order, never lowers served priority, every vehicle-day passes every rule, deterministic |
| Database schema, seed, migrations | Seeding the booklet data locally and on Neon; `pnpm --filter @waypoint/db inspect` counts compared with the CSVs |
| Screens and server actions | TypeScript strict typecheck on every change; each flow driven in a real browser by the team, with visible results (toasts, state changes, notifications on the other role's screen); driver and loader screens checked at phone size |
| Offline sync and conflicts | Airplane-mode test: events queued offline, synced on reconnect, a replay returns `DUPLICATE`, and a stop changed while offline opens a DG-02 conflict |
| Realtime (outbox → Convex) | A dispatcher message appears on the driver's open page without a reload; the Convex `signals` table inspected |
| Docker stack | A clean `docker compose up`: all jobs exit 0, the app is healthy, and auto-plan gives the same result as in development |
| Docs | Read and edited by the team; every figure checked against the code |

AI output was never accepted just because it compiled. A change counted as done only after it had been exercised in the running app.

## AI inside the product

The app does **not** call an LLM at runtime:

- **Deferral explanations** ("why was my order moved?") come from deterministic templates filled with the planner's facts (`apps/web/src/lib/explain.ts`). Every sentence can be traced to a rule, a number or a dispatcher's recorded reason.
- **Demand forecasts** on D-07 come from the team's Datathon Task 2A model, uploaded as its submission CSV and labelled as such on screen; without it the screen shows a labelled seasonal-naive baseline.
- **ETAs and late-risk flags** use the expected schedule from the team's flowchart (traffic by hour, road disruption by district, and a service-time formula fitted on 2024–2025 deliveries).

## Data

The competition dataset is confidential (booklet p.22):

- It is **git-ignored** (`seed-data/`) and **excluded from Docker images** (`.dockerignore`); the seed job mounts it read-only at run time.
- While building the seed and the upload parsers, Claude Code read file headers and a few sample rows in the local session. The data was not uploaded anywhere else, and the hosted databases hold it only for the running demo.
