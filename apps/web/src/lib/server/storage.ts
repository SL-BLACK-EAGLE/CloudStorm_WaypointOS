import "server-only";
import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/**
 * Object storage for proof-of-delivery photos, signatures and shortfall evidence.
 * Neon Object Storage in the cloud and SeaweedFS in docker - both speak the S3 API,
 * so this is the only storage code. Objects are never public: they are served through
 * /api/files, which checks the caller's session first.
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
  await ensureBucket();
  await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType }));
  return key;
}

export async function getObject(key: string) {
  const r = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  return { body: r.Body, contentType: r.ContentType ?? "application/octet-stream" };
}
