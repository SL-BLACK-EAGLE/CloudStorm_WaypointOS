import { StatusPill } from "@/components/wp/chips";
import { stageOf, type StoreOrder } from "@/lib/server/store";

const MAP = {
  placed: ["planned", "Placed"],
  confirmed: ["planned", "Confirmed"],
  planned: ["planned", "Planned"],
  loaded: ["loading", "Loaded"],
  en_route: ["en-route", "En route"],
  delivered: ["delivered", "Delivered"],
  deferred: ["deferred", "Deferred"],
  exception: ["exception", "Exception"],
} as const;

export function StagePill({ order }: { order: StoreOrder }) {
  const [status, label] = MAP[stageOf(order)];
  return <StatusPill status={status}>{label}</StatusPill>;
}
