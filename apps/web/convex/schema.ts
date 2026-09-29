import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Convex is the realtime layer, not a second database: Postgres (Neon) holds every business
 * record, and the transactional outbox relays "this changed" signals here. Screens subscribe to
 * the channels they show and re-read from the server when a version moves - so nothing private
 * leaves Postgres and a missed signal can never show stale or uncommitted data.
 */
export default defineSchema({
  signals: defineTable({
    channel: v.string(), // ops | depot:Peliyagoda | trip:<uuid> | outlet:OUT006 | user:<uuid> | role:dispatcher
    version: v.number(),
    topic: v.string(), // last outbox topic, e.g. "sync.applied"
    outboxId: v.number(), // last relayed outbox row
    at: v.number(),
  }).index("by_channel", ["channel"]),

  // recent change feed (last 500), for the live screens' "what just happened" and debugging the relay
  feed: defineTable({
    outboxId: v.number(),
    topic: v.string(),
    channels: v.array(v.string()),
    at: v.number(),
  }).index("by_outbox", ["outboxId"]),
});
