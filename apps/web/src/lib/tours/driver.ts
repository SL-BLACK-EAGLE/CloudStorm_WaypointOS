import type { TourStep } from "@/components/wp/tour";

/** Guided tours for the driver's phone app (D-R1..D-R5): one tour per view, Sunlight mode. */

const HELP: TourStep = { el: "help", title: "Replay this tour", body: "Tap ? at the top to see this screen's tour again." };

export const RUN_TOUR: TourStep[] = [
  {
    title: "Your run for today",
    body: "Built for a phone in the cab: high contrast, big buttons. It keeps working with no signal for hours - everything you record is saved on the phone and sent when signal returns.",
  },
  {
    el: "sync",
    title: "Signal and outbox",
    body: "Shows Online or Offline and how many records are waiting on this phone. Tap it to open the outbox.",
  },
  { el: "notices", title: "Messages from the dispatcher", body: "Instructions such as \"skip this stop\" or \"deliver now\". Tap OK once you have read one." },
  {
    el: "plan-changed",
    title: "Plan changed while you had no signal",
    body: "If the dispatcher moved one of your stops while you were offline, it shows here. If you can still deliver, tap \"Tell dispatcher: I can deliver now\" - they decide (the store may be asked) and the answer comes back here.",
  },
  {
    el: "offline-ready",
    title: "Offline ready",
    body: "Your stops, delivery windows, docks and the load list are saved on this phone, so a dead zone does not stop you.",
  },
  { el: "trip-card", title: "Your vehicle and trip", body: "Vehicle, trip code, route and load, and whether the loader has signed it off at the dock." },
  {
    el: "stops",
    title: "Stops in driving order",
    body: "Each stop with the store's delivery window, units and planned arrival. Delivered stops get a tick; a stop the dispatcher moved is marked.",
  },
  {
    el: "start",
    title: "Start the trip",
    body: "Unlocks once the loader signs the vehicle off. Starting records your departure time, even offline, and opens your first stop.",
  },
  { el: "bell", title: "Notifications", body: "Everything the dispatcher sent you, kept here even if you missed it on the road." },
  HELP,
];

export const STOP_TOUR: TourStep[] = [
  {
    el: "stop-card",
    title: "Next stop",
    body: "The outlet, its delivery window, dock type, units and when you are expected. A warning shows if you will arrive after the window closes.",
  },
  { el: "problem", title: "Problem at this stop?", body: "Outlet closed, goods refused, gate refused, or a late delivery the store accepted." },
  { el: "navigate", title: "Navigate", body: "Opens Google Maps with the outlet as the destination." },
  {
    el: "arrive",
    title: "I've arrived",
    body: "Records your arrival time and opens proof of delivery. While the truck is moving the app shows a large \"Driving\" view and hides the controls; tap \"I'm parked\" to get them back.",
  },
  HELP,
];

export const DELIVER_TOUR: TourStep[] = [
  {
    el: "pod-steps",
    title: "Proof of delivery",
    body: "Three steps: arrived (recorded already), unloaded, proof. The time is added automatically when you complete.",
  },
  {
    el: "units",
    title: "Units handed over",
    body: "Starts at the full load-list count. Use − and + if fewer were handed over; the store sees the difference when it confirms receipt.",
  },
  { el: "cold", title: "Chilled goods", body: "For a chilled order, confirm the goods were handed over cold." },
  {
    el: "proof",
    title: "Who received it",
    body: "Type the receiver's name and ask them to sign on the screen - or take a photo of the delivered goods instead.",
  },
  { el: "problem", title: "Something wrong?", body: "Report a problem instead of completing the delivery." },
  {
    el: "complete",
    title: "Complete delivery",
    body: "Unlocks once the name and signature (or photo) are in. With no signal it is saved on the phone and sent later with the time it really happened.",
  },
];

export const PROBLEM_TOUR: TourStep[] = [
  {
    el: "kinds",
    title: "What happened?",
    body: "Pick one. \"Delivered late, store accepted\" goes on to proof of delivery. Outlet closed, goods refused (all or part), or gate refused: add a photo or note, and the order goes back to the dispatcher, who books a re-delivery and tells the store.",
  },
];

export const OUTBOX_TOUR: TourStep[] = [
  {
    el: "sync-status",
    title: "What is still on this phone",
    body: "How many records are waiting for signal, and when the phone last synced.",
  },
  {
    el: "records",
    title: "Every record, newest first",
    body: "Departures, arrivals, proofs and problems, each with the time it happened. They send by themselves, oldest first, when there is signal; a replay is never counted twice.",
  },
  { el: "send-now", title: "Send now", body: "Push the waiting records immediately instead of waiting for the next automatic try." },
];
