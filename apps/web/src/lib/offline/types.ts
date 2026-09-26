/**
 * The driver's offline pack and the events a phone records. Shared by the browser
 * (IndexedDB outbox) and the server (/api/sync). Mirrors flowchart F9: facts are applied
 * at the time they were recorded, duplicates are ignored, stale plan versions raise a conflict.
 */
export interface ClockInfo {
  at: string;
  running: boolean;
  anchorReal: number;
  speed: number;
}

export interface PackStop {
  stopId: string;
  seq: number;
  orderId: string;
  outletId: string;
  outletName: string;
  brand: "Fresh" | "Style" | "Tech";
  district: string;
  dock: "rear_dock" | "street" | "mall_bay";
  parking: "normal" | "van_only" | "mall_dock";
  mallWindow: string | null;
  open: number;
  close: number;
  temp: "chilled" | "ambient";
  units: number;
  kg: number;
  m3: number;
  plannedArrive: number | null;
  etaMin: number | null;
  lateRisk: boolean;
  version: number;
  status: "planned" | "arrived" | "delivered" | "exception" | "skipped";
  arrivedMin: number | null;
  leftMin: number | null;
  /** a sibling order for the same outlet delivered on this trip (dry + chilled) */
  deferredSibling: string | null;
}

export interface PackTrip {
  tripId: string;
  code: string;
  tripNo: number;
  brand: "Fresh" | "Style" | "Tech";
  district: string;
  departureMin: number | null;
  status: string;
  signedOff: boolean;
  departedMin: number | null;
  stops: PackStop[];
}

export interface RunPack {
  version: 1;
  builtAt: string;
  runDate: string;
  driverName: string;
  vehicle: { id: string; type: string; temp: string; capKg: number; depot: string } | null;
  planVersion: number | null;
  clock: ClockInfo;
  trips: PackTrip[];
  /** open conflicts the dispatcher has not resolved yet */
  conflicts: Array<{ id: string; stopId: string | null; kind: string; detail: Record<string, unknown>; status: string; resolution: string | null }>;
}

export type DriverEventType = "trip.depart" | "stop.arrive" | "stop.deliver" | "stop.exception";

export interface DriverEvent {
  eventId: string;
  deviceId: string;
  seq: number;
  type: DriverEventType;
  occurredAt: string;
  /** business-clock minute when it happened (the demo clock), used for arrival/leave times */
  atMin: number;
  tripId: string;
  stopId?: string;
  /** the stop version the phone saw when the driver acted (conflict detection) */
  baseVersion?: number;
  payload: Record<string, unknown>;
}

export type SyncOutcome = "APPLIED" | "APPLIED_WITH_CONFLICT" | "DUPLICATE" | "REJECTED";

export interface SyncResponse {
  results: Array<{ eventId: string; outcome: SyncOutcome; message?: string }>;
  pack: RunPack | null;
}
