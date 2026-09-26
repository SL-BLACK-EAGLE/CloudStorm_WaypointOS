/**
 * Plain-language explanations of planner decisions, for the dispatcher (D-04) and the
 * store manager (SM-04). The planner stores a reason code; these sentences say what it means.
 */
const RULE: Record<string, string> = {
  R7_TRIP_LIMIT: "every vehicle that could take it already runs its 2 trips",
  R1_BRAND_DISTRICT: "no trip to this brand and district had room",
  R2_R3_R4_VEHICLE_TYPE: "no vehicle of the right type (reefer, van, depot) had room",
  R6_WEIGHT: "it would put the only suitable vehicles over their weight limit",
  R6_VOLUME: "it would put the only suitable vehicles over their volume limit",
  R7_FRESH_BUDGET_270: "the 270-minute pre-dawn Fresh window (03:30–08:00) is full on every vehicle that could take it",
  R7_DAY_BUDGET_480: "the 480-minute Style and Tech day is full on every vehicle that could take it",
  FUEL_QUOTA: "the suitable vehicles have used their weekly fuel quota",
  WINDOW_LATE: "no suitable vehicle can reach the outlet before its delivery window closes",
  TRIP2_WINDOW_LATE: "a second trip cannot get back out and reach the outlet before its window closes",
  NO_SLOT: "no legal slot was left",
};

const UNAVOIDABLE: Record<string, string> = {
  EXCEEDS_EVERY_VEHICLE: "It is bigger than any vehicle at the depot can carry, so the store needs to split it.",
  NO_REEFER_AVAILABLE: "It is chilled and every refrigerated vehicle at the depot is in the workshop.",
  NO_VAN_AVAILABLE: "The outlet is van-only and every van at the depot is in the workshop.",
  NO_REEFER_VAN_AVAILABLE:
    "The outlet is van-only and the order is chilled, and both refrigerated vans are in the workshop. No other vehicle may serve it.",
  NO_VEHICLE_FITS_ORDER: "No available vehicle meets its weight, volume, temperature and access needs.",
};

export type DeferralKind = "UNAVOIDABLE" | "CAPACITY_FORCED" | "CHOSEN" | "MANUAL";

export interface ExplainInput {
  kind: DeferralKind;
  reasonCode: string;
  lostTo?: { orderId: string; outletId: string; deferredYesterday: number; daysSinceLastServed: number; chilled: boolean } | null;
  justification?: string | null;
}

/** Dispatcher-facing: why the planner deferred this order. */
export function explainDeferral(d: ExplainInput): string {
  if (d.kind === "UNAVOIDABLE") return UNAVOIDABLE[d.reasonCode] ?? "No vehicle can legally carry it today.";
  if (d.kind === "CAPACITY_FORCED") return `Capacity: ${RULE[d.reasonCode] ?? d.reasonCode}.`;
  if (d.kind === "MANUAL") return `Deferred by the dispatcher${d.justification ? `: ${d.justification}` : "."}`;
  const l = d.lostTo;
  if (!l) return "Lost its slot to a higher-priority order.";
  const why = l.deferredYesterday
    ? "was skipped yesterday"
    : l.chilled
      ? "is perishable"
      : `has waited ${l.daysSinceLastServed} day${l.daysSinceLastServed === 1 ? "" : "s"}`;
  return `Chosen: its slot went to ${l.orderId} (${l.outletId}), which ${why}. It fits if that order moves instead.`;
}

/** Store-facing (SM-04): short, no internal codes. */
export function explainForStore(d: ExplainInput, newRunLabel: string): string {
  const next = `It is now on the ${newRunLabel} run with priority, so it cannot be skipped twice.`;
  if (d.kind === "UNAVOIDABLE") return `${UNAVOIDABLE[d.reasonCode] ?? "No vehicle could carry it today."} ${next}`;
  if (d.kind === "CAPACITY_FORCED") return `Tomorrow's fleet is full: ${RULE[d.reasonCode] ?? "no legal slot was left"}. ${next}`;
  if (d.kind === "MANUAL") return `The dispatcher moved it${d.justification ? `: ${d.justification}` : "."} ${next}`;
  return `Refrigerated and delivery-window capacity went to outlets that were skipped yesterday or waited longer. ${next}`;
}

export const KIND_LABEL: Record<DeferralKind, string> = {
  UNAVOIDABLE: "Unavoidable",
  CAPACITY_FORCED: "Capacity",
  CHOSEN: "Chosen",
  MANUAL: "Manual",
};
