import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Noto_Sans_Sinhala, Noto_Sans_Tamil } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { shadcn } from "@clerk/ui/themes";
import { SerwistProvider } from "@serwist/turbopack/react";
import { Toaster } from "@/components/ui/sonner";
import { RealtimeProvider } from "@/components/wp/realtime";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ROLE_THEME, type ThemeName } from "@/lib/roles";
import { getAppUser } from "@/lib/server/session";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const notoSinhala = Noto_Sans_Sinhala({ variable: "--font-noto-sinhala", subsets: ["sinhala"], weight: ["400", "600"], preload: false });
const notoTamil = Noto_Sans_Tamil({ variable: "--font-noto-tamil", subsets: ["tamil"], weight: ["400", "600"], preload: false });

export const metadata: Metadata = {
  title: { default: "Waypoint Delivery OS", template: "%s · Waypoint Delivery OS" },
  description:
    "Delivery planning and execution for Waypoint Group: ordering, planning, loading, delivery and receipt across four roles. Team CloudStorm, Tech-Triathlon 2026.",
  applicationName: "Waypoint Delivery OS",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0e12" },
  ],
};

/** Mode follows the workplace (DS-00): the user's choice, else their role's default. */
async function resolveTheme(): Promise<ThemeName> {
  try {
    const user = await getAppUser();
    const chosen = user?.theme as ThemeName | null | undefined;
    if (chosen === "light" || chosen === "dark" || chosen === "sunlight") return chosen;
    return user?.role ? ROLE_THEME[user.role] : "light";
  } catch {
    return "light";
  }
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const theme = await resolveTheme();
  return (
    <html
      lang="en"
      data-theme={theme}
      className={`${theme} ${geistSans.variable} ${geistMono.variable} ${notoSinhala.variable} ${notoTamil.variable} h-full antialiased`}
      style={{ colorScheme: theme === "dark" ? "dark" : "light" }}
    >
      <body className="min-h-full">
        <ClerkProvider appearance={{ theme: shadcn }}>
          <SerwistProvider swUrl="/serwist/sw.js" disable={process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_SW_DEV !== "1"}>
            <RealtimeProvider>
              <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
            </RealtimeProvider>
          </SerwistProvider>
          <Toaster position="top-center" richColors closeButton theme={theme === "dark" ? "dark" : "light"} />
        </ClerkProvider>
      </body>
    </html>
  );
}
