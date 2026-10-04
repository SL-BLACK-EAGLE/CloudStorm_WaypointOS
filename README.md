# Waypoint Delivery OS

**Team CloudStorm · Tech-Triathlon 2026 · Hackathon**

One plan, from the 16:00 order cutoff to the signature at the store door, for Waypoint Fresh, Style and Tech. The system covers 120 outlets, two depots (Peliyagoda and Kandy) and 60 vehicles, with or without mobile signal.

| Role | What they do in the app | Mode |
|---|---|---|
| Dispatcher | Plans the next run (auto-plan + drag-and-drop with rule checks), explains every deferral, publishes, watches live operations, reconciles offline conflicts, forecasts capacity, manages fleet and people | dark, desktop |
| Loader | Loads each vehicle in reverse stop order, flags shortfalls, signs the vehicle off | sunlight, tablet |
| Driver | Follows the run, records arrival and proof of delivery (signature, photo). Works offline for hours and syncs later | sunlight, phone (PWA) |
| Store manager | Orders before 16:00, sees the arrival time or why the order moved, confirms what arrived | light, desktop/tablet |

## For judges

| What | Where |
|---|---|
| **Live app** | **https://cloudstorm-waypointos.vercel.app** - sign in with the [demo accounts](#demo-accounts) |
| **Demo video** | _Link added at submission_ (5-8 min walkthrough of all four roles) |
| **Source code** | https://github.com/SL-BLACK-EAGLE/CloudStorm_WaypointOS |
| **Walkthrough** | [Judge walkthrough](#judge-walkthrough) - numbered steps, Mon 14:30 to Tue 09:00 |
| **Run it yourself** | `docker compose up --build` - see [Run it with Docker](#run-it-with-docker-recommended) |
| **Design delta** | [`DESIGN_DELTA.md`](DESIGN_DELTA.md), at the repository root |

The live demo starts at **Mon 22 Dec 2025, 14:30** with no plan published, so the walkthrough can be followed from the store's order onwards. The demo panel at `/demo` moves the business clock, and **Reset demo data** returns to the start at any time.

### Design delta - `DESIGN_DELTA.md` (repository root)

As requested at the kick-off session, [`DESIGN_DELTA.md`](DESIGN_DELTA.md) records every place where the running app departs from the 39 Designathon screens, and why. Everything not listed follows the designs, including tokens, copy, layouts and the role-to-mode mapping. It has three parts:

- **Added** - screens the designs did not include: sign-in, onboarding and approval; People and access; Fleet; the notification bell for every role; the store's Track and Receive tabs; printable load lists; the judge demo panel.
- **Changed** - one row per screen, giving what the design showed, what the build does, and why (for example D-06 ETAs, D-07 demand, SM-01 next delivery, D-03 blocked moves, D-04 fairness).
- **Realtime implementation note** - how the "live" screens are delivered.

### Documentation - `docs/`

| File | What it covers |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | Services in the cloud and in docker, a system diagram (mermaid), the outbox → Convex data flow, the planner and its improvement pass, the offline driver app, the business clock, demo reset, security |
| [`docs/architecture-diagram.jpeg`](docs/architecture-diagram.jpeg) | The architecture as one picture: the four roles, the Next.js app, backend services, data and integrations, and how cloud and local deployments map |
| [`docs/data-model.md`](docs/data-model.md) | The 33 Postgres tables in groups, an ER diagram (mermaid) and the invariants the code relies on |
| [`docs/er-diagram.jpeg`](docs/er-diagram.jpeg) | Full entity-relationship diagram of every table, with keys and relations |
| [`docs/api.md`](docs/api.md) | Route handlers (sync, uploads, files, notifications, jobs), the offline sync event shape, server actions by screen, realtime channels |
| [`docs/delivery-planning-flowchart.md`](docs/delivery-planning-flowchart.md) | The team's planning algorithm (F1-F9) as flowcharts, the parameters fitted on the dataset, and 38 hand-checkable test cases |
| [`docs/ai-disclosure.md`](docs/ai-disclosure.md) | AI tools used, what people did, what AI generated and how it was checked, AI inside the product, data handling |

## What's inside

- **Next.js 16.3** (App Router, server actions, Turbopack) · **React 19** · **Tailwind CSS v4** · **shadcn/ui**
- **Neon Postgres + Drizzle**: the system of record (33 tables), with a transactional outbox
- **Convex**: realtime push. The outbox relays change signals to Convex and screens re-read from Postgres, so business data never leaves Postgres
- **Clerk**: sign-in and sign-up. New users request a role and a dispatcher approves it
- **Upstash Redis** (rate limits, idempotency, relay lock) and **QStash** (signed, retried outbox sweep)
- **File storage** for signatures and photos: any S3 API (SeaweedFS in docker), or a Postgres table when no S3 endpoint is configured
- **Planner** (`packages/planner`): a TypeScript port of the team's Python delivery-planning algorithm, checked against it by golden-file parity tests (also in CI, on a synthetic operation). An improvement pass then fits more orders or saves trips, and every change is explained on the board.
- **Offline driver app**: Serwist service worker, IndexedDB outbox, UUIDv7 idempotent sync, conflict detection by stop version
- **Docker**: the whole stack, including Convex, starts with one command

Every document is listed under [For judges](#for-judges).

## Run it with Docker (recommended)

**Prerequisites:** Docker Desktop, a free Clerk account (development instance), and the competition dataset.

1. **Dataset.** The CSVs are confidential and not in this repository. Place the organisers' folders (`General Data`, `Training Data`, `Test Data`, `Submission Templates`) in `seed-data/data/` (see [seed-data/README.md](seed-data/README.md)).
2. **Configuration.** Copy `.env.example` to `.env` and set:
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` (Clerk dashboard → API keys, development instance)
   - `CONVEX_INSTANCE_SECRET` (run `openssl rand -hex 32`)
   - `CONVEX_SERVER_SECRET` (any long random string)

   Leave everything else as it is: the compose file points the app at the local services.
3. **Start:**

   ```sh
   docker compose up --build
   ```

   The first run builds the images, migrates and seeds Postgres, creates the four demo accounts in your Clerk instance, and deploys the Convex functions.
4. **Open** http://localhost:3000.

| Service | URL |
|---|---|
| App | http://localhost:3000 |
| Convex dashboard | http://localhost:6791 (admin key: `docker run --rm -v waypoint_convexkeys:/k alpine cat /k/admin_key`) |
| Postgres | `postgres://waypoint:waypoint@localhost:5433/waypoint` |

Re-running `docker compose up` keeps your data (the seed runs only on an empty database). To start again from scratch, use `docker compose down -v`, or **Reset demo data** on the demo panel.

## Demo accounts

Password for all four: **`Waypoint-Demo-2026`**. If Clerk asks for a verification code on a new device, enter **`424242`** (these are Clerk test addresses).

| Role | Email | Scope |
|---|---|---|
| Dispatcher | `dispatcher+clerk_test@waypoint-demo.lk` | Peliyagoda planning office |
| Store manager | `store+clerk_test@waypoint-demo.lk` | OUT006 · Fresh · Colombo |
| Loader | `loader+clerk_test@waypoint-demo.lk` | Peliyagoda dock |
| Driver | `driver+clerk_test@waypoint-demo.lk` | Peliyagoda fleet |

Use a separate browser profile or incognito window for each role so all four can stay signed in.

## Judge walkthrough

The seeded operation is **Tue 23 Dec 2025**, the Christmas peak. The app runs on a business clock that you move from the **demo panel** at `/demo` (any signed-in role can open it). Each step below starts by choosing a clock preset there.

1. **Mon 14:30: the store orders.** Sign in as the **store manager**. SM-01 shows the 16:00 cutoff countdown. Choose **Place Tue's orders**, press **Typical order** on the dry and chilled tabs, review, and submit. You get two confirmed orders; dry and chilled are separate because chilled goods need a reefer.
2. **Mon 16:05: the dispatcher plans.** Sign in as the **dispatcher**. The **Control tower** (D-01) shows demand against the scarce resources (reefers, vans, Fresh minutes, fuel). Press **Run auto-plan**: 80 of 88 orders on 19 trips in well under a second; the improvement pass saves a trip.
3. **Try to break a rule.** On the **Plan board** (D-03), drag a chilled order onto an ambient truck. The move is refused with the rule it breaks ("needs reefer, rule 2"). **Move to…** gives a keyboard alternative. A timing or fuel overrun (for example "trip 2 too late") can be overridden with a written reason; physical rules never can. The **Improvement pass** note above the board lists what the optimiser changed after the flowchart algorithm.
4. **Explain the deferrals.** Open **Deferrals** (D-04). Every order that did not fit shows why (unavoidable, capacity-forced or chosen), with its fairness history. Keep one with a reason, or swap it with another order. An outlet skipped two runs in a row is flagged red, and publishing waits for a recorded reason.
5. **Publish** (D-05). Pre-publish checks run, then loaders get load lists, drivers get their runs, and stores get an arrival time or a plain-language deferral notice (store: SM-03 tracking / SM-04 notice).
6. **Tue 01:30: the dock.** Sign in as the **loader**. The queue (L-01) → a load list in reverse stop order (L-02). Tick lines as loaded. Flag a **shortfall** with a photo (L-03), and sign-off locks. As the dispatcher, open **Live** (D-06) and choose **Send and warn store** or **Hold**. The loader can then sign off (L-04).
7. **Tue 03:30: the driver, offline.** On the demo panel, give the demo driver the vehicle that carries OUT006's order. Sign in as the **driver** on a phone-sized window and open the run. Now go **offline** (DevTools → Network → Offline):
   - depart, arrive, and record a delivery with units, the recipient's name and a signature
   - the outbox shows the events waiting on the phone
   - go back online: they sync in order, with the times as recorded
8. **Tue 06:30: live operations.** The demo panel moves the other trucks along their plans. On **Live** (D-06), trips are ranked by risk: not departed, long stop, late risk. Try **Warn store**, **Send new ETAs**, **Message driver** (it appears on the driver's phone immediately), and **Defer to Wed** on a late stop.
9. **The dead-zone conflict (DG-01 / DG-02).** Defer one of the demo driver's remaining stops. On the driver's phone, press **Tell dispatcher: I can deliver now**. In **Live → Reconciliation**, the dispatcher sees their own change next to the truck's reality and chooses **Deliver today** or **Keep the next run**. The answer arrives on the driver's phone and at the store.
   - **Deliver today · ask the store** (DG-03): the store's window may already have closed, so the store decides. Switch the store account to that outlet: it sees **Your order can come today after all** with **Accept today** or **Keep it for Wed**. Accepting cancels the move; the driver gets **Deliver now**, and the dispatcher sees the conflict settled. The store's order page keeps every message, with the replaced deferral notice struck through.
10. **Tue 09:00: the store confirms receipt.** As the store manager, open **Receive** (SM-05). It shows the driver's record (times, units, signature). Count what arrived; a short count or damage (with a photo) goes to the dispatcher's exception feed, where they can reply.
11. **Capacity** (D-07). The dispatcher's **Forecast** screen turns weekly demand into reefer trips needed per week against the 108 available. **Load forecast file** accepts the Datathon Task 2A submission CSV.
12. **Everyone's notifications.** Every role has a bell at the top right. Anything missed while offline or on another screen is there, with unread markers.

To see the store side of a delivery the driver just made, the demo panel can point the store account at any outlet. **Reset demo data** returns to Mon 14:30.

## Local development

```sh
pnpm install
docker compose up -d postgres s3 redis redis-rest convex convex-init   # backing services only
pnpm db:migrate && pnpm db:seed          # needs seed-data/ and the Clerk keys in .env
pnpm --filter web convex:push            # needs CONVEX_SELF_HOSTED_ADMIN_KEY in .env (see the Convex dashboard row above)
pnpm dev                                 # http://localhost:3000
```

For development, point `DATABASE_URL` in `.env` at either the local Postgres (`localhost:5433`) or a Neon branch.

| Command | What it does |
|---|---|
| `pnpm test` | Planner unit, flowchart, parity and optimiser tests (62) |
| `python tools/planner-oracle/export_synthetic.py` | Regenerate the synthetic parity fixtures with the Python oracle (CI checks they match) |
| `pnpm typecheck` | Strict TypeScript across the workspace |
| `pnpm --filter @waypoint/db inspect` | Row counts per table |

## Cloud deployment

| Piece | Service | Configuration |
|---|---|---|
| App | Vercel | Root `apps/web`; build command `pnpm exec convex deploy --cmd 'pnpm build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL` (deploys the Convex functions and sets their URL); no S3 variables, so files go to Postgres |
| Database | Neon | `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED`; run `pnpm db:migrate && pnpm db:seed` once (the seed also saves the demo baseline, so **Reset demo data** works without the CSVs) |
| Realtime | Convex Cloud | `CONVEX_DEPLOY_KEY`, `NEXT_PUBLIC_CONVEX_URL`; `npx convex deploy` from `apps/web`; set `CONVEX_SERVER_SECRET` in the Convex environment |
| One-shot setup | `scripts/deploy-cloud.mjs` | pushes the cloud keys from `.env` to Vercel (values via stdin, never printed), sets the Convex secret, migrates and seeds Neon; `--schedule <url>` creates the QStash relay schedule |
| Redis, jobs | Upstash | `UPSTASH_REDIS_REST_*`, `QSTASH_*`; then `APP_URL=https://… pnpm --filter web jobs:schedule` |
| Files | Postgres (default) or any S3 API | leave `S3_ENDPOINT` empty to store files in Postgres, or set the `S3_*` variables |

## Dataset and privacy

The competition data is confidential (booklet p.22):

- It is git-ignored, kept out of Docker images, and mounted into the seed job only at run time.
- All names and data in the app are the synthetic competition data.
- The repository stays private until the organisers confirm otherwise.

## Repository

```
apps/web                Next.js app (all four roles), Convex functions (apps/web/convex)
packages/planner        delivery planner (TypeScript port) + parity and flowchart tests
packages/db             Drizzle schema, migrations, seed
tools/planner-oracle    the team's Python planner (oracle for parity tests)
docs/                   architecture (+ diagram), data model (+ ER diagram), API, planning flowchart, AI disclosure
DESIGN_DELTA.md         where the build departs from the Designathon screens, and why
```
