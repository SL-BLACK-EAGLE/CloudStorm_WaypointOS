# Video script (about 7 minutes)

**Setup before recording:**
- Four browser windows, one per role, signed in: dispatcher (desktop, dark), store (desktop, light), loader (tablet size), driver (phone size, DevTools open on the Network tab).
- The demo panel in a fifth tab. Reset the demo data, then set the clock to **Mon 14:30**.

## Part 1: the day, across four roles (about 5 min)

| Time | Screen | Say | Do |
|---|---|---|---|
| 0:00 | Landing | "Waypoint delivers to 120 outlets from two depots with 60 vehicles. Today planning is a spreadsheet, stores learn about problems at the door, and drivers lose signal in the hills. This is one system for all four people involved." | Show the landing page, then the four signed-in windows side by side. |
| 0:20 | Store SM-01 → SM-02 | "It's Monday 14:30. The store has 90 minutes to order for Tuesday. Chilled and dry are separate orders, because chilled needs a refrigerated truck." | Countdown, **Typical order**, review, submit → confirmation. |
| 0:50 | Demo panel → Mon 16:05; Dispatcher D-01 | "The cutoff has passed. The control tower shows demand against the scarce resources: reefers, vans, the Fresh 03:30–08:00 window, and fuel quotas." | Point at the four capacity cards. |
| 1:10 | D-01 → D-03 | "Auto-plan puts 80 of 88 orders on 20 trips in about a tenth of a second, and every hard rule from the booklet holds." | **Run auto-plan**, open the board. |
| 1:30 | D-03 | "The dispatcher stays in charge, but the rules still apply. Drag a chilled order onto a dry truck and it's refused, with the rule it breaks." | Drag → "needs reefer (rule 2)". |
| 1:45 | D-04 | "Eight orders don't fit. Each one says why: unavoidable, capacity-forced or chosen, with the store's fairness history so no outlet is deferred two days running." | Keep one deferred with a reason. |
| 2:05 | D-05 → Store SM-04 | "Publishing sends load lists, driver runs, and an arrival time or an honest notice to every store, the evening before, not at the door." | **Publish**; the store window shows the notice or the arrival time. |
| 2:25 | Demo → Tue 01:30; Loader L-02/L-03 | "At the dock the loader sees the list in reverse stop order. Eight units are missing, so they flag it with a photo, and sign-off locks." | Tick lines, flag a shortfall. |
| 2:45 | Dispatcher D-06 | "The dispatcher decides: hold the truck, or send it and warn the store. The loader's screen unlocks immediately." | **Send and warn store**; the loader's sign-off unlocks by push. |
| 3:05 | Demo → Tue 03:30; Driver | "The driver's run is saved on the phone. Watch what happens with no signal." | DevTools → Offline. Depart, arrive, record the delivery with a signature. The outbox shows 3 waiting. |
| 3:35 | Driver back online | "Back online, the events sync in order with the times as they happened, and a replay is recognised as a duplicate. The store is notified of the delivery." | Online → "Sent". |
| 3:50 | Demo → Tue 06:30; Dispatcher D-06 | "Live operations ranks every trip by risk: a truck that hasn't left, a stop running long, stops that will miss their window." | Scroll the table, open the exceptions feed. |
| 4:10 | D-06 → Driver | "Messages reach the driver instantly, through the Convex realtime layer." | **Message driver** → it appears on the phone. |
| 4:20 | D-06 → Driver → DG-02 | "A stop is going to be late, so the dispatcher moves it to Wednesday. The driver, now in signal, says: I can still deliver. Reconciliation shows both sides without blame, and the dispatcher decides." | **Defer to Wed** → driver **I can deliver now** → DG-02 **Deliver today**; the answer appears on the phone. |
| 4:45 | Demo → Tue 09:00; Store SM-05 | "The store confirms what arrived against the driver's signed record. 13 of 15: two missing, one damaged, with a photo. It goes straight to the dispatcher." | Confirm with a problem → the dispatcher's feed shows it. |
| 5:05 | D-07 | "Looking ahead: our Datathon demand forecast becomes the number of reefer trips needed each week, against the 108 we have." | Upload the Task 2A CSV and show the reefer-gap table. |

## Part 2: how it's built (about 2 min)

| Time | Show | Say |
|---|---|---|
| 5:25 | `docs/architecture.md` service table | "One Next.js 16 app on managed services: Neon Postgres is the record, Convex pushes changes, Clerk handles sign-in, Upstash does rate limits and jobs. `docker compose up` runs every piece locally, including Convex." |
| 5:50 | The outbox diagram | "Every write commits its business rows and an outbox row in one transaction. A relay pushes change signals to Convex, and screens re-read from Postgres. Nothing is shown that didn't commit, and nothing committed is lost. QStash sweeps anything a request missed." |
| 6:15 | `packages/planner` + parity test | "The planner is our teammate's Python algorithm, ported to TypeScript and checked row for row against the original. The same rule checks run on every manual edit." |
| 6:35 | `lib/offline` + `/api/sync` | "Offline, each action is an event with a UUIDv7 id, a device sequence number, and the stop version the phone saw. Replays are idempotent, and a stale version becomes a reconciliation card, never a silent overwrite." |
| 6:55 | README | "Everything you saw is in the README walkthrough, with the four demo accounts. Thank you." |
