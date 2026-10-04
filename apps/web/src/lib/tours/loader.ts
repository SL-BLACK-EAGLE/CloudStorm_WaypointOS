import type { TourStep } from "@/components/wp/tour";

/** Guided tours for the loader's screens (L-01..L-04): a dock tablet or a phone, in Sunlight mode. */

const HELP: TourStep = { el: "help", title: "Replay this tour", body: "Tap ? at the top to see this screen's tour again." };

export const QUEUE_TOUR: TourStep[] = [
  {
    title: "The dock queue (L-01)",
    body: "Built for a tablet at the dock or a phone, in high-contrast Sunlight mode. Every published load list for your depot is here, earliest departure first.",
  },
  { el: "clock", title: "Business time", body: "The demo clock. Vehicles leaving within the next 90 minutes are the ones to load now." },
  { el: "queue-tabs", title: "Next 90 min · Later · Departed", body: "Work through \"Next 90 min\" first. \"Departed\" lists vehicles that have already left." },
  {
    el: "load-lists",
    title: "One card per vehicle",
    body: "Departure time, vehicle, trip, district, stops and units, and where it stands: not started, ready to sign off, signed off. Tap a card to open its load list.",
  },
  { el: "bell", title: "Notifications", body: "The dispatcher's decisions on your shortfalls - hold the vehicle or send it - and plan changes arrive here." },
  HELP,
];

export const LOAD_LIST_TOUR: TourStep[] = [
  { el: "trip-head", title: "This vehicle", body: "Vehicle and trip, vehicle type, brand, district and departure time." },
  { el: "progress", title: "Progress", body: "Stops and units loaded so far. A chilled load is marked - it goes on a reefer." },
  {
    el: "rule",
    title: "Load in reverse order",
    body: "The last stop goes in first, so stop 1 is by the door when the driver opens up. The list below is already in loading order.",
  },
  {
    el: "stops",
    title: "The load list",
    body: "Each row is one store's whole order: load number, outlet, dock type, delivery window and units. An order is never split across vehicles.",
  },
  {
    el: "check-stop",
    title: "Check the order in front of you",
    body: "Count it, then tap \"All N loaded\". If units are missing, damaged or not cold, tap \"Short or damaged\" instead - the dispatcher decides what happens.",
  },
  { el: "to-signoff", title: "Sign off", body: "When every order is loaded or flagged, sign the vehicle off so the driver can leave." },
  HELP,
];

export const SHORTFALL_TOUR: TourStep[] = [
  { el: "count", title: "Count what is on the dock", body: "Set the units you actually have. The screen shows how many are short." },
  { el: "cause", title: "What's wrong", body: "Missing, damaged, or not cold (chilled goods that have warmed up)." },
  { el: "photo", title: "Photo of the pallet label", body: "Evidence for the dispatcher and the store. Optional, but it settles questions later." },
  {
    el: "next",
    title: "What happens next",
    body: "Orders are never split. The dispatcher either holds the vehicle until the units are found, or sends it now and warns the store. Sign-off stays locked until they decide.",
  },
  { el: "submit", title: "Send it to the dispatcher", body: "It appears on the dispatcher's Live screen straight away." },
];

export const SIGNOFF_TOUR: TourStep[] = [
  {
    el: "checks",
    title: "The last gate before the vehicle leaves",
    body: "Every order loaded last-stop-first, every shortfall settled, and the load list matching the published plan. Each line shows ✓ or what is still open.",
  },
  {
    el: "waiting",
    title: "Waiting for the dispatcher",
    body: "A flagged shortfall locks sign-off until the dispatcher holds or sends the vehicle. Their decision appears here; if they hold it and the units turn up, tap \"N units found\".",
  },
  {
    el: "signoff",
    title: "Sign off",
    body: "For a reefer, confirm the unit is running and the doors are sealed. A locked button always says why. After sign-off the driver can start the trip.",
  },
  HELP,
];
