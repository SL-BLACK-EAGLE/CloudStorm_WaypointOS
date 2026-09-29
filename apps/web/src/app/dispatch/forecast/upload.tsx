"use client";

import { Loader2, Upload } from "lucide-react";
import { useRef, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { uploadForecastAction } from "./actions";

export function ForecastUpload({ label = "Load forecast file", variant = "default" }: { label?: string; variant?: "default" | "outline" }) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          start(async () => {
            const form = new FormData();
            form.set("file", f);
            const r = await uploadForecastAction(form);
            if (r.ok) toast.success(r.message);
            else toast.error(r.error);
          });
        }}
      />
      <Button size="desk" variant={variant} disabled={pending} onClick={() => input.current?.click()}>
        {pending ? <Loader2 className="animate-spin" /> : <Upload />} {label}
      </Button>
    </>
  );
}
