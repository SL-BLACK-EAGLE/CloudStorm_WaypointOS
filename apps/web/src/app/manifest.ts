import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Waypoint Delivery OS",
    short_name: "Waypoint",
    description: "Delivery planning and execution for Waypoint Group",
    start_url: "/app",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0e1116",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
