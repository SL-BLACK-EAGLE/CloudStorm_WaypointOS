import type { TourStep } from "@/components/wp/tour";

/** Guided tours for the dispatcher's screens (D-01..D-07, DG-02, Fleet, People) and the demo panel. */

const HELP: TourStep = { el: "help", title: "Replay this tour", body: "Press ? on any screen to see its tour again." };

export const TOWER_TOUR: TourStep[] = [
  {
    title: "Welcome to Waypoint Delivery OS",
    body: "You are the dispatcher at the Peliyagoda planning office. The first time you open a screen, a short tour like this explains it. Press Next, or Esc to close; the ? button in the header replays it.",
  },
  {
    el: "rail",
    side: "right",
    title: "Your screens, in the order of the day",
    body: "Tower (here) → Orders that came in before 16:00 → Plan the run → Deferrals: explain what did not fit → Publish to loaders, drivers and stores → Live: watch the run. Forecast plans capacity weeks ahead; Fleet and People are for admin.",
  },
  { el: "depot", title: "Depot", body: "Switch between Peliyagoda and Kandy. Every screen follows the selected depot: its orders, fleet and plan." },
  {
    el: "clock",
    title: "Business clock",
    body: "The app runs on the competition's dates, 22–23 Dec 2025. Move this clock from the demo panel (/demo) to jump from Monday's 14:30 ordering to Tuesday's deliveries.",
  },
  {
    el: "kpis",
    title: "Tonight's run at a glance",
    body: "Confirmed orders by brand, the size of the draft plan, how many orders are deferred (click to review them) and the first departure - the plan must be published before it.",
  },
  {
    el: "autoplan",
    title: "Start here: Run auto-plan",
    body: "After the 16:00 cutoff the planner builds every trip in under a second. It gives the scarcest resources out first (van-only chilled, chilled, van-only ambient) and checks rules 1–7, delivery windows and fuel.",
  },
  {
    el: "resources",
    title: "Demand against the scarce resources",
    body: "Each card compares what the orders need with what the fleet can give tonight: reefer space for chilled goods, vans for van-only outlets, the 270-minute Fresh window (03:30–08:00) and the weekly fuel quota. The one that runs out first is outlined.",
  },
  { el: "districts", title: "Demand by district", body: "A trip carries one brand to one district, so this shows where trips are needed and how heavy each district is." },
  { el: "tonight", side: "left", title: "Tonight's checklist", body: "The steps to finish this run, in order. The next one is underlined, and the button below takes you straight to it." },
  {
    el: "bell",
    title: "Notifications",
    body: "Loaders, drivers and stores reach you here: shortfalls, late risks, offline conflicts, store replies. Anything you missed stays listed with an unread marker.",
  },
  HELP,
];

export const ORDERS_TOUR: TourStep[] = [
  {
    el: "cutoff",
    title: "The 16:00 cutoff",
    body: "Stores order until 16:00 for the next morning's run. This says whether the queue is still open; anything after the cutoff waits for the following run.",
  },
  { el: "filters", title: "Filter the queue", body: "Narrow the list to one district, or find an order or outlet." },
  {
    el: "queue",
    title: "Confirmed orders",
    body: "Every order for the next run: brand, outlet, temperature (chilled needs a reefer), weight, volume and the store's delivery window. Dry and chilled from one store are separate orders.",
  },
  { el: "late-orders", title: "Received after the cutoff", body: "These move to the following run automatically." },
  {
    el: "requirements",
    side: "left",
    title: "What the orders require",
    body: "How many orders need a reefer, a van (van-only outlets), a mall window, or the Style/Tech 480-minute day budget. These are the constraints the planner has to satisfy.",
  },
  { el: "to-plan", side: "left", title: "Next: plan the run", body: "Open the planning board and run auto-plan." },
  HELP,
];

export const PLAN_EMPTY_TOUR: TourStep[] = [
  {
    el: "autoplan",
    title: "No plan yet - run auto-plan",
    body: "The planner is a TypeScript port of the team's algorithm, checked step for step against the Python original. It builds trips for every vehicle and explains every order it could not fit. You can re-run it any time before publishing.",
  },
];

export const PLAN_TOUR: TourStep[] = [
  {
    title: "The planning board",
    body: "This is the auto-plan result. Each row is a vehicle, each card a trip. You can move orders by hand; every move is re-checked against the same rules before it is saved.",
  },
  {
    el: "optimizer",
    title: "Improvement pass",
    body: "After the flowchart algorithm, a local search tries to serve more orders or use fewer trips and less fuel. Open this to read each change it made, in plain language.",
  },
  {
    el: "toolbar",
    title: "Summary and tools",
    body: "Re-run auto-plan, find an outlet or vehicle, and see the counts: vehicles used, trips, stops, vehicles near the 270-minute Fresh budget, and deferred orders.",
  },
  {
    el: "deferred-column",
    side: "right",
    title: "Deferred orders",
    body: "Orders that did not fit, with the reason: unavoidable, capacity or chosen. Drag one onto a trip to try to serve it; drop a stop here to defer it.",
  },
  {
    el: "lanes",
    title: "Vehicles and their trips",
    body: "Grouped by type: reefer trucks, reefer vans, ambient vans, ambient trucks. Click a trip to inspect it, or drag an order between trips. A move that breaks a rule is refused with the rule's name (\"needs reefer, rule 2\"). A timing or fuel overrun can be accepted with a written reason; physical rules never can.",
  },
  { el: "detail", side: "left", title: "Trip detail", body: "The selected trip: vehicle, district and departure time." },
  {
    el: "feasibility",
    side: "left",
    title: "Feasibility check",
    body: "Each trip is checked automatically against the booklet's hard rules - brand and district, refrigeration, access, home depot, whole orders, capacity, trips and time - plus delivery windows. A failing rule turns red with the reason.",
  },
  {
    el: "stops",
    side: "left",
    title: "Stops in driving order",
    body: "Planned arrival at each stop. Move or Defer any order from here; below, the board suggests deferred orders that fit in the room left.",
  },
  HELP,
];

export const DEFERRALS_TOUR: TourStep[] = [
  {
    el: "kpis",
    title: "Deferral summary",
    body: "How many orders did not fit, by reason. \"Skipped twice in a row\" must stay at zero: an outlet skipped on the previous run gets top priority, and publishing is blocked if it is skipped again without a recorded reason. \"Decided\" counts the choices you still owe.",
  },
  {
    el: "classes",
    title: "Three kinds of deferral",
    body: "Unavoidable: no vehicle may legally serve it (e.g. van-only chilled while both reefer vans are in the workshop). Capacity: no legal slot left on any vehicle. Chosen: it lost its slot to a higher-priority order - these need your decision.",
  },
  { el: "deferral-table", title: "Every deferred order", body: "Load, window, class, the reason in plain language, and the store's other order today. Click a row to open it." },
  {
    el: "decision",
    side: "left",
    title: "Decide",
    body: "See what happens if you serve it (and which order would move instead), or keep it deferred. Keeping it needs a written reason; it then goes first on the next run, and the store manager is told why.",
  },
  { el: "to-publish", title: "Next: publish", body: "Once every chosen deferral is decided, continue to publish." },
  HELP,
];

export const PUBLISH_TOUR: TourStep[] = [
  {
    el: "checks",
    title: "Pre-publish checks",
    body: "Rule violations, undecided and repeated deferrals, late-risk stops and workshop vehicles. Publishing stays blocked until the must-pass checks are green.",
  },
  {
    el: "recipients",
    title: "What each role receives",
    body: "Loaders get load lists in reverse stop order, drivers get their run (saved on the phone for offline use), and stores get an arrival time or a plain-language deferral notice.",
  },
  { el: "totals", title: "The plan in numbers", body: "Orders served and deferred, trips and vehicles." },
  { el: "loader-preview", side: "left", title: "Loader preview", body: "Exactly what the dock will see for one vehicle: the last stop is loaded first." },
  {
    el: "publish",
    side: "left",
    title: "Publish",
    body: "Sends the plan to every role at once. If you change it afterwards, only the people affected get the update.",
  },
  { el: "print", side: "left", title: "Paper backup", body: "Printable run sheets for each vehicle, in case a phone fails." },
  HELP,
];

export const LIVE_TOUR: TourStep[] = [
  {
    el: "live-indicator",
    title: "Live",
    body: "This screen updates by itself as drivers record departures, arrivals and deliveries (realtime push, with polling as a fallback).",
  },
  { el: "kpis", title: "The run right now", body: "Trips departed, stops delivered, stops at late risk (under 20 minutes before the window closes) and problems that need a person." },
  {
    el: "conflicts",
    title: "Offline conflicts",
    body: "When a truck comes back online and its records clash with a change you made, it shows here. Open reconciliation to decide.",
  },
  {
    el: "trips",
    title: "Every trip, ranked by risk",
    body: "Progress, status, next stop with its ETA, and late-risk stops. The ETA uses the expected schedule - traffic by hour, road disruption by district and service times fitted on two years of deliveries - re-timed after each recorded stop. Expand a row to see every stop.",
  },
  {
    el: "exceptions",
    side: "left",
    title: "Exceptions: only what needs a person",
    body: "Late risk, a truck that has not left, a long stop, a loader's shortfall, a store's receipt problem - each with its actions: warn the store, send new ETAs, message the driver, defer a stop to the next run, hold or send a short truck.",
  },
  HELP,
];

export const RECONCILE_TOUR: TourStep[] = [
  {
    title: "Reconciliation (DG-02)",
    body: "Drivers keep working with no signal. When the phone reconnects, its records sync in order with the times they happened. If you changed a stop meanwhile, both versions are shown here, so nothing is silently overwritten.",
  },
  { el: "sync-summary", title: "What arrived from the phone", body: "Records received, records lost (always 0), and how many conflicts are open on this trip." },
  { el: "timeline", title: "What happened on the trip", body: "The driver's records in order, with the times recorded on the phone - not the time they reached the server." },
  { el: "compare", title: "Your change vs the truck's reality", body: "Left: what you decided, and when. Right: what the driver recorded." },
  {
    el: "decide",
    title: "Decide",
    body: "Keep the next run, or deliver today. Delivering today asks the store first (DG-03), because its window may have closed: the store answers on its own screen and the driver gets the result. If the store already agreed by phone, use \"Deliver today without waiting\".",
  },
  HELP,
];

export const FORECAST_TOUR: TourStep[] = [
  {
    el: "source",
    title: "Demand source",
    body: "Switch between the Datathon Task 2A forecast (once loaded) and a seasonal-naive baseline built from order history.",
  },
  { el: "upload", title: "Load the forecast", body: "Upload the Datathon Task 2A submission CSV; every figure below recalculates from it." },
  {
    el: "kpis",
    title: "Capacity at a glance",
    body: "The tightest reefer week ahead, reefer trips the fleet can run per week, how many chilled orders one reefer trip carries, and the average chilled order.",
  },
  { el: "volume", title: "Weekly volume by brand", body: "Forecast demand week by week." },
  { el: "supply", side: "left", title: "Supply per week", body: "Reefers and vans from the fleet, two trips a day, six operating days." },
  {
    el: "reefer-need",
    title: "Reefer trips needed",
    body: "Forecast chilled orders ÷ orders per reefer trip, against the trips available. The gap column turns amber when it is tight and red when short, so extra vehicles can be arranged early.",
  },
  {
    el: "service-time",
    title: "Service time per stop",
    body: "Observed unloading time by brand and dock type against the allowance table - the basis of the ETAs on Live operations.",
  },
  HELP,
];

export const FLEET_TOUR: TourStep[] = [
  { el: "kpis", title: "Fleet at a glance", body: "Vehicles, how many are in the workshop, available reefers, and fuel against the weekly quota." },
  { el: "fleet-table", title: "Every vehicle", body: "Capacity, trips on the draft plan, what it is doing now, and fuel this week." },
  {
    el: "fuel",
    title: "Fuel quota",
    body: "Litres used this week plus planned, against each vehicle's weekly quota (rule 7). The planner will not plan a trip that breaks it.",
  },
  {
    el: "workshop",
    side: "left",
    title: "Workshop status",
    body: "Send a vehicle to the workshop for the run being planned (with a note), or mark it back in service. Re-run auto-plan afterwards so the plan uses the change.",
  },
  HELP,
];

export const PEOPLE_TOUR: TourStep[] = [
  {
    el: "requests",
    title: "Access requests",
    body: "New sign-ups choose a role, but nobody gets access by signing up: you approve the role with its scope (depot, outlet or vehicle), or decline.",
  },
  { el: "accounts", title: "Active accounts", body: "Change a person's role or scope, or disable the account. Every change is written to the audit log." },
  HELP,
];

export const DEMO_TOUR: TourStep[] = [
  {
    title: "Judge demo panel",
    body: "The operation is 22–23 Dec 2025. This panel moves you through that day without waiting for real time. Any signed-in role can open it at /demo.",
  },
  {
    el: "presets",
    title: "Jump to a moment",
    body: "Each button sets the business clock to one step of the walkthrough, from the store ordering at Mon 14:30 to receipts at Tue 09:00 - the same steps as the README walkthrough.",
  },
  { el: "exact-time", title: "Exact time and speed", body: "Set any time, or let the clock run at ×1 to ×120." },
  {
    el: "simulate",
    side: "left",
    title: "The rest of the fleet",
    body: "Only the demo driver's phone records real events. This moves every other truck along its plan up to the clock, with road drift, so live operations and store tracking have a fleet to show. It also runs whenever the clock moves.",
  },
  {
    el: "driver-vehicle",
    title: "The demo driver's vehicle",
    body: "Once a plan is published, give the driver account the vehicle carrying the order you want to follow.",
  },
  {
    el: "store-outlet",
    title: "The demo store",
    body: "Point the store manager account at any outlet - for example one the driver just delivered to - to confirm receipt.",
  },
  {
    el: "reset",
    title: "Start again",
    body: "Reset demo data returns to Mon 22 Dec 14:30 in seconds. \"Show the guided tours again\" makes every screen explain itself once more.",
  },
  HELP,
];
