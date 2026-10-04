"use client";

import { ConvexProvider, ConvexReactClient, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";
import { api } from "../../../convex/_generated/api";
import { LiveRefresh } from "./live-refresh";

const URL = process.env.NEXT_PUBLIC_CONVEX_URL;
/** True when a Convex deployment is configured; otherwise screens fall back to polling. */
export const REALTIME = !!URL;

let client: ConvexReactClient | null = null;

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  if (!URL) return <>{children}</>;
  client ??= new ConvexReactClient(URL);
  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}

/** Calls onChange whenever any of the channels moves (never on the first load). Renders nothing. */
export function SignalListener({ channels, onChange }: { channels: string[]; onChange: () => void }) {
  if (!REALTIME) return null;
  return <Listener channels={channels} onChange={onChange} />;
}

function Listener({ channels, onChange }: { channels: string[]; onChange: () => void }) {
  const key = channels.join("|");
  const args = useMemo(() => ({ channels: key.split("|").filter(Boolean) }), [key]);
  const versions = useQuery(api.signals.versions, args);
  const seen = useRef<string | null>(null);
  const cb = useRef(onChange);
  useEffect(() => {
    cb.current = onChange;
  }, [onChange]);
  useEffect(() => {
    if (!versions) return;
    const sig = JSON.stringify(versions);
    if (seen.current !== null && seen.current !== sig) {
      const id = window.setTimeout(() => cb.current(), 250); // coalesce bursts (a publish emits many events)
      seen.current = sig;
      return () => window.clearTimeout(id);
    }
    seen.current = sig;
  }, [versions]);
  return null;
}

/** With Convex connected, a slow poll still runs behind the push, so a missed signal can never leave a screen stale. */
const SAFETY_POLL_SECONDS = 10;

/** Re-renders the page's server data when its channels change (Convex push), and polls as a safety net; polls only when Convex is not configured. */
export function RealtimeRefresh({ channels, fallbackSeconds = 15 }: { channels: string[]; fallbackSeconds?: number }) {
  const router = useRouter();
  if (!REALTIME) return <LiveRefresh seconds={fallbackSeconds} />;
  return (
    <>
      <SignalListener channels={channels} onChange={() => router.refresh()} />
      <LiveRefresh seconds={SAFETY_POLL_SECONDS} />
    </>
  );
}
