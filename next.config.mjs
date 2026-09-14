/** @type {import('next').NextConfig} */
const nextConfig = {
  // Hides the floating dev-tools badge in the corner. Dev-only either way —
  // the indicator never renders in a production build.
  devIndicators: false,
  // Emits .next/standalone with a minimal server.js + the node_modules it
  // actually needs, so the Docker image can ship the app without dev deps.
  // Only affects `next build`; `next dev` is unchanged.
  output: "standalone",
};

export default nextConfig;
