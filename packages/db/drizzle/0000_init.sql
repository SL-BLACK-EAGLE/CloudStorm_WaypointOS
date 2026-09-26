CREATE TYPE "public"."brand" AS ENUM('Fresh', 'Style', 'Tech');--> statement-breakpoint
CREATE TYPE "public"."conflict_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."deferral_kind" AS ENUM('UNAVOIDABLE', 'CAPACITY_FORCED', 'CHOSEN', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."dock_decision" AS ENUM('HOLD', 'SEND_AND_WARN');--> statement-breakpoint
CREATE TYPE "public"."dock_type" AS ENUM('rear_dock', 'street', 'mall_bay');--> statement-breakpoint
CREATE TYPE "public"."exception_type" AS ENUM('outlet_closed', 'mall_gate_refused', 'goods_refused', 'access_blocked', 'vehicle_problem', 'other');--> statement-breakpoint
CREATE TYPE "public"."issue_kind" AS ENUM('damaged', 'missing', 'wrong_item', 'temperature');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('draft', 'confirmed', 'planned', 'loading', 'en_route', 'delivered', 'deferred', 'exception', 'cancelled', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."parking_constraint" AS ENUM('normal', 'van_only', 'mall_dock');--> statement-breakpoint
CREATE TYPE "public"."plan_mode" AS ENUM('2B', 'LIVE');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('draft', 'published', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."receipt_status" AS ENUM('confirmed', 'problem');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('dispatcher', 'loader', 'driver', 'store_manager');--> statement-breakpoint
CREATE TYPE "public"."shortfall_kind" AS ENUM('missing', 'damaged');--> statement-breakpoint
CREATE TYPE "public"."shortfall_status" AS ENUM('open', 'decided');--> statement-breakpoint
CREATE TYPE "public"."stop_status" AS ENUM('planned', 'arrived', 'delivered', 'exception', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."temp_requirement" AS ENUM('chilled', 'ambient');--> statement-breakpoint
CREATE TYPE "public"."trip_status" AS ENUM('planned', 'loading', 'ready', 'held', 'en_route', 'completed');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('pending', 'active', 'rejected', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."vehicle_status" AS ENUM('available', 'in_workshop');--> statement-breakpoint
CREATE TYPE "public"."vehicle_temp" AS ENUM('reefer', 'ambient');--> statement-breakpoint
CREATE TYPE "public"."vehicle_type" AS ENUM('truck', 'van');--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"justification" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_days" (
	"date" date PRIMARY KEY NOT NULL,
	"dow" integer NOT NULL,
	"dow_name" text NOT NULL,
	"is_weekend" integer NOT NULL,
	"iso_year" integer NOT NULL,
	"iso_week" integer NOT NULL,
	"is_payday" integer NOT NULL,
	"festival" text,
	"festival_ramp" real NOT NULL,
	"is_holiday" integer NOT NULL,
	"monsoon" integer NOT NULL,
	"is_operating" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"stop_id" uuid,
	"kind" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "conflict_status" DEFAULT 'open' NOT NULL,
	"resolution" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deferrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"order_id" text NOT NULL,
	"kind" "deferral_kind" NOT NULL,
	"reason_code" text NOT NULL,
	"lost_to_order_id" text,
	"explanation" text NOT NULL,
	"fairness" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"new_run_date" date,
	"decided_by" uuid,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "depots" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "districts" (
	"name" text PRIMARY KEY NOT NULL,
	"depot_id" text NOT NULL,
	"road_class" text NOT NULL,
	"free_flow_kmh" real NOT NULL,
	"depot_to_district_km" real NOT NULL,
	"depot_to_district_freeflow_min" integer NOT NULL,
	"inter_stop_km" real NOT NULL,
	"inter_stop_freeflow_min" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dock_signoffs" (
	"trip_id" uuid PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"signed_by" uuid,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forecasts" (
	"depot_id" text NOT NULL,
	"brand" "brand" NOT NULL,
	"iso_year" integer NOT NULL,
	"iso_week" integer NOT NULL,
	"total_m3" real NOT NULL,
	"chilled_m3" real NOT NULL,
	"source" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forecasts_depot_id_brand_iso_year_iso_week_pk" PRIMARY KEY("depot_id","brand","iso_year","iso_week")
);
--> statement-breakpoint
CREATE TABLE "fuel_ledger" (
	"vehicle_id" text NOT NULL,
	"iso_year" integer NOT NULL,
	"iso_week" integer NOT NULL,
	"litres_used" real DEFAULT 0 NOT NULL,
	CONSTRAINT "fuel_ledger_vehicle_id_iso_year_iso_week_pk" PRIMARY KEY("vehicle_id","iso_year","iso_week")
);
--> statement-breakpoint
CREATE TABLE "load_checks" (
	"trip_id" uuid NOT NULL,
	"order_id" text NOT NULL,
	"loaded_units" integer NOT NULL,
	"checked_by" uuid,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "load_checks_trip_id_order_id_pk" PRIMARY KEY("trip_id","order_id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_type" text NOT NULL,
	"thread_id" text NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_user_id" uuid,
	"recipient_role" "role",
	"outlet_id" text,
	"depot_id" text,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"severity" text DEFAULT 'info' NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"sku" text NOT NULL,
	"qty" integer NOT NULL,
	"kg" real NOT NULL,
	"m3" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"outlet_id" text NOT NULL,
	"brand" "brand" NOT NULL,
	"depot_id" text NOT NULL,
	"temp_requirement" "temp_requirement" NOT NULL,
	"requested_date" date NOT NULL,
	"run_date" date NOT NULL,
	"status" "order_status" DEFAULT 'confirmed' NOT NULL,
	"intake_reason" text DEFAULT 'ON_TIME' NOT NULL,
	"order_units" integer NOT NULL,
	"order_weight_kg" real NOT NULL,
	"order_volume_m3" real NOT NULL,
	"deferred_yesterday" integer DEFAULT 0 NOT NULL,
	"days_since_last_served" integer DEFAULT 1 NOT NULL,
	"defer_count" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'app' NOT NULL,
	"note" text,
	"created_by" uuid,
	"received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"topic" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"relayed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "outlets" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"brand" "brand" NOT NULL,
	"district" text NOT NULL,
	"depot_id" text NOT NULL,
	"dock_type" "dock_type" NOT NULL,
	"parking_constraint" "parking_constraint" NOT NULL,
	"mall_window" text,
	"window_open_min" integer NOT NULL,
	"window_close_min" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"depot_id" text NOT NULL,
	"run_date" date NOT NULL,
	"version" integer NOT NULL,
	"status" "plan_status" DEFAULT 'draft' NOT NULL,
	"mode" "plan_mode" DEFAULT 'LIVE' NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" uuid,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pods" (
	"stop_id" uuid PRIMARY KEY NOT NULL,
	"recipient_name" text,
	"signature_key" text,
	"photo_key" text,
	"units_handed" integer NOT NULL,
	"chilled_ok" boolean,
	"arrived_min" real NOT NULL,
	"completed_min" real NOT NULL,
	"device_id" text,
	"event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"sku" text PRIMARY KEY NOT NULL,
	"brand" "brand" NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"temp" "temp_requirement" NOT NULL,
	"unit_kg" real NOT NULL,
	"unit_m3" real NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipt_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" text NOT NULL,
	"kind" "issue_kind" NOT NULL,
	"units" integer NOT NULL,
	"note" text,
	"photo_key" text,
	"resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"order_id" text PRIMARY KEY NOT NULL,
	"status" "receipt_status" NOT NULL,
	"units_received" integer NOT NULL,
	"note" text,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "road_conditions" (
	"district" text NOT NULL,
	"date" date NOT NULL,
	"disruption_index" real NOT NULL,
	CONSTRAINT "road_conditions_district_date_pk" PRIMARY KEY("district","date")
);
--> statement-breakpoint
CREATE TABLE "service_allowances" (
	"brand" "brand" NOT NULL,
	"dock_type" "dock_type" NOT NULL,
	"service_allowance_min" integer NOT NULL,
	CONSTRAINT "service_allowances_brand_dock_type_pk" PRIMARY KEY("brand","dock_type")
);
--> statement-breakpoint
CREATE TABLE "shortfalls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"order_id" text NOT NULL,
	"kind" "shortfall_kind" NOT NULL,
	"units" integer NOT NULL,
	"note" text,
	"photo_key" text,
	"status" "shortfall_status" DEFAULT 'open' NOT NULL,
	"decision" "dock_decision",
	"decision_note" text,
	"reported_by" uuid,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "stop_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stop_id" uuid NOT NULL,
	"type" "exception_type" NOT NULL,
	"note" text,
	"photo_key" text,
	"units_returned" integer,
	"at_min" real,
	"created_by" uuid,
	"event_id" uuid,
	"resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"seq" integer NOT NULL,
	"user_id" uuid,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"outcome" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "traffic_speed" (
	"district" text NOT NULL,
	"hour" integer NOT NULL,
	"monsoon" integer NOT NULL,
	"speed_index" real NOT NULL,
	CONSTRAINT "traffic_speed_district_hour_monsoon_pk" PRIMARY KEY("district","hour","monsoon")
);
--> statement-breakpoint
CREATE TABLE "trip_stops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"order_id" text NOT NULL,
	"seq" integer NOT NULL,
	"planned_arrive_min" real,
	"planned_start_min" real,
	"planned_leave_min" real,
	"expected_arrive_min" real,
	"expected_leave_min" real,
	"late_risk" boolean DEFAULT false NOT NULL,
	"planned_late" boolean DEFAULT false NOT NULL,
	"eta_min" real,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "stop_status" DEFAULT 'planned' NOT NULL,
	"arrived_min" real,
	"left_min" real
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"code" text NOT NULL,
	"vehicle_id" text NOT NULL,
	"trip_no" integer NOT NULL,
	"brand" "brand" NOT NULL,
	"district" text NOT NULL,
	"departure_min" real,
	"back_min" real,
	"trip_minutes" integer NOT NULL,
	"litres" real NOT NULL,
	"status" "trip_status" DEFAULT 'planned' NOT NULL,
	"driver_user_id" uuid,
	"departed_min" real,
	"completed_min" real,
	"last_seen_min" real
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "role",
	"requested_role" "role",
	"status" "user_status" DEFAULT 'pending' NOT NULL,
	"depot_id" text,
	"outlet_id" text,
	"vehicle_id" text,
	"phone" text,
	"request_note" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"theme" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_clerk_user_id_unique" UNIQUE("clerk_user_id")
);
--> statement-breakpoint
CREATE TABLE "vehicle_days" (
	"vehicle_id" text NOT NULL,
	"date" date NOT NULL,
	"status" "vehicle_status" NOT NULL,
	"note" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_days_vehicle_id_date_pk" PRIMARY KEY("vehicle_id","date")
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" text PRIMARY KEY NOT NULL,
	"type" "vehicle_type" NOT NULL,
	"temp" "vehicle_temp" NOT NULL,
	"weight_cap_kg" real NOT NULL,
	"volume_cap_m3" real NOT NULL,
	"fuel_type" text NOT NULL,
	"km_per_l" real NOT NULL,
	"weekly_fuel_quota_l" real NOT NULL,
	"depot_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_event_id_sync_events_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."sync_events"("event_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_stop_id_trip_stops_id_fk" FOREIGN KEY ("stop_id") REFERENCES "public"."trip_stops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deferrals" ADD CONSTRAINT "deferrals_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deferrals" ADD CONSTRAINT "deferrals_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deferrals" ADD CONSTRAINT "deferrals_lost_to_order_id_orders_id_fk" FOREIGN KEY ("lost_to_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deferrals" ADD CONSTRAINT "deferrals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "districts" ADD CONSTRAINT "districts_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dock_signoffs" ADD CONSTRAINT "dock_signoffs_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dock_signoffs" ADD CONSTRAINT "dock_signoffs_signed_by_users_id_fk" FOREIGN KEY ("signed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_ledger" ADD CONSTRAINT "fuel_ledger_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_checks" ADD CONSTRAINT "load_checks_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_checks" ADD CONSTRAINT "load_checks_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_checks" ADD CONSTRAINT "load_checks_checked_by_users_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_sku_products_sku_fk" FOREIGN KEY ("sku") REFERENCES "public"."products"("sku") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlets" ADD CONSTRAINT "outlets_district_districts_name_fk" FOREIGN KEY ("district") REFERENCES "public"."districts"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlets" ADD CONSTRAINT "outlets_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pods" ADD CONSTRAINT "pods_stop_id_trip_stops_id_fk" FOREIGN KEY ("stop_id") REFERENCES "public"."trip_stops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_issues" ADD CONSTRAINT "receipt_issues_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shortfalls" ADD CONSTRAINT "shortfalls_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shortfalls" ADD CONSTRAINT "shortfalls_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shortfalls" ADD CONSTRAINT "shortfalls_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shortfalls" ADD CONSTRAINT "shortfalls_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stop_exceptions" ADD CONSTRAINT "stop_exceptions_stop_id_trip_stops_id_fk" FOREIGN KEY ("stop_id") REFERENCES "public"."trip_stops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stop_exceptions" ADD CONSTRAINT "stop_exceptions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_events" ADD CONSTRAINT "sync_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_district_districts_name_fk" FOREIGN KEY ("district") REFERENCES "public"."districts"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_driver_user_id_users_id_fk" FOREIGN KEY ("driver_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_days" ADD CONSTRAINT "vehicle_days_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "conflicts_status_idx" ON "conflicts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "deferrals_plan_idx" ON "deferrals" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "deferrals_order_idx" ON "deferrals" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "messages_thread_idx" ON "messages" USING btree ("thread_type","thread_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("recipient_user_id");--> statement-breakpoint
CREATE INDEX "notifications_outlet_idx" ON "notifications" USING btree ("outlet_id");--> statement-breakpoint
CREATE INDEX "order_lines_order_idx" ON "order_lines" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "orders_run_idx" ON "orders" USING btree ("depot_id","run_date");--> statement-breakpoint
CREATE INDEX "orders_outlet_idx" ON "orders" USING btree ("outlet_id","run_date");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox" USING btree ("id") WHERE "outbox"."relayed_at" is null;--> statement-breakpoint
CREATE INDEX "outlets_depot_idx" ON "outlets" USING btree ("depot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_version_idx" ON "plans" USING btree ("depot_id","run_date","version");--> statement-breakpoint
CREATE INDEX "shortfalls_trip_idx" ON "shortfalls" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "sync_device_idx" ON "sync_events" USING btree ("device_id","seq");--> statement-breakpoint
CREATE INDEX "stops_trip_idx" ON "trip_stops" USING btree ("trip_id","seq");--> statement-breakpoint
CREATE INDEX "stops_order_idx" ON "trip_stops" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "trips_plan_idx" ON "trips" USING btree ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trips_vehicle_idx" ON "trips" USING btree ("plan_id","vehicle_id","trip_no");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");