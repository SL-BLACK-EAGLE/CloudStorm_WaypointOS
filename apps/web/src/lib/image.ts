/** Client-side image downscaling: phones take 4-12 MB photos; the evidence needs ~150 KB. */
export async function downscale(file: Blob, maxSide = 1280, quality = 0.72): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", quality));
}

export async function uploadImage(blob: Blob, kind: "pod" | "signature" | "shortfall" | "receipt" | "exception", id?: string): Promise<string> {
  const f = new FormData();
  f.set("file", new File([blob], `${kind}.jpg`, { type: blob.type || "image/jpeg" }));
  f.set("kind", kind);
  if (id) f.set("id", id);
  const r = await fetch("/api/uploads", { method: "POST", body: f });
  const j = (await r.json()) as { key?: string; error?: string };
  if (!r.ok || !j.key) throw new Error(j.error ?? "Upload failed");
  return j.key;
}
