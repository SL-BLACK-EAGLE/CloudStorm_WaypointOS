/**
 * Illustrative product catalogue. The dataset records order totals (units, kg, m3) but no
 * product lines, so item names are scenario - labelled as such in the UI. Unit weight and
 * volume are calibrated so the catalogue's average matches the dataset's average per
 * brand and temperature, which keeps app-placed orders realistic for the planner.
 */
type Temp = "chilled" | "ambient";
type Brand = "Fresh" | "Style" | "Tech";

/** name, category, relative size (1.0 = the dataset's average unit) */
const ITEMS: Record<`${Brand}|${Temp}`, Array<[string, string, number]>> = {
  "Fresh|ambient": [
    ["Samba rice, 5 kg", "Rice & grains", 1.45],
    ["Nadu rice, 5 kg", "Rice & grains", 1.45],
    ["Red lentils (dhal), 1 kg", "Pulses", 0.45],
    ["White sugar, 1 kg", "Baking & sugar", 0.45],
    ["Wheat flour, 1 kg", "Baking & sugar", 0.45],
    ["Rice flour, 1 kg", "Baking & sugar", 0.45],
    ["Coconut oil, 1 L", "Oils", 0.6],
    ["Tea leaves, 400 g", "Beverages", 0.35],
    ["Cream crackers, 500 g", "Biscuits", 0.5],
    ["Tinned fish, 425 g (case of 12)", "Canned", 1.9],
    ["Bottled water, 1.5 L (pack of 6)", "Beverages", 2.1],
    ["Detergent powder, 1 kg", "Household", 0.55],
  ],
  "Fresh|chilled": [
    ["Fresh milk, 1 L (crate of 12)", "Dairy", 1.6],
    ["Curd, 900 ml clay pot", "Dairy", 0.75],
    ["Yoghurt, 80 g (tray of 24)", "Dairy", 0.8],
    ["Butter, 200 g", "Dairy", 0.3],
    ["Chicken, whole, frozen", "Meat & fish", 1.3],
    ["Fish, seer fillets, 1 kg", "Meat & fish", 0.9],
    ["Leafy greens (gotukola, mukunuwenna)", "Produce", 0.5],
    ["Carrots and leeks, 5 kg crate", "Produce", 1.8],
    ["Ice cream, 1 L (case of 6)", "Frozen", 1.1],
  ],
  "Style|ambient": [
    ["Men's shirts (hanging rail of 20)", "Hanging garments", 1.5],
    ["Sarees (boxed, 10)", "Boxed garments", 0.9],
    ["Kids' wear carton", "Cartons", 0.8],
    ["Denim carton (24)", "Cartons", 1.1],
    ["Festival dresses (hanging rail of 15)", "Hanging garments", 1.4],
    ["Footwear carton (12 pairs)", "Cartons", 0.7],
    ["Accessories tote", "Accessories", 0.35],
  ],
  "Tech|ambient": [
    ["Refrigerator, 250 L", "Large appliances", 2.2],
    ["Washing machine, 7 kg", "Large appliances", 1.8],
    ["LED TV, 55\"", "TV & audio", 0.9],
    ["LED TV, 43\"", "TV & audio", 0.6],
    ["Air conditioner, 12,000 BTU", "Large appliances", 1.4],
    ["Microwave oven", "Small appliances", 0.4],
    ["Rice cooker", "Small appliances", 0.2],
    ["Laptop (carton of 5)", "Computing", 0.25],
  ],
  "Tech|chilled": [],
  "Style|chilled": [],
};

export interface CatalogItem {
  sku: string;
  brand: Brand;
  name: string;
  category: string;
  temp: Temp;
  unitKg: number;
  unitM3: number;
}

/** meanKg / meanM3 per unit, per brand|temp, measured from deliveries_train.csv. */
export function buildCatalog(means: Map<string, { kg: number; m3: number }>): CatalogItem[] {
  const out: CatalogItem[] = [];
  for (const [key, items] of Object.entries(ITEMS)) {
    if (items.length === 0) continue;
    const [brand, temp] = key.split("|") as [Brand, Temp];
    const mean = means.get(key);
    if (!mean) continue;
    const avg = items.reduce((s, [, , f]) => s + f, 0) / items.length;
    items.forEach(([name, category, f], i) => {
      const k = f / avg; // normalise so the catalogue mean equals the dataset mean
      out.push({
        sku: `${brand.slice(0, 2).toUpperCase()}-${temp === "chilled" ? "C" : "A"}-${String(i + 1).padStart(3, "0")}`,
        brand,
        name,
        category,
        temp,
        unitKg: round(mean.kg * k, 3),
        unitM3: round(mean.m3 * k, 5),
      });
    });
  }
  return out;
}

function round(x: number, n: number): number {
  const p = 10 ** n;
  return Math.round(x * p) / p;
}
