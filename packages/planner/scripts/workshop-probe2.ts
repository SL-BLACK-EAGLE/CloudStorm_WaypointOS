import { readFileSync } from "node:fs";
import { createReference, makeOrder, planDay, servedMap, type ReferenceInput } from "../src/index";
const G = "../../seed-data/golden/";
const R = createReference(JSON.parse(readFileSync(G + "reference.json", "utf8")) as ReferenceInput);
const g = JSON.parse(readFileSync(G + "plan-2025-12-23-peliyagoda.json", "utf8"));
const orders = g.orders.map((o: any) => makeOrder(R, o));
for (const ws of [["VEH001","VEH002","VEH036"],["VEH001","VEH002","VEH035","VEH036"],["VEH001","VEH035","VEH036"],["VEH002","VEH035","VEH036","VEH012","VEH013"]]) {
  const st = { ...g.status }; ws.forEach((v) => (st[v] = "in_workshop"));
  const p = planDay(R, orders, st, g.ctx, "LIVE", g.fuelUsed);
  const k: Record<string, number> = {};
  for (const d of p.deferrals.values()) k[d.kind + ":" + d.reason] = (k[d.kind + ":" + d.reason] ?? 0) + 1;
  const chilled = orders.filter((o: any) => o.temp === "chilled"); const sm = servedMap(p);
  console.log(ws.join(","), "served", sm.size, "/", orders.length, "chilled", chilled.filter((o: any) => sm.has(o.ref)).length, "/", chilled.length, JSON.stringify(k));
}
