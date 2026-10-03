import "server-only";
import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { eq } from "@waypoint/db/orm";
import { db, t } from "./db";

/**
 * Object storage for proof-of-delivery photos, signatures and shortfall evidence.
 * Any S3-compatible store (SeaweedFS in docker, Neon Object Storage / S3 in the cloud) when
 * S3_ENDPOINT is set; otherwise Postgres (the `files` table), so a deployment needs no extra
 * service. Objects are never public: they are served through /api/files, which checks the
 * caller's session first.
 */
let client: S3Client | null = null;
let bucketReady: Promise<void> | null = null;

function s3() {
  client ??= new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? "us-east-1",
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    },
  });
  return client;
}

const bucket = () => process.env.S3_BUCKET ?? "waypoint-pod";

export function storageConfigured() {
  return !!process.env.S3_ENDPOINT && !!process.env.S3_ACCESS_KEY_ID;
}

async function ensureBucket() {
  bucketReady ??= (async () => {
    try {
      await s3().send(new HeadBucketCommand({ Bucket: bucket() }));
    } catch {
      await s3().send(new CreateBucketCommand({ Bucket: bucket() }));
    }
  })().catch((e) => {
    bucketReady = null;
    throw e;
  });
  return bucketReady;
}

export const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_BYTES = 3 * 1024 * 1024;

export async function putObject(key: string, body: Uint8Array, contentType: string) {
  if (!storageConfigured()) {
    const data = Buffer.from(body);
    await db().insert(t.files).values({ key, contentType, data }).onConflictDoUpdate({ target: t.files.key, set: { contentType, data } });
    return key;
  }
  await ensureBucket();
  await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType }));
  return key;
}

/** The stored bytes and their type, or null when the key does not exist. */
export async function getObject(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (!storageConfigured()) {
    const [row] = await db().select().from(t.files).where(eq(t.files.key, key));
    return row ? { bytes: new Uint8Array(row.data), contentType: row.contentType } : null;
  }
  try {
    const r = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
    const body = r.Body as { transformToByteArray: () => Promise<Uint8Array> };
    return { bytes: await body.transformToByteArray(), contentType: r.ContentType ?? "application/octet-stream" };
  } catch {
    return null;
  }
}
