import { NextResponse } from "next/server";
import { z } from "zod";
import { inbox, markRead } from "@/lib/server/inbox";
import { userForApi } from "@/lib/server/session";

export async function GET() {
  const user = await userForApi();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await inbox(user), { headers: { "cache-control": "no-store" } });
}

/** { ids?: string[] } - mark those (or everything) read. */
export async function POST(req: Request) {
  const user = await userForApi();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = z.object({ ids: z.array(z.uuid()).max(100).optional() }).safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  await markRead(user, body.data.ids);
  return NextResponse.json(await inbox(user));
}
