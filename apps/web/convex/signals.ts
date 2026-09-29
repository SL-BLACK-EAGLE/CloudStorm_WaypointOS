import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/** Current version of each requested channel (0 when it never changed). Clients subscribe to this. */
export const versions = query({
  args: { channels: v.array(v.string()) },
  handler: async (ctx, { channels }) => {
    const out: Record<string, number> = {};
    for (const channel of channels.slice(0, 20)) {
      const row = await ctx.db
        .query("signals")
        .withIndex("by_channel", (q) => q.eq("channel", channel))
        .unique();
      out[channel] = row?.version ?? 0;
    }
    return out;
  },
});

/**
 * Called by the Next.js outbox relay with a batch of committed outbox rows. Guarded by a shared
 * secret (CONVEX_SERVER_SECRET) so browsers can read signals but never write them. Idempotent per
 * outbox id: a retried batch does not bump a channel twice for the same row.
 */
export const relay = mutation({
  args: {
    secret: v.string(),
    items: v.array(v.object({ outboxId: v.number(), topic: v.string(), channels: v.array(v.string()) })),
  },
  handler: async (ctx, { secret, items }) => {
    const expected = process.env.CONVEX_SERVER_SECRET;
    if (!expected || secret !== expected) throw new Error("forbidden");
    const now = Date.now();
    let applied = 0;
    for (const item of items) {
      const seen = await ctx.db
        .query("feed")
        .withIndex("by_outbox", (q) => q.eq("outboxId", item.outboxId))
        .unique();
      if (seen) continue;
      await ctx.db.insert("feed", { outboxId: item.outboxId, topic: item.topic, channels: item.channels, at: now });
      for (const channel of item.channels) {
        const row = await ctx.db
          .query("signals")
          .withIndex("by_channel", (q) => q.eq("channel", channel))
          .unique();
        if (row) await ctx.db.patch(row._id, { version: row.version + 1, topic: item.topic, outboxId: item.outboxId, at: now });
        else await ctx.db.insert("signals", { channel, version: 1, topic: item.topic, outboxId: item.outboxId, at: now });
      }
      applied++;
    }
    // keep the feed to the latest 500 rows
    const newest = await ctx.db.query("feed").withIndex("by_outbox").order("desc").take(501);
    if (newest.length > 500) {
      const cutoff = newest[500]!.outboxId;
      const old = await ctx.db
        .query("feed")
        .withIndex("by_outbox", (q) => q.lte("outboxId", cutoff))
        .take(200);
      for (const r of old) await ctx.db.delete(r._id);
    }
    return { applied };
  },
});
