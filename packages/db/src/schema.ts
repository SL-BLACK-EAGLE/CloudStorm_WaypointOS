/**
 * Neon Postgres schema - the system of record for Waypoint Delivery OS.
 *
 * Clock times of the plan are stored as minutes after midnight of the run date
 * (Asia/Colombo), the unit the planner works in. Device events also keep the
 * timestamp at which they happened (occurred_at) and were received (received_at).
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────── enums
export const brandEnum = pgEnum("brand", ["Fresh", "Style", "Tech"]);
export const dockEnum = pgEnum("dock_type", ["rear_dock", "street", "mall_bay"]);
export const parkingEnum = pgEnum("parking_constraint", ["normal", "van_only", "mall_dock"]);
export const tempEnum = pgEnum("temp_requirement", ["chilled", "ambient"]);
export const vehicleTypeEnum = pgEnum("vehicle_type", ["truck", "van"]);
export const vehicleTempEnum = pgEnum("vehicle_temp", ["reefer", "ambient"]);
export const vehicleStatusEnum = pgEnum("vehicle_status", ["available", "in_workshop"]);
export const roleEnum = pgEnum("role", ["dispatcher", "loader", "driver", "store_manager"]);
export const userStatusEnum = pgEnum("user_status", ["pending", "active", "rejected", "disabled"]);
export const orderStatusEnum = pgEnum("order_status", [
  "draft",
  "confirmed",
  "planned",
  "loading",
  "en_route",
  "delivered",
  "deferred",
  "exception",
  "cancelled",
  "rejected",
]);
export const planStatusEnum = pgEnum("plan_status", ["draft", "published", "superseded"]);
export const planModeEnum = pgEnum("plan_mode", ["2B", "LIVE"]);
export const tripStatusEnum = pgEnum("trip_status", ["planned", "loading", "ready", "held", "en_route", "completed"]);
export const stopStatusEnum = pgEnum("stop_status", ["planned", "arrived", "delivered", "exception", "skipped"]);
export const deferralKindEnum = pgEnum("deferral_kind", ["UNAVOIDABLE", "CAPACITY_FORCED", "CHOSEN", "MANUAL"]);
export const shortfallKindEnum = pgEnum("shortfall_kind", ["missing", "damaged"]);
export const shortfallStatusEnum = pgEnum("shortfall_status", ["open", "decided"]);
export const dockDecisionEnum = pgEnum("dock_decision", ["HOLD", "SEND_AND_WARN"]);
export const receiptStatusEnum = pgEnum("receipt_status", ["confirmed", "problem"]);
export const issueKindEnum = pgEnum("issue_kind", ["damaged", "missing", "wrong_item", "temperature"]);
export const exceptionTypeEnum = pgEnum("exception_type", [
  "outlet_closed",
  "mall_gate_refused",
  "goods_refused",
  "access_blocked",
  "vehicle_problem",
  "other",
]);
export const conflictStatusEnum = pgEnum("conflict_status", ["open", "resolved"]);

// ─────────────────────────────────────────────────────────────── reference data (seeded from CSV)
export const depots = pgTable("depots", {
  id: text("id").primaryKey(), // "Peliyagoda" | "Kandy"
  name: text("name").notNull(),
  kind: text("kind").notNull(), // "distribution_center" | "regional_hub"
});

export const districts = pgTable("districts", {
  name: text("name").primaryKey(),
  depotId: text("depot_id").notNull().references(() => depots.id),
  roadClass: text("road_class").notNull(),
  freeFlowKmh: real("free_flow_kmh").notNull(),
  depotKm: real("depot_to_district_km").notNull(),
  outboundMin: integer("depot_to_district_freeflow_min").notNull(),
  interStopKm: real("inter_stop_km").notNull(),
  interStopMin: integer("inter_stop_freeflow_min").notNull(),
});

export const outlets = pgTable(
  "outlets",
  {
    id: text("id").primaryKey(), // OUT001..OUT120
    name: text("name").notNull(),
    brand: brandEnum("brand").notNull(),
    district: text("district").notNull().references(() => districts.name),
    depotId: text("depot_id").notNull().references(() => depots.id),
    dockType: dockEnum("dock_type").notNull(),
    parking: parkingEnum("parking_constraint").notNull(),
    mallWindow: text("mall_window"),
    windowOpen: integer("window_open_min").notNull(),
    windowClose: integer("window_close_min").notNull(),
  },
  (t) => [index("outlets_depot_idx").on(t.depotId)],
);

export const vehicles = pgTable("vehicles", {
  id: text("id").primaryKey(), // VEH001..VEH060
  type: vehicleTypeEnum("type").notNull(),
  temp: vehicleTempEnum("temp").notNull(),
  weightCapKg: real("weight_cap_kg").notNull(),
  volumeCapM3: real("volume_cap_m3").notNull(),
  fuelType: text("fuel_type").notNull(),
  kmPerL: real("km_per_l").notNull(),
  weeklyFuelQuotaL: real("weekly_fuel_quota_l").notNull(),
  depotId: text("depot_id").notNull().references(() => depots.id),
});

export const vehicleDays = pgTable(
  "vehicle_days",
  {
    vehicleId: text("vehicle_id").notNull().references(() => vehicles.id),
    date: date("date").notNull(),
    status: vehicleStatusEnum("status").notNull(),
    note: text("note"),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.vehicleId, t.date] })],
);

export const serviceAllowances = pgTable(
  "service_allowances",
  {
    brand: brandEnum("brand").notNull(),
    dockType: dockEnum("dock_type").notNull(),
    minutes: integer("service_allowance_min").notNull(),
  },
  (t) => [primaryKey({ columns: [t.brand, t.dockType] })],
);

export const calendarDays = pgTable("calendar_days", {
  date: date("date").primaryKey(),
  dow: integer("dow").notNull(),
  dowName: text("dow_name").notNull(),
  isWeekend: integer("is_weekend").notNull(),
  isoYear: integer("iso_year").notNull(),
  isoWeek: integer("iso_week").notNull(),
  isPayday: integer("is_payday").notNull(),
  festival: text("festival"),
  festivalRamp: real("festival_ramp").notNull(),
  isHoliday: integer("is_holiday").notNull(),
  monsoon: integer("monsoon").notNull(),
  isOperating: integer("is_operating").notNull(),
});

export const trafficSpeed = pgTable(
  "traffic_speed",
  {
    district: text("district").notNull(),
    hour: integer("hour").notNull(),
    monsoon: integer("monsoon").notNull(),
    speedIndex: real("speed_index").notNull(),
  },
  (t) => [primaryKey({ columns: [t.district, t.hour, t.monsoon] })],
);

export const roadConditions = pgTable(
  "road_conditions",
  {
    district: text("district").notNull(),
    date: date("date").notNull(),
    disruptionIndex: real("disruption_index").notNull(),
  },
  (t) => [primaryKey({ columns: [t.district, t.date] })],
);

// ─────────────────────────────────────────────────────────────── people
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").unique(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: roleEnum("role"),
    requestedRole: roleEnum("requested_role"),
    status: userStatusEnum("status").notNull().default("pending"),
    depotId: text("depot_id").references(() => depots.id),
    outletId: text("outlet_id").references(() => outlets.id),
    vehicleId: text("vehicle_id").references(() => vehicles.id),
    phone: text("phone"),
    requestNote: text("request_note"),
    locale: text("locale").notNull().default("en"),
    theme: text("theme"),
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

// ─────────────────────────────────────────────────────────────── ordering
/** Illustrative catalogue (the dataset has order totals only); unit kg/m3 are calibrated from it. */
export const products = pgTable("products", {
  sku: text("sku").primaryKey(),
  brand: brandEnum("brand").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  temp: tempEnum("temp").notNull(),
  unitKg: real("unit_kg").notNull(),
  unitM3: real("unit_m3").notNull(),
  active: boolean("active").notNull().default(true),
});

export const orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey(), // ORD0085871 (dataset) or ORD9xxxxxx (app)
    outletId: text("outlet_id").notNull().references(() => outlets.id),
    brand: brandEnum("brand").notNull(),
    depotId: text("depot_id").notNull().references(() => depots.id),
    temp: tempEnum("temp_requirement").notNull(),
    requestedDate: date("requested_date").notNull(),
    runDate: date("run_date").notNull(),
    status: orderStatusEnum("status").notNull().default("confirmed"),
    intakeReason: text("intake_reason").notNull().default("ON_TIME"),
    units: integer("order_units").notNull(),
    weightKg: real("order_weight_kg").notNull(),
    volumeM3: real("order_volume_m3").notNull(),
    deferredYesterday: integer("deferred_yesterday").notNull().default(0),
    daysSinceLastServed: integer("days_since_last_served").notNull().default(1),
    deferCount: integer("defer_count").notNull().default(0),
    source: text("source").notNull().default("app"), // "dataset" | "app"
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("orders_run_idx").on(t.depotId, t.runDate),
    index("orders_outlet_idx").on(t.outletId, t.runDate),
    index("orders_status_idx").on(t.status),
  ],
);

export const orderLines = pgTable(
  "order_lines",
  {
    id: serial("id").primaryKey(),
    orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    sku: text("sku").notNull().references(() => products.sku),
    qty: integer("qty").notNull(),
    kg: real("kg").notNull(),
    m3: real("m3").notNull(),
  },
  (t) => [index("order_lines_order_idx").on(t.orderId)],
);

// ─────────────────────────────────────────────────────────────── planning
export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    depotId: text("depot_id").notNull().references(() => depots.id),
    runDate: date("run_date").notNull(),
    version: integer("version").notNull(),
    status: planStatusEnum("status").notNull().default("draft"),
    mode: planModeEnum("mode").notNull().default("LIVE"),
    /** served, deferred, chilled served, utilisation per limiting resource, optimality bound */
    metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull().default({}),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    publishedBy: uuid("published_by").references(() => users.id),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("plans_version_idx").on(t.depotId, t.runDate, t.version)],
);

export const trips = pgTable(
  "trips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id").notNull().references(() => plans.id, { onDelete: "cascade" }),
    code: text("code").notNull(), // e.g. R-1223-VEH005-1 (shown like the dataset's route ids)
    vehicleId: text("vehicle_id").notNull().references(() => vehicles.id),
    tripNo: integer("trip_no").notNull(),
    brand: brandEnum("brand").notNull(),
    district: text("district").notNull().references(() => districts.name),
    departureMin: real("departure_min"),
    backMin: real("back_min"),
    tripMinutes: integer("trip_minutes").notNull(),
    litres: real("litres").notNull(),
    status: tripStatusEnum("status").notNull().default("planned"),
    driverUserId: uuid("driver_user_id").references(() => users.id),
    departedMin: real("departed_min"),
    completedMin: real("completed_min"),
    lastSeenMin: real("last_seen_min"),
  },
  (t) => [index("trips_plan_idx").on(t.planId), uniqueIndex("trips_vehicle_idx").on(t.planId, t.vehicleId, t.tripNo)],
);

export const tripStops = pgTable(
  "trip_stops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id").notNull().references(() => trips.id, { onDelete: "cascade" }),
    orderId: text("order_id").notNull().references(() => orders.id),
    seq: integer("seq").notNull(),
    plannedArrive: real("planned_arrive_min"),
    plannedStart: real("planned_start_min"),
    plannedLeave: real("planned_leave_min"),
    expectedArrive: real("expected_arrive_min"),
    expectedLeave: real("expected_leave_min"),
    lateRisk: boolean("late_risk").notNull().default(false),
    plannedLate: boolean("planned_late").notNull().default(false),
    etaMin: real("eta_min"),
    /** bumped whenever the dispatcher changes this stop; offline events carry the version they saw */
    version: integer("version").notNull().default(1),
    status: stopStatusEnum("status").notNull().default("planned"),
    arrivedMin: real("arrived_min"),
    leftMin: real("left_min"),
  },
  (t) => [index("stops_trip_idx").on(t.tripId, t.seq), index("stops_order_idx").on(t.orderId)],
);

export const deferrals = pgTable(
  "deferrals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id").notNull().references(() => plans.id, { onDelete: "cascade" }),
    orderId: text("order_id").notNull().references(() => orders.id),
    kind: deferralKindEnum("kind").notNull(),
    reasonCode: text("reason_code").notNull(),
    lostToOrderId: text("lost_to_order_id").references(() => orders.id),
    explanation: text("explanation").notNull(),
    /** fairness snapshot at planning time: deferred_yesterday, days_since_last_served, weight */
    fairness: jsonb("fairness").$type<Record<string, number>>().notNull().default({}),
    newRunDate: date("new_run_date"),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [index("deferrals_plan_idx").on(t.planId), index("deferrals_order_idx").on(t.orderId)],
);

// ─────────────────────────────────────────────────────────────── dock
export const loadChecks = pgTable(
  "load_checks",
  {
    tripId: uuid("trip_id").notNull().references(() => trips.id, { onDelete: "cascade" }),
    orderId: text("order_id").notNull().references(() => orders.id),
    loadedUnits: integer("loaded_units").notNull(),
    checkedBy: uuid("checked_by").references(() => users.id),
    checkedAt: timestamp("checked_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.tripId, t.orderId] })],
);

export const shortfalls = pgTable(
  "shortfalls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id").notNull().references(() => trips.id, { onDelete: "cascade" }),
    orderId: text("order_id").notNull().references(() => orders.id),
    kind: shortfallKindEnum("kind").notNull(),
    units: integer("units").notNull(),
    note: text("note"),
    photoKey: text("photo_key"),
    status: shortfallStatusEnum("status").notNull().default("open"),
    decision: dockDecisionEnum("decision"),
    decisionNote: text("decision_note"),
    reportedBy: uuid("reported_by").references(() => users.id),
    reportedAt: timestamp("reported_at", { withTimezone: true }).defaultNow().notNull(),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [index("shortfalls_trip_idx").on(t.tripId)],
);

export const dockSignoffs = pgTable("dock_signoffs", {
  tripId: uuid("trip_id")
    .primaryKey()
    .references(() => trips.id, { onDelete: "cascade" }),
  state: text("state").notNull(), // RELEASED | RELEASED_HOLD | RELEASED_SEND_AND_WARN
  signedBy: uuid("signed_by").references(() => users.id),
  signedAt: timestamp("signed_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────── road
export const pods = pgTable("pods", {
  stopId: uuid("stop_id")
    .primaryKey()
    .references(() => tripStops.id, { onDelete: "cascade" }),
  recipientName: text("recipient_name"),
  signatureKey: text("signature_key"),
  photoKey: text("photo_key"),
  unitsHanded: integer("units_handed").notNull(),
  chilledOk: boolean("chilled_ok"),
  arrivedMin: real("arrived_min").notNull(),
  completedMin: real("completed_min").notNull(),
  deviceId: text("device_id"),
  eventId: uuid("event_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const stopExceptions = pgTable("stop_exceptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  stopId: uuid("stop_id")
    .notNull()
    .references(() => tripStops.id, { onDelete: "cascade" }),
  type: exceptionTypeEnum("type").notNull(),
  note: text("note"),
  photoKey: text("photo_key"),
  unitsReturned: integer("units_returned"),
  atMin: real("at_min"),
  createdBy: uuid("created_by").references(() => users.id),
  eventId: uuid("event_id"),
  resolved: boolean("resolved").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────── outlet
export const receipts = pgTable("receipts", {
  orderId: text("order_id")
    .primaryKey()
    .references(() => orders.id),
  status: receiptStatusEnum("status").notNull(),
  unitsReceived: integer("units_received").notNull(),
  note: text("note"),
  confirmedBy: uuid("confirmed_by").references(() => users.id),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }).defaultNow().notNull(),
});

export const receiptIssues = pgTable("receipt_issues", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id),
  kind: issueKindEnum("kind").notNull(),
  units: integer("units").notNull(),
  note: text("note"),
  photoKey: text("photo_key"),
  resolved: boolean("resolved").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────── communication
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadType: text("thread_type").notNull(), // "trip" | "order"
    threadId: text("thread_id").notNull(),
    authorId: uuid("author_id").references(() => users.id),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("messages_thread_idx").on(t.threadType, t.threadId)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipientUserId: uuid("recipient_user_id").references(() => users.id),
    recipientRole: roleEnum("recipient_role"),
    outletId: text("outlet_id").references(() => outlets.id),
    depotId: text("depot_id").references(() => depots.id),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    link: text("link"),
    severity: text("severity").notNull().default("info"), // info | late-risk | conflict | exception
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("notifications_user_idx").on(t.recipientUserId), index("notifications_outlet_idx").on(t.outletId)],
);

// ─────────────────────────────────────────────────────────────── capacity
export const fuelLedger = pgTable(
  "fuel_ledger",
  {
    vehicleId: text("vehicle_id").notNull().references(() => vehicles.id),
    isoYear: integer("iso_year").notNull(),
    isoWeek: integer("iso_week").notNull(),
    litresUsed: real("litres_used").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.vehicleId, t.isoYear, t.isoWeek] })],
);

export const forecasts = pgTable(
  "forecasts",
  {
    depotId: text("depot_id").notNull().references(() => depots.id),
    brand: brandEnum("brand").notNull(),
    isoYear: integer("iso_year").notNull(),
    isoWeek: integer("iso_week").notNull(),
    totalM3: real("total_m3").notNull(),
    chilledM3: real("chilled_m3").notNull(),
    source: text("source").notNull(), // "baseline" | "datathon"
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.depotId, t.brand, t.isoYear, t.isoWeek] })],
);

// ─────────────────────────────────────────────────────────────── sync, audit, outbox
export const syncEvents = pgTable(
  "sync_events",
  {
    eventId: uuid("event_id").primaryKey(), // client-generated; the idempotency key
    deviceId: text("device_id").notNull(),
    seq: integer("seq").notNull(),
    userId: uuid("user_id").references(() => users.id),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    outcome: text("outcome").notNull(),
  },
  (t) => [index("sync_device_idx").on(t.deviceId, t.seq)],
);

export const conflicts = pgTable(
  "conflicts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id").references(() => syncEvents.eventId),
    stopId: uuid("stop_id").references(() => tripStops.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // STOP_RESEQUENCED | STOP_REASSIGNED | STORE_ALREADY_REPORTED | ...
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    status: conflictStatusEnum("status").notNull().default("open"),
    resolution: text("resolution"),
    resolvedBy: uuid("resolved_by").references(() => users.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("conflicts_status_idx").on(t.status)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorId: uuid("actor_id").references(() => users.id),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    justification: text("justification"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("audit_entity_idx").on(t.entity, t.entityId)],
);

/** Transactional outbox: written in the same transaction as the change, relayed to Convex by QStash. */
export const outbox = pgTable(
  "outbox",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    topic: text("topic").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    relayedAt: timestamp("relayed_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (t) => [index("outbox_pending_idx").on(t.id).where(sql`${t.relayedAt} is null`)],
);

/** Key/value settings, e.g. the demo clock. */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Binary column (Postgres bytea). */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/**
 * Signatures and photos when no S3-compatible store is configured (the hosted demo). They are
 * small (the phone downscales photos before upload) and live next to the records that use them.
 */
export const files = pgTable("files", {
  key: text("key").primaryKey(),
  contentType: text("content_type").notNull(),
  data: bytea("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
