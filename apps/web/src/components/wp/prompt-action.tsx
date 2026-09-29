"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

type Result = { ok: true; message: string } | { ok: false; error: string };

/** A button that asks for a short text (message, reason) before calling a server action with it. */
export function PromptAction({
  action,
  fields,
  name = "body",
  title,
  description,
  placeholder,
  initial = "",
  submitLabel = "Send",
  required = true,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "onClick" | "action"> & {
  action: (form: FormData) => Promise<Result>;
  fields: Record<string, string>;
  name?: string;
  title: string;
  description?: string;
  placeholder?: string;
  initial?: string;
  submitLabel?: string;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(initial);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button {...props}>{children}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} autoFocus />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending || (required && text.trim().length < 2)}
            onClick={() =>
              start(async () => {
                const f = new FormData();
                for (const [k, v] of Object.entries(fields)) f.set(k, v);
                if (text.trim()) f.set(name, text.trim());
                const r = await action(f);
                if (r.ok) {
                  toast.success(r.message);
                  setOpen(false);
                  setText(initial);
                } else toast.error(r.error);
              })
            }
          >
            {pending && <Loader2 className="animate-spin" />}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
