"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ROLE_LABEL, ROLES, type Role } from "@/lib/roles";
import { assignAction } from "./actions";

const field = "h-9 rounded-md border bg-background px-2 text-sm";

/** Role + scope editor for one person: approve a request, or change an active account. */
export function AssignForm({
  userId,
  initial,
  outlets,
  vehicles,
  submitLabel,
}: {
  userId: string;
  initial: { role: Role | null; depotId: string | null; outletId: string | null; vehicleId: string | null };
  outlets: Array<{ id: string; name: string; district: string; brand: string; depotId: string }>;
  vehicles: Array<{ id: string; type: string; temp: string; depotId: string }>;
  submitLabel: string;
}) {
  const [role, setRole] = useState<Role>(initial.role ?? "store_manager");
  const [depot, setDepot] = useState(initial.depotId ?? "Peliyagoda");
  const [outlet, setOutlet] = useState(initial.outletId ?? "");
  const [vehicle, setVehicle] = useState(initial.vehicleId ?? "");
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Role" className={field} value={role} onChange={(e) => setRole(e.target.value as Role)}>
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABEL[r]}
          </option>
        ))}
      </select>
      {role === "store_manager" ? (
        <select aria-label="Outlet" className={field} value={outlet} onChange={(e) => setOutlet(e.target.value)}>
          <option value="">Outlet…</option>
          {outlets.map((o) => (
            <option key={o.id} value={o.id}>
              {o.id} · {o.brand} · {o.district}
            </option>
          ))}
        </select>
      ) : (
        <select aria-label="Depot" className={field} value={depot} onChange={(e) => setDepot(e.target.value)}>
          <option value="Peliyagoda">Peliyagoda</option>
          <option value="Kandy">Kandy</option>
        </select>
      )}
      {role === "driver" && (
        <select aria-label="Vehicle" className={field} value={vehicle} onChange={(e) => setVehicle(e.target.value)}>
          <option value="">No fixed vehicle</option>
          {vehicles
            .filter((v) => v.depotId === depot)
            .map((v) => (
              <option key={v.id} value={v.id}>
                {v.id} · {v.temp} {v.type}
              </option>
            ))}
        </select>
      )}
      <Button
        size="sm"
        disabled={pending || (role === "store_manager" && !outlet)}
        onClick={() =>
          start(async () => {
            const f = new FormData();
            f.set("userId", userId);
            f.set("role", role);
            if (role !== "store_manager") f.set("depotId", depot);
            if (role === "store_manager") f.set("outletId", outlet);
            if (role === "driver" && vehicle) f.set("vehicleId", vehicle);
            const r = await assignAction(f);
            if (r.ok) toast.success(r.message);
            else toast.error(r.error);
          })
        }
      >
        {pending && <Loader2 className="animate-spin" />}
        {submitLabel}
      </Button>
    </div>
  );
}
