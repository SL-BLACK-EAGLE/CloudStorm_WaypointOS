import { internalAction } from "./_generated/server";

/**
 * Departure watch, run every minute by crons.ts. Business data lives in Postgres, so the check
 * itself runs in the app: this action calls /api/cron/departures with the shared server secret.
 * Needs APP_URL and CONVEX_SERVER_SECRET in this deployment's environment.
 */
export const tick = internalAction({
  args: {},
  handler: async () => {
    const appUrl = process.env.APP_URL?.replace(/\/$/, "");
    const secret = process.env.CONVEX_SERVER_SECRET;
    if (!appUrl || !secret) return { skipped: "set APP_URL and CONVEX_SERVER_SECRET in the Convex environment" };
    const res = await fetch(`${appUrl}/api/cron/departures`, { method: "POST", headers: { authorization: `Bearer ${secret}` } });
    return { status: res.status, body: (await res.text()).slice(0, 300) };
  },
});
