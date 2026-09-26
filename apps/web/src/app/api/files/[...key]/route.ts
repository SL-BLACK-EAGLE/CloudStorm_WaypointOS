import { userForApi } from "@/lib/server/session";
import { getObject } from "@/lib/server/storage";

/** Streams a stored photo/signature to any signed-in, approved user (objects are never public). */
export async function GET(_req: Request, ctx: RouteContext<"/api/files/[...key]">) {
  const user = await userForApi();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { key } = await ctx.params;
  const path = key.join("/");
  if (!/^(pod|signature|shortfall|receipt|exception)\/[\w./-]+$/.test(path)) return new Response("Not found", { status: 404 });
  try {
    const obj = await getObject(path);
    const body = obj.body as { transformToByteArray: () => Promise<Uint8Array> };
    return new Response(Buffer.from(await body.transformToByteArray()), {
      headers: { "Content-Type": obj.contentType, "Cache-Control": "private, max-age=86400, immutable" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
