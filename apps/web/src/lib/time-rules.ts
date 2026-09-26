/** Booklet timing rules shared by client and server code. */
export const CUTOFF_MIN = 16 * 60; // orders for the next run close at 16:00
export const FRESH_WINDOW = { open: 3 * 60 + 30, close: 8 * 60, budget: 270 } as const;
export const DAY_BUDGET = 480;
