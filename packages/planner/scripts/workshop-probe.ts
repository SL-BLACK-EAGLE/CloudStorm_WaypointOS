// Probe: which workshop outages on 23 Dec make demand exceed capacity? (dev-only script)
import { readFileSync } from "node:fs";
import { createReference, makeOrder, planDay, servedMap, type ReferenceInput } from "../src/index";
const G = "../../seed-data/golden/";
const R = createReference(JSON.parse(readFileSync(G + "reference.json", "utf8")) as ReferenceInput);
for (const depot of ["peliyagoda", "kandy"]) {
  const g = JSON.parse(readFileSync(G + `plan-2025-12-23-${depot}.json`, "utf8"));
  const orders = g.orders.map((o: any) => makeOrder(R, o));
  const vs = Object.keys(g.status);
  const describe = (ws: string[]) => {
    const st = { ...g.status }; ws.forEach((v) => (st[v] = "in_workshop"));
    const t = performance.now();
    const p = planDay(R, orders, st, g.ctx, "LIVE", g.fuelUsed);
    const ms = (performance.now() - t).toFixed(0);
    const kinds: Record<string, number> = {};
    for (const d of p.deferrals.values()) kinds[d.kind + ":" + d.reason] = (kinds[d.kind + ":" + d.reason] ?? 0) + 1;
    return `${depot} ws=[${ws.join(",")}] served ${servedMap(p).size}/${orders.length} ${ms}ms ${JSON.stringify(kinds)}`;
  };
  console.log(describe([]));
  const reefers = vs.filter((v) => R.vehicles.get(v)!.temp === "reefer");
  const vans = vs.filter((v) => R.vehicles.get(v)!.type === "van");
  console.log(depot, "reefers", reefers.join(","), "vans", vans.join(","));
  const ambientTrucks = vs.filter((v) => R.vehicles.get(v)!.temp === "ambient" && R.vehicles.get(v)!.type === "truck");
  for (const ws of [[reefers[0]], reefers.slice(0, 2), reefers.slice(0, 3), [...reefers.slice(0, 2), ...ambientTrucks.slice(0, 4)],
                    [...reefers.slice(0, 2), vans.find((v) => R.vehicles.get(v)!.temp === "reefer")!], [...reefers.slice(0,3), ...ambientTrucks.slice(0,6)]])
    console.log(describe(ws as string[]));
}
