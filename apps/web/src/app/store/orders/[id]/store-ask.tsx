import { RotateCcw } from "lucide-react";
import { ActionButton } from "@/components/wp/action-button";
import { TempTag } from "@/components/wp/chips";
import { Panel, PanelHeader } from "@/components/wp/panel";
import { colombo, dayLabel, hhmm, kg } from "@/lib/format";
import { cn } from "@/lib/utils";
import { storeAnswerAction } from "../../actions";
import { PageTour } from "@/components/wp/tour";
import { ASK_TOUR } from "@/lib/tours/store";

export interface OrderMessage {
  id: string;
  type: string;
  title: string;
  body: string;
  at: Date;
}

/**
 * DG-03: after a dead zone the dispatcher can offer a moved order back for today. The window has closed,
 * so accepting a late delivery is the store's decision; accepting cancels the next-run slot.
 */
export function StoreAsk({
  order,
  ask,
  messages,
}: {
  order: { id: string; temp: "chilled" | "ambient"; units: number; kg: number };
  ask: { conflictId: string; ask: { askedMin: number; eta: number }; close: number; vehicleId: string; next: string };
  messages: OrderMessage[];
}) {
  return (
    <main className="mx-auto grid max-w-4xl gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <PageTour id="dg03" steps={ASK_TOUR} />
      <Panel className="space-y-4 border-conflict-border p-6" data-tour="ask">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-conflict-border bg-conflict-bg px-2.5 text-[13px] font-semibold text-conflict">
            <RotateCcw className="size-3.5" /> En route again
          </span>
          <TempTag temp={order.temp} />
          <span className="num text-[13px] text-muted-foreground">Update · {hhmm(ask.ask.askedMin)}</span>
        </div>
        <h1 className="text-2xl font-semibold">Your {order.temp === "chilled" ? "chilled" : "dry"} order can come today after all</h1>
        <p className="text-sm">
          We told you it would move to {dayLabel(ask.next)} because we had lost contact with the truck. {ask.vehicleId} still has your order
          {order.temp === "chilled" ? ", kept cold," : ""} and is about 5 minutes away.
        </p>
        <dl className="grid gap-3 sm:grid-cols-3" data-tour="ask-facts">
          <div className="rounded-lg border p-3">
            <dt className="text-[13px] text-muted-foreground">Arrives about</dt>
            <dd className="num text-3xl font-semibold">{hhmm(ask.ask.eta)}</dd>
            <dd className={cn("text-[13px]", ask.ask.eta > ask.close ? "text-late-risk" : "text-muted-foreground")}>
              {ask.ask.eta > ask.close ? `After your ${hhmm(ask.close)} window` : `Inside your window (closes ${hhmm(ask.close)})`}
            </dd>
          </div>
          <div className="rounded-lg border p-3">
            <dt className="text-[13px] text-muted-foreground">Order</dt>
            <dd className="num font-semibold">{order.id}</dd>
            <dd className="num text-[13px] text-muted-foreground">
              {order.units} units · {kg(order.kg)}
            </dd>
          </div>
          <div className="rounded-lg border p-3">
            <dt className="text-[13px] text-muted-foreground">If you accept</dt>
            <dd className="font-semibold">{dayLabel(ask.next).split(" ")[0]} cancelled</dd>
            <dd className="text-[13px] text-muted-foreground">No double delivery</dd>
          </div>
        </dl>
        <p className="text-[13px] text-muted-foreground">The driver is parked and waiting for your answer.</p>
        <div className="flex flex-wrap gap-2" data-tour="ask-buttons">
          <ActionButton action={storeAnswerAction} fields={{ conflictId: ask.conflictId, accept: "0" }} size="desk" variant="outline">
            Keep it for {dayLabel(ask.next).split(" ")[0]}
          </ActionButton>
          <ActionButton action={storeAnswerAction} fields={{ conflictId: ask.conflictId, accept: "1" }} size="desk">
            Accept today
          </ActionButton>
        </div>
      </Panel>
      <div className="min-w-0" data-tour="messages">
        <OrderMessages messages={messages} />
      </div>
    </main>
  );
}

/** Every message about one order. A deferral notice that a later update replaced stays visible, struck through. */
export function OrderMessages({ messages }: { messages: OrderMessage[] }) {
  if (!messages.length) return null;
  const replacedAfter = (i: number) => messages.slice(i + 1).find((m) => m.type === "order.ask" || m.type === "order.restored");
  return (
    <Panel className="h-fit">
      <PanelHeader title="Every message about this order" />
      <ol className="divide-y">
        {messages.map((m, i) => {
          const by = m.type === "order.deferred" ? replacedAfter(i) : undefined;
          return (
            <li key={m.id} className="space-y-0.5 px-4 py-3 text-sm">
              <p className="num text-[12px] text-muted-foreground">{colombo(m.at)}</p>
              <p className={cn("font-medium", by && "text-muted-foreground line-through")}>{m.title}</p>
              <p className={cn("text-[13px] text-muted-foreground", by && "line-through")}>{m.body}</p>
              {by && <p className="text-[12px] font-medium text-conflict">Replaced by the {colombo(by.at)} update</p>}
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
