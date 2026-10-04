import { PageTour } from "@/components/wp/tour";
import { PEOPLE_TOUR } from "@/lib/tours/dispatcher";
import type { Metadata } from "next";
import { ActionButton } from "@/components/wp/action-button";
import { Panel, PanelHeader } from "@/components/wp/panel";
import { PromptAction } from "@/components/wp/prompt-action";
import { colombo } from "@/lib/format";
import { ROLE_LABEL, type Role } from "@/lib/roles";
import { people } from "@/lib/server/people";
import { requireUser } from "@/lib/server/session";
import { cn } from "@/lib/utils";
import { DispatchHeader } from "../_components/header";
import { rejectAction, setDisabledAction } from "./actions";
import { AssignForm } from "./assign-form";

export const metadata: Metadata = { title: "People and access" };

/** Access requests from sign-up (request → dispatcher approves), and every account's role and scope. */
export default async function PeoplePage() {
  const me = await requireUser(["dispatcher"]);
  const { users, outlets, vehicles } = await people();
  const pending = users.filter((u) => u.status === "pending" && u.requestedRole);
  const active = users.filter((u) => u.status === "active");
  const other = users.filter((u) => u.status === "rejected" || u.status === "disabled" || (u.status === "pending" && !u.requestedRole));
  const scope = (u: (typeof users)[number]) =>
    [u.outletId, u.role !== "store_manager" ? u.depotId : null, u.vehicleId].filter(Boolean).join(" · ") || "—";

  return (
    <>
      <PageTour id="people" steps={PEOPLE_TOUR} />
      <DispatchHeader title="People and access" context={`${pending.length} waiting · ${active.length} active`} />
      <main className="space-y-5 p-6">
        <Panel data-tour="requests">
          <PanelHeader title="Access requests" aside="New sign-ups choose a role; you approve the role and its scope" />
          <ul className="divide-y">
            {pending.map((u) => (
              <li key={u.id} className="space-y-3 p-4">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <p className="font-medium">{u.name}</p>
                  <p className="text-sm text-muted-foreground">{u.email}</p>
                  {u.phone && <p className="num text-sm text-muted-foreground">{u.phone}</p>}
                  <p className="ml-auto text-[13px] text-muted-foreground">requested {colombo(u.createdAt)}</p>
                </div>
                <p className="text-sm">
                  Asks to be <strong>{ROLE_LABEL[u.requestedRole as Role]}</strong>
                  {u.outletId ? ` for ${u.outletId}` : u.depotId ? ` at ${u.depotId}` : ""}
                  {u.vehicleId ? ` · ${u.vehicleId}` : ""}
                  {u.requestNote ? <span className="text-muted-foreground"> · “{u.requestNote}”</span> : null}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <AssignForm
                    userId={u.id}
                    initial={{ role: u.requestedRole as Role, depotId: u.depotId, outletId: u.outletId, vehicleId: u.vehicleId }}
                    outlets={outlets}
                    vehicles={vehicles}
                    submitLabel="Approve"
                  />
                  <PromptAction
                    action={rejectAction}
                    fields={{ userId: u.id }}
                    title={`Decline ${u.name}'s request?`}
                    description="They see this reason and can ask again."
                    placeholder="e.g. Please ask your area manager to confirm your outlet first."
                    submitLabel="Decline"
                    size="sm"
                    variant="outline"
                  >
                    Decline
                  </PromptAction>
                </div>
              </li>
            ))}
            {pending.length === 0 && <li className="p-4 text-sm text-muted-foreground">No one is waiting for access.</li>}
          </ul>
        </Panel>

        <Panel className="overflow-hidden" data-tour="accounts">
          <PanelHeader title="Active accounts" aside="Authorization is checked on the server for every page and action" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[13px] text-muted-foreground">
                <tr className="border-b">
                  <th className="px-4 py-2 font-medium">Person</th>
                  <th className="px-3 py-2 font-medium">Role · scope</th>
                  <th className="px-3 py-2 font-medium">Change</th>
                  <th className="px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {active.map((u) => (
                  <tr key={u.id} className="border-b align-top last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium">
                        {u.name} {u.id === me.id && <span className="text-[13px] font-normal text-muted-foreground">(you)</span>}
                      </p>
                      <p className="text-[13px] text-muted-foreground">{u.email}</p>
                    </td>
                    <td className="px-3 py-3">
                      <p>{u.role ? ROLE_LABEL[u.role] : "—"}</p>
                      <p className="num text-[13px] text-muted-foreground">{scope(u)}</p>
                    </td>
                    <td className="px-3 py-3">
                      <AssignForm
                        userId={u.id}
                        initial={{ role: u.role, depotId: u.depotId, outletId: u.outletId, vehicleId: u.vehicleId }}
                        outlets={outlets}
                        vehicles={vehicles}
                        submitLabel="Save"
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {u.id !== me.id && (
                        <ActionButton
                          action={setDisabledAction}
                          fields={{ userId: u.id, disabled: "1" }}
                          confirm={`Disable ${u.name}? They will not be able to use the app until re-enabled.`}
                          size="sm"
                          variant="ghost"
                          className="text-exception"
                        >
                          Disable
                        </ActionButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        {other.length > 0 && (
          <Panel>
            <PanelHeader title="Declined, disabled and unfinished" />
            <ul className="divide-y">
              {other.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <span className="font-medium">{u.name}</span>
                  <span className="text-muted-foreground">{u.email}</span>
                  <span className={cn("rounded border px-1.5 text-[12px]", u.status === "disabled" && "border-exception-border text-exception")}>
                    {u.status === "pending" ? "has not chosen a role" : u.status}
                  </span>
                  {u.status === "disabled" && (
                    <ActionButton action={setDisabledAction} fields={{ userId: u.id, disabled: "0" }} size="sm" variant="outline" className="ml-auto">
                      Enable
                    </ActionButton>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </main>
    </>
  );
}
