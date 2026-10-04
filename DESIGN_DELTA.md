# Design delta

This file records where the running app departs from the Designathon screens (39 screens, from P-00 to DG-03) and why. Everything else follows the designs, including the tokens (DS-00 light/dark/sunlight), copy, layouts and the role → mode mapping.

## Added (not in the design files)

| What | Why |
|---|---|
| Sign-in, sign-up, onboarding (choose role + scope) and a pending-approval screen | New accounts ask for a role; a dispatcher approves it with its scope. Nobody gets a role by signing up. |
| People and access (`/dispatch/users`) | Approve or decline requests, change role and scope, disable accounts. Every change is audited. |
| Fleet (`/dispatch/fleet`) | Workshop status per vehicle and date, fuel against the weekly quota, and trips. The design only showed workshop vehicles as a count on D-01. |
| Notification bell for every role (top right) | Anything missed while offline or away from the screen can be found again: the latest 30 notifications, with unread markers and click-through. |
| Store "Track" and "Receive" tabs | SM-03 and SM-05 were designed for a single order. The tabs list every order and every delivery to confirm. |
| Printable load lists (`/dispatch/print/{plan}`) | A paper backup for the dock. |
| Judge demo panel (`/demo`) | Moves the business clock through the 22–23 Dec walkthrough, picks the driver's vehicle and the store's outlet, simulates the other trucks and resets the data. The seeded operation is in the past, so without this panel judges could not watch a live run. |

## Changed

| Screen | Design | Build | Why |
|---|---|---|---|
| D-06 exceptions | One card per late-risk stop | One card per trip, listing its late stops with "Warn" and "Defer" on each line | With a realistic fleet at 06:30 there were 20+ cards; grouping by trip keeps the feed to "only what needs a person". |
| D-06 ETA | "Planned arrival + drift" | The planner's EXPECTED schedule: traffic by hour, road disruption by district and a service time fitted on 2024-2025 deliveries, re-timed (F9) after each recorded stop | Planned arrival + drift ignores traffic. On the 2026 hold-out the expected schedule halves the arrival error (MAE 19.3 vs 38.7 min) and its 20-min flag catches 85% of real late arrivals. |
| DG-02 / DG-03 store consent | "Deliver today · ask the store", then the store accepts or keeps the next run | Built as designed. Once the store has been asked, the dispatcher also gets **Deliver today without waiting** (with a confirmation) | For a store that already agreed by phone, so the driver is not kept parked. The decision is written to the audit log. |
| D-07 demand | Empty slot until the Datathon file exists | Shows a seeded seasonal-naive baseline, labelled, until the Task 2A file is uploaded (upload and remove are on the screen) | The reefer-gap table works from day one; the source is always named. |
| D-07 chart colours | Brand tokens | Separate `--chart-*` tokens (Fresh, Style, Tech) validated for lightness band, colour-blind separation and contrast in light and dark | The dark Tech navy failed the lightness band on the chart surface. Brand chips are unchanged. |
| SM-01 "Next delivery" | Today's run | Today's run until it is settled, then the next run | At 14:30 on Monday the useful answer is Tuesday's delivery, not the one that already arrived. |
| SM-05 count | Separate damaged and missing steppers | Missing units are derived from the count ("13 of 15" → 2 missing), and the server rejects mismatches | This prevents contradictory reports. |
| Timestamps | Wall clock | The business (demo) clock | So "Placed 14:30" matches the walkthrough. |
| D-03 blocked move | A rule break always blocks the drop | Physical rules still block. Timing and fuel overruns (late window, Fresh or day budget, fuel quota) can be overridden with a written reason, from the "can't drop" popover or "Move to…". The reason is audited and listed at publish. | Dispatchers sometimes know what the plan cannot, for example that a store agreed to take a late delivery. |
| D-03 header | Not in the design | "Improvement pass" note: what the optimiser changed on top of the flowchart plan, each change in plain language | The optimiser's changes should be visible and explained, not silent. |
| D-04 / D-01 fairness | Deferral history shown per order | "Skipped twice in a row" red chip, tab and KPI. Publishing is blocked until the dispatcher records why | The booklet's "same outlet skipped on consecutive runs" problem gets a hard stop, not just a column. |

## Realtime implementation note

The design assumed "live" screens but did not say how. In the build, the transactional outbox relays change signals to Convex, screens subscribe to their channels, and every read still comes from Postgres. Details are in `docs/architecture.md`.
