"use client";

import { Loader2 } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Result = { ok: true; message: string } | { ok: false; error: string } | void;

/**
 * A button bound to a server action. Shows progress, then the action's own outcome
 * as a toast - never a silent click.
 */
export function ActionButton({
  action,
  fields = {},
  children,
  confirm,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "onClick" | "action"> & {
  action: (form: FormData) => Promise<Result>;
  fields?: Record<string, string | number | undefined | null>;
  confirm?: string;
}) {
  const [pending, start] = useTransition();
  return (
    <Button
      {...props}
      disabled={props.disabled || pending}
      aria-busy={pending}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(async () => {
          const f = new FormData();
          for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) f.set(k, String(v));
          try {
            const r = await action(f);
            if (r && r.ok) toast.success(r.message);
            else if (r && !r.ok) toast.error(r.error);
          } catch (e) {
            if (e && typeof e === "object" && "digest" in e && String((e as { digest?: string }).digest).startsWith("NEXT_REDIRECT")) throw e;
            toast.error("That did not go through. Check your connection and try again.");
          }
        });
      }}
    >
      {pending && <Loader2 className="animate-spin" />}
      {children}
    </Button>
  );
}
