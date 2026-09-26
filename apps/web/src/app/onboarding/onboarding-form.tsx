"use client";

import { Loader2, Package, Route, Store, Truck } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ROLE_BLURB, ROLE_LABEL, ROLES, type Role } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { requestAccess, type OnboardingState } from "./actions";

const ICON: Record<Role, typeof Route> = { dispatcher: Route, loader: Package, driver: Truck, store_manager: Store };

export function OnboardingForm({
  defaultName,
  outlets,
  vehicles,
}: {
  defaultName: string;
  outlets: Array<{ id: string; name: string; brand: string; district: string }>;
  vehicles: Array<{ id: string; type: string; temp: string; depotId: string }>;
}) {
  const [state, action, pending] = useActionState<OnboardingState, FormData>(requestAccess, undefined);
  const [role, setRole] = useState<Role>("store_manager");
  const [depot, setDepot] = useState<string>("Peliyagoda");
  const err = (k: string) => state?.fieldErrors?.[k]?.[0];

  return (
    <form action={action} className="space-y-6" noValidate>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">Role</legend>
        <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
          {ROLES.map((r) => {
            const Icon = ICON[r];
            const on = role === r;
            return (
              <label
                key={r}
                className={cn(
                  "flex cursor-pointer gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-muted",
                  on && "border-foreground ring-1 ring-foreground",
                )}
              >
                <input type="radio" name="role" value={r} checked={on} onChange={() => setRole(r)} className="sr-only" />
                <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
                <span>
                  <span className="block text-sm font-semibold">{ROLE_LABEL[r]}</span>
                  <span className="block text-[13px] leading-5 text-muted-foreground">{ROLE_BLURB[r]}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="name">Full name</Label>
          <Input id="name" name="name" defaultValue={defaultName} required aria-invalid={!!err("name")} />
          {err("name") && <p className="text-[13px] text-destructive">{err("name")}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">Phone (optional)</Label>
          <Input id="phone" name="phone" type="tel" inputMode="tel" placeholder="07X XXX XXXX" />
        </div>
      </div>

      {role === "store_manager" ? (
        <div className="space-y-1.5">
          <Label htmlFor="outletId">Your outlet</Label>
          <Select name="outletId">
            <SelectTrigger id="outletId" className="w-full" aria-invalid={!!err("outletId")}>
              <SelectValue placeholder="Choose the outlet you manage" />
            </SelectTrigger>
            <SelectContent>
              {outlets.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  <span className="num">{o.id}</span> · {o.brand} · {o.district}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {err("outletId") && <p className="text-[13px] text-destructive">{err("outletId")}</p>}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="depotId">Depot</Label>
            <Select name="depotId" value={depot} onValueChange={setDepot}>
              <SelectTrigger id="depotId" className="w-full" aria-invalid={!!err("depotId")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Peliyagoda">Peliyagoda distribution center</SelectItem>
                <SelectItem value="Kandy">Kandy regional hub</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {role === "driver" && (
            <div className="space-y-1.5">
              <Label htmlFor="vehicleId">Your vehicle</Label>
              <Select name="vehicleId">
                <SelectTrigger id="vehicleId" className="w-full">
                  <SelectValue placeholder="Vehicle you usually drive" />
                </SelectTrigger>
                <SelectContent>
                  {vehicles
                    .filter((v) => v.depotId === depot)
                    .map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        <span className="num">{v.id}</span> · {v.temp} {v.type}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="note">Note for the dispatcher (optional)</Label>
        <Textarea id="note" name="note" rows={3} placeholder="e.g. Night-shift loader, bay 4" />
      </div>

      {state?.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" size="field" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        Send request for approval
      </Button>
    </form>
  );
}
