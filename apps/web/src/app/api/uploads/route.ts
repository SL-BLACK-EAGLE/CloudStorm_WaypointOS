import { randomUUID } from "node:crypto";
import { userForApi } from "@/lib/server/session";
import { ALLOWED_TYPES, MAX_BYTES, putObject, storageConfigured } from "@/lib/server/storage";

const KINDS = ["pod", "signature", "shortfall", "receipt", "exception"] as const;

/**
 * Photo / signature upload. The client downscales images before sending, and the offline
 * driver outbox replays this call after reconnecting, so it accepts a client-chosen id
 * (idempotent: the same id writes the same key).
 */
export async function POST(req: Request) {
  const user = await userForApi();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!storageConfigured()) return Response.json({ error: "Object storage is not configured" }, { status: 503 });
  const form = await req.formData();
  const file = form.get("file");
  const kind = String(form.get("kind") ?? "");
  const id = String(form.get("id") ?? "") || randomUUID();
  if (!(file instanceof File)) return Response.json({ error: "No file" }, { status: 400 });
  if (!KINDS.includes(kind as (typeof KINDS)[number])) return Response.json({ error: "Unknown kind" }, { status: 400 });
  if (!ALLOWED_TYPES.includes(file.type as (typeof ALLOWED_TYPES)[number])) return Response.json({ error: "Images only (JPEG, PNG, WebP)" }, { status: 415 });
  if (file.size > MAX_BYTES) return Response.json({ error: "Image is larger than 3 MB" }, { status: 413 });
  if (!/^[\w-]{8,64}$/.test(id)) return Response.json({ error: "Bad id" }, { status: 400 });
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const key = `${kind}/${new Date().toISOString().slice(0, 10)}/${id}.${ext}`;
  await putObject(key, new Uint8Array(await file.arrayBuffer()), file.type);
  return Response.json({ key, url: `/api/files/${key}` });
}
