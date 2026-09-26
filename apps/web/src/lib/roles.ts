/** Roles, their home routes and default display modes (DS-00: "mode follows the workplace"). */
export const ROLES = ["dispatcher", "loader", "driver", "store_manager"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_HOME = {
  dispatcher: "/dispatch",
  loader: "/dock",
  driver: "/drive",
  store_manager: "/store",
} as const satisfies Record<Role, string>;

export const ROLE_LABEL: Record<Role, string> = {
  dispatcher: "Dispatcher",
  loader: "Loader",
  driver: "Driver",
  store_manager: "Store manager",
};

export const ROLE_BLURB: Record<Role, string> = {
  dispatcher: "Plan the day, allocate the fleet, explain deferrals and watch every trip.",
  loader: "Load each vehicle in stop order and flag shortfalls before it leaves the dock.",
  driver: "Follow the run, record arrival and proof of delivery - with or without signal.",
  store_manager: "Order before the 16:00 cutoff, see your arrival time and confirm what arrived.",
};

export type ThemeName = "light" | "dark" | "sunlight";
export const THEMES: ThemeName[] = ["light", "dark", "sunlight"];

export const ROLE_THEME: Record<Role, ThemeName> = {
  dispatcher: "dark",
  loader: "sunlight",
  driver: "sunlight",
  store_manager: "light",
};
