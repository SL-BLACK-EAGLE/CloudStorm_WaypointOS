"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { SignalListener } from "./realtime";

interface Item {
  id: string;
  title: string;
  body: string;
  link: string | null;
  severity: string;
  at: string;
  read: boolean;
}

const DOT: Record<string, string> = {
  info: "bg-planned",
  "late-risk": "bg-late-risk",
  conflict: "bg-conflict",
  exception: "bg-exception",
};

/** Notification centre: unread count, the latest 30, click-through, mark all read. Polls every 30 s. */
export function NotificationBell({ side = "bottom", channels = [], className }: { side?: "bottom" | "right"; channels?: string[]; className?: string }) {
  const [data, setData] = useState<{ unread: number; items: Item[] } | null>(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => {
    fetch("/api/notifications", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setData(d))
      .catch(() => undefined); // offline - keep what we have
  }, []);
  const mark = async (ids?: string[]) => {
    const r = await fetch("/api/notifications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }) }).catch(() => null);
    if (r?.ok) setData(await r.json());
  };
  useEffect(() => {
    const first = window.setTimeout(load, 0);
    const id = window.setInterval(() => document.visibilityState === "visible" && load(), 30_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [load]);

  const unread = data?.unread ?? 0;
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) load();
      }}
    >
      <SignalListener channels={channels} onChange={load} />
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className={cn("relative", className)} aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}>
          <Bell />
          {unread > 0 && (
            <span className="num absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-exception px-1 text-[10px] font-semibold text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent side={side} align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-semibold">Notifications</p>
          {unread > 0 && (
            <button className="text-[13px] text-muted-foreground underline-offset-4 hover:underline" onClick={() => void mark()}>
              Mark all read
            </button>
          )}
        </div>
        <ul className="max-h-[60vh] divide-y overflow-y-auto">
          {data?.items.map((n) => {
            const body = (
              <>
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read ? "bg-transparent" : (DOT[n.severity] ?? "bg-planned"))} />
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-sm", !n.read && "font-medium")}>{n.title}</span>
                  <span className="line-clamp-2 block text-[13px] text-muted-foreground">{n.body}</span>
                </span>
              </>
            );
            return (
              <li key={n.id}>
                {n.link ? (
                  <Link
                    href={n.link}
                    className="flex gap-2 px-3 py-2.5 hover:bg-muted/50"
                    onClick={() => {
                      setOpen(false);
                      if (!n.read) void mark([n.id]);
                    }}
                  >
                    {body}
                  </Link>
                ) : (
                  <button className="flex w-full gap-2 px-3 py-2.5 text-left hover:bg-muted/50" onClick={() => !n.read && void mark([n.id])}>
                    {body}
                  </button>
                )}
              </li>
            );
          })}
          {data && data.items.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing yet.</li>}
          {!data && <li className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</li>}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
