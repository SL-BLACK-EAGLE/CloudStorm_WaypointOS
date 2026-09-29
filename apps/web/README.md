# apps/web

The Waypoint Delivery OS web app: all four roles, server actions, route handlers and the Convex functions (`convex/`).

Setup, the demo accounts and the judge walkthrough are in the [root README](../../README.md). The architecture is described in [docs/architecture.md](../../docs/architecture.md).

| Folder | What's there |
|---|---|
| `src/app/dispatch` | D-01 to D-07, reconciliation, fleet, people |
| `src/app/dock` | L-01 to L-04 |
| `src/app/drive` | DR-01 to DR-05 and DG-01 (offline PWA) |
| `src/app/store` | SM-01 to SM-05 |
| `src/app/api` | sync, uploads, files, notifications, QStash jobs |
| `src/lib/server` | domain logic (planning, dock, drive, live, store, forecast, fleet, people, relay) |
| `src/lib/offline` | IndexedDB outbox, sync, business clock on the phone |
| `convex/` | realtime signals (schema, query, relay mutation) |
