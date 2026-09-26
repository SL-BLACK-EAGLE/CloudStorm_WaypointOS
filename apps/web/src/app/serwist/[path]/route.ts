import { createSerwistRoute } from "@serwist/turbopack";

// the build id changes on every deploy, so the offline page and shell are re-precached
const revision = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.BUILD_ID ?? "dev";

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  additionalPrecacheEntries: [{ url: "/~offline", revision }],
  swSrc: "src/app/sw.ts",
  useNativeEsbuild: true,
});
