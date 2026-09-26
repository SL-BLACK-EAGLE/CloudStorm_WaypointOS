import "server-only";
import { after } from "next/server";

/**
 * Asks the outbox relay to deliver newly committed events to the realtime layer.
 * With QStash configured the relay runs as a signed, retried job; otherwise it runs
 * in-process right after the response is sent. Either way the outbox row is the source
 * of truth, and a periodic QStash schedule sweeps anything a kick missed.
 */
export function kickRelay() {
  after(async () => {
    try {
      const { triggerRelay } = await import("./relay-runner");
      await triggerRelay();
    } catch (e) {
      console.error("[relay] kick failed; the scheduled sweep will retry", e);
    }
  });
}
