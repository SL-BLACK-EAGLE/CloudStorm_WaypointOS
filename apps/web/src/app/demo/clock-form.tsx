"use client";

import { Pause, Play } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setClockAction } from "./actions";

export function ClockForm({ current, running, speed }: { current: string; running: boolean; speed: number }) {
  const [at, setAt] = useState(current);
  const [sp, setSp] = useState(String(speed));
  const [pending, start] = useTransition();
  const send = (fields: Record<string, string>) =>
    start(async () => {
      const f = new FormData();
      for (const [k, v] of Object.entries(fields)) f.set(k, v);
      const r = await setClockAction(f);
      if (r.ok) toast.success(r.message);
      else toast.error(r.error);
    });
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="space-y-1 text-sm">
        <span className="block text-muted-foreground">Set exact time</span>
        <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} min="2024-01-01T00:00" max="2026-06-28T23:59" />
      </label>
      <Button size="desk" variant="secondary" disabled={pending} onClick={() => send({ at, running: running ? "1" : "0" })}>
        Set
      </Button>
      <label className="space-y-1 text-sm">
        <span className="block text-muted-foreground">Speed</span>
        <select value={sp} onChange={(e) => setSp(e.target.value)} className="h-9 rounded-md border bg-background px-2">
          {["1", "10", "60", "120"].map((s) => (
            <option key={s} value={s}>
              ×{s}
            </option>
          ))}
        </select>
      </label>
      <Button size="desk" disabled={pending} onClick={() => send({ running: running ? "0" : "1", speed: sp })}>
        {running ? <Pause /> : <Play />} {running ? "Pause" : "Run clock"}
      </Button>
    </div>
  );
}
