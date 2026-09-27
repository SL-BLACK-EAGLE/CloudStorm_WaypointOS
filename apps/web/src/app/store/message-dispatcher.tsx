"use client";

import { MessageSquare } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { messageDispatcherAction } from "./actions";

export function MessageDispatcher({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="desk" variant="outline">
          <MessageSquare /> Message the dispatcher
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Message about {orderId}</DialogTitle>
        </DialogHeader>
        <Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="e.g. We close early on Wednesday - can it come before 07:00?" />
        <DialogFooter>
          <Button
            size="desk"
            disabled={pending || body.trim().length < 3}
            onClick={() =>
              start(async () => {
                const f = new FormData();
                f.set("orderId", orderId);
                f.set("body", body);
                const r = await messageDispatcherAction(f);
                if (r.ok) {
                  toast.success(r.message);
                  setBody("");
                  setOpen(false);
                } else toast.error(r.error);
              })
            }
          >
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
