export type Brand = "Fresh" | "Style" | "Tech";
export type Dock = "rear_dock" | "street" | "mall_bay";
export type Parking = "normal" | "van_only" | "mall_dock";
export type Temp = "chilled" | "ambient";
export type VehicleType = "truck" | "van";
export type VehicleTemp = "reefer" | "ambient";
export type VehicleStatus = "available" | "in_workshop";
/** "2B" = booklet rules only (Task 2B checker); "LIVE" = rules + clock time + fuel + risk. */
export type Mode = "2B" | "LIVE";
/** Time models (flowchart section 1). */
export type TimeModel = "planned" | "expected";
export type Window = "Fresh" | "Day";

export interface Outlet {
  id: string;
  brand: Brand;
  district: string;
  depot: string;
  dock: Dock;
  parking: Parking;
  /** window open, minutes after midnight (mall window for mall outlets) */
  open: number;
  /** window close, minutes after midnight */
  close: number;
}

export interface Vehicle {
  id: string;
  type: VehicleType;
  temp: VehicleTemp;
  capKg: number;
  capM3: number;
  kmPerL: number;
  weeklyQuotaL: number;
  depot: string;
}

export interface District {
  name: string;
  depot: string;
  /** depot_to_district_freeflow_min */
  outboundMin: number;
  /** inter_stop_freeflow_min */
  interStopMin: number;
  depotKm: number;
  interStopKm: number;
  freeFlowKmh: number;
}

export interface CalendarDay {
  date: string;
  isOperating: number;
  monsoon: number;
  festivalRamp: number;
  isPayday: number;
  isoYear: number;
  isoWeek: number;
}

/** Input shape of an order (what the database or a fixture provides). */
export interface OrderInput {
  ref: string;
  outletId: string;
  temp: Temp;
  units: number;
  kg: number;
  m3: number;
  /** 1 if the outlet was skipped on the previous run */
  deferredYesterday?: number;
  daysSinceLastServed?: number;
}

/**
 * An order bound to its outlet. Orders are compared by identity (like the Python
 * dataclass with eq=False): two orders are never "equal" by value.
 */
export interface Order {
  readonly ref: string;
  readonly outletId: string;
  readonly temp: Temp;
  readonly units: number;
  readonly kg: number;
  readonly m3: number;
  readonly deferredYesterday: number;
  readonly daysSinceLastServed: number;
  readonly outlet: Outlet;
}

/** Calendar and road context for EXPECTED times. */
export interface DayContext {
  date: string | null;
  monsoon: number;
  festivalRamp: number;
  payday: number;
  /** district -> index, 100 = clear */
  disruption: Record<string, number>;
}

export interface Leg {
  ref: string;
  outletId: string;
  depart: number;
  travel: number;
  arrive: number;
  wait: number;
  start: number;
  service: number;
  leave: number;
  close: number;
  /** close - arrive */
  slack: number;
  /** arrive > close */
  late: boolean;
  /** EXPECTED only: close - arrive < risk margin */
  risk: boolean;
}

export interface Check {
  ok: boolean;
  /** first failing rule, null when ok */
  code: string | null;
  /** [(sequenced stops, departure T0)] in driving order; T0 null in 2B mode */
  timed: Array<[Order[], number | null]> | null;
}

export type DeferralKind = "UNAVOIDABLE" | "CAPACITY_FORCED" | "CHOSEN";

export interface Deferral {
  ref: string;
  kind: DeferralKind;
  reason: string;
  lostTo: string | null;
}

export interface TimedTrip {
  vehicleId: string;
  number: number;
  stops: Order[];
  departure: number | null;
  tripMinutes: number;
  litres: number;
  planned: Leg[];
  backPlanned: number | null;
  expected: Leg[];
  backExpected: number | null;
}

export interface Plan {
  mode: Mode;
  /** vehicle_id -> [trip, trip], each trip a list of Orders (insertion order = fleet order) */
  trips: Map<string, Order[][]>;
  /** order ref -> Deferral (insertion order preserved) */
  deferrals: Map<string, Deferral>;
  /** timed trips ready to publish, in vehicle order then driving order */
  timed: TimedTrip[];
}

export interface Eta {
  ref: string;
  outletId: string;
  eta: number;
  close: number;
  /** K7: ETA > close - risk margin */
  risk: boolean;
  late: boolean;
}
