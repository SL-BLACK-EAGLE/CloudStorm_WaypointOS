import { Receiver } from "@upstash/qstash";
import { NextResponse } from "next/server";
import { runDepartureAlerts } from "@/lib/server/departures";
import { triggerRelay } from "@/lib/server/relay-runner";

/**
 * Background jobs, called by Upstash QStash (retried, signed). The signature is checked against
 * the current and next signing keys, so key rotation never drops a call.
 *   relay      - sweep the transactional outbox into Convex (backs up the per-request kick)
 *   departures - departure alerts (normally run by the Convex cron; a backup path)
 */
const JOBS: Record<string, () => Promise<unknown>> = {
  relay: () => triggerRelay(),
  departures: async () => {
    const r = await runDepartureAlerts();
    await triggerRelay();
    return r;
  },
};

export async function POST(req: Request, ctx: RouteContext<"/api/jobs/[job]">) {
  const { job } = await ctx.params;
  const run = JOBS[job];
  if (!run) return NextResponse.json({ error: "unknown job" }, { status: 404 });

  const current = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const next = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!current || !next) return NextResponse.json({ error: "jobs are not configured" }, { status: 503 });
  const signature = req.headers.get("upstash-signature");
  const body = await req.text();
  if (!signature) return NextResponse.json({ error: "missing signature" }, { status: 401 });
  try {
    await new Receiver({ currentSigningKey: current, nextSigningKey: next }).verify({ signature, body });
  } catch {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }
  const result = await run();
  return NextResponse.json({ job, result });
}
