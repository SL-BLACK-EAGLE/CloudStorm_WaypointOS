"use client";

import { Ban, Check, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { signOffAction } from "../../actions";

/** The locked button always says why (DS-01: "Disabled buttons always say why"). */
export function SignOffButton({ tripId, vehicleId, reefer, blockedReason }: { tripId: string; vehicleId: string; reefer: boolean; blockedReason: string | null }) {
  const [sealed, setSealed] = useState(!reefer);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3" data-tour="signoff">
      {reefer && (
        <label className={cn("flex min-h-16 cursor-pointer items-center gap-3 rounded-lg border-2 border-foreground p-3 text-lg font-semibold", sealed && "bg-muted")}>
          <input type="checkbox" checked={sealed} onChange={(e) => setSealed(e.target.checked)} className="size-7 accent-current" />
          Reefer unit running, doors sealed
        </label>
      )}
      <Button
        size="hero"
        disabled={!!blockedReason || !sealed || pending}
        className={cn(blockedReason && "hatch-violation !opacity-100")}
        onClick={() =>
          start(async () => {
            const f = new FormData();
            f.set("tripId", tripId);
            f.set("reefer", sealed ? "1" : "0");
            const r = await signOffAction(f);
            if (r.ok) toast.success(r.message);
            else toast.error(r.error);
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" /> : blockedReason ? <Ban /> : <Check />}
        {blockedReason ?? (sealed ? `Sign off ${vehicleId} to leave` : "Confirm the reefer check first")}
      </Button>
    </div>
  );
}
