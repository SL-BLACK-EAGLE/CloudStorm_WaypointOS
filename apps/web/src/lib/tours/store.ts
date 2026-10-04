import type { TourStep } from "@/components/wp/tour";

/** Guided tours for the store manager's screens (SM-01..SM-05, DG-03). */

const HELP: TourStep = { el: "help", title: "Replay this tour", body: "Press ? at the top to see this screen's tour again." };

export const HOME_TOUR: TourStep[] = [
  {
    title: "Welcome, store manager",
    body: "This is your store's view: order before the 16:00 cutoff, see when the truck will arrive (or why an order moved), and confirm what arrived. Each screen explains itself the first time you open it.",
  },
  { el: "outlet", title: "Your outlet", body: "Brand, outlet, district, dock type and your delivery window. The dispatcher plans every truck around this window." },
  { el: "nav", title: "Home · Order · Track · Receive", body: "Order for the next run, track every order, and confirm deliveries when they arrive." },
  {
    el: "next-delivery",
    title: "Next delivery",
    body: "When the truck is expected, the planned time and how far it is running behind or ahead, minutes to spare before your window closes, unloading time at your dock, and the vehicle.",
  },
  {
    el: "cutoff",
    title: "Order cutoff",
    body: "Orders for the next run close at 16:00. The countdown shows the time left; anything later goes to the following run.",
  },
  {
    el: "ask",
    title: "The truck can come today after all",
    body: "Your order was moved, but the truck can still deliver. Open it to accept today or keep the next run - the driver is waiting for your answer.",
  },
  {
    el: "moved",
    title: "An order moved to the next run",
    body: "Open it to see why, in plain language. It goes first on that run, so there is no need to reorder.",
  },
  { el: "orders", title: "Your orders for this run", body: "Each order with its temperature, weight, volume and status. Dry and chilled are separate orders." },
  { el: "bell", title: "Notifications", body: "Arrival times, delays, moved orders and replies from the dispatcher - kept here if you missed them." },
  HELP,
];

export const ORDER_LINES_TOUR: TourStep[] = [
  { el: "steps", title: "Three steps", body: "Order lines, review, confirmation." },
  { el: "countdown", title: "Time to the cutoff", body: "Orders placed before 16:00 go on the next morning's run." },
  {
    el: "order-tabs",
    title: "Dry and chilled are separate orders",
    body: "Chilled goods need a refrigerated vehicle, so they form their own order. Chilled items always land in the chilled order and cannot end up on a truck without refrigeration.",
  },
  { el: "search", title: "Add items", body: "Search the catalogue, or press \"Typical order\" to start from what your store usually orders." },
  { el: "lines", title: "Quantities", body: "Adjust each line with − and +, or remove it." },
  { el: "totals", side: "left", title: "Order totals", body: "Units, weight and volume for each order - what the planner uses to fit it on a truck." },
  { el: "to-review", side: "left", title: "Continue to review", body: "Check both orders before you submit." },
  HELP,
];

export const ORDER_REVIEW_TOUR: TourStep[] = [
  {
    el: "two-orders",
    title: "Two separate orders",
    body: "If refrigerated space runs out, the chilled order can move to the next run while the dry one still arrives - and you will be told why.",
  },
  { el: "review", title: "Check each order", body: "Lines, weight and volume per order." },
  { el: "submit", title: "Submit", body: "Places the orders for the next run. You can track them straight away." },
];

export const ORDER_DONE_TOUR: TourStep[] = [
  {
    el: "confirmation",
    title: "Orders received",
    body: "They are confirmed for the next run. After 16:00 the dispatcher plans, and you will see the expected arrival - or a notice if an order has to move.",
  },
];

export const TRACK_TOUR: TourStep[] = [
  { el: "track-title", title: "Track", body: "Every order, grouped by delivery day, newest first." },
  { el: "track-day", title: "One day's orders", body: "Each order with its stage - confirmed, planned, loaded, on the way, delivered, received, or moved. Open one for its timeline." },
  HELP,
];

export const RECEIVE_LIST_TOUR: TourStep[] = [
  {
    el: "to-confirm",
    title: "Confirm what arrived",
    body: "Delivered orders wait here until you count them. Open one to confirm it in full or report a problem.",
  },
  HELP,
];

export const RECEIVE_TOUR: TourStep[] = [
  {
    el: "units",
    title: "1 · Units received",
    body: "Count what arrived. If it is less than the driver handed over, the difference becomes a problem report.",
  },
  {
    el: "anything-wrong",
    title: "2 · Anything wrong?",
    body: "Missing or damaged units, or chilled goods that arrived warm. Damage needs a photo.",
  },
  {
    el: "driver-record",
    side: "left",
    title: "The driver's record",
    body: "What the driver recorded at your door: arrival time, units handed over, the receiver's name and signature. Compare it with your count.",
  },
  {
    el: "confirm",
    title: "Confirm",
    body: "Closes the delivery. A problem goes straight to the dispatcher's exception list, and they can reply or book a re-delivery.",
  },
  HELP,
];

export const NOTICE_TOUR: TourStep[] = [
  { el: "notice", title: "Your order moved to the next run", body: "This is the deferral notice the dispatcher's plan sent you." },
  {
    el: "notice-facts",
    title: "What happens now",
    body: "The new delivery day (same window), guaranteed priority on that run, and whether your other order is affected.",
  },
  { el: "why", title: "Why", body: "The reason in plain language, built from the planner's facts - for example, every refrigerated vehicle was full." },
  {
    el: "notice-actions",
    title: "Got it, or ask a question",
    body: "Acknowledge the notice, or message the dispatcher if the new day does not work for you.",
  },
];

export const TRACKING_TOUR: TourStep[] = [
  { el: "timeline", title: "Order timeline", body: "Placed, confirmed, planned, loaded, on the way, delivered - with the time of each step." },
  {
    el: "eta",
    side: "left",
    title: "Expected arrival",
    body: "When the truck should reach you and how much time is left before your window closes. It updates every time the driver records a stop; if the truck cannot make your window, the warning shows here first.",
  },
  { el: "message", side: "left", title: "Message the dispatcher", body: "Ask about this order; the reply comes to your bell." },
  {
    el: "messages",
    side: "left",
    title: "Every message about this order",
    body: "Notices and replies in order. A notice that a later update replaced stays visible, struck through.",
  },
  HELP,
];

export const ASK_TOUR: TourStep[] = [
  {
    el: "ask",
    title: "The truck can come today after all",
    body: "Your order was moved because the dispatcher lost contact with the truck. It still has your goods and is a few minutes away.",
  },
  {
    el: "ask-facts",
    title: "Arrival and what accepting means",
    body: "When it would arrive and whether that is inside your window. If you accept, the move to the next run is cancelled - no double delivery.",
  },
  {
    el: "ask-buttons",
    title: "Your decision",
    body: "Accept today, or keep it for the next run. The driver is parked waiting, and gets your answer immediately.",
  },
  { el: "messages", side: "left", title: "Every message about this order", body: "The original notice stays visible, struck through, with what replaced it." },
];
