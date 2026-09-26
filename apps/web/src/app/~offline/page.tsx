import { WifiOff } from "lucide-react";

export const metadata = { title: "No signal" };

/** Served by the service worker for pages that were never opened while online. */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <WifiOff className="size-10" aria-hidden />
      <h1 className="text-2xl font-bold">No signal</h1>
      <p className="text-lg">
        This page was not saved on the phone. Your run is: open <a href="/drive" className="font-semibold underline">Today&apos;s run</a> - everything
        you record there is kept and sent when the signal returns.
      </p>
    </main>
  );
}
