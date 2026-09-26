import { clerkMiddleware } from "@clerk/nextjs/server";

/**
 * Clerk session handling only. Authorization is enforced at each resource
 * (pages, route handlers, server actions) through requireUser()/userForApi(),
 * following Clerk's resource-based protection model - never by URL pattern here.
 */
export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next.js internals, static files and the service worker, unless found in search params
    "/((?!_next|sw\\.js|swe-worker|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
