import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  devIndicators: false,
  transpilePackages: [
    "@agentstore/shared",
    "@agentstore/agent-core",
    "@agentstore/engine-ansible",
    "@agentstore/engine-openshell",
    "@patternfly/react-core",
    "@patternfly/react-icons",
    "@patternfly/react-styles",
    "@patternfly/react-table",
  ],
  async redirects() {
    // "/" now serves the real Landing Page (see app/page.tsx) instead of
    // redirecting. Catalog is a top-level section at /catalog; "/admin"
    // bare now falls through to the first remaining Settings sub-page.
    return [
      { source: "/admin", destination: "/admin/platform", permanent: false },
      { source: "/admin/catalog", destination: "/catalog", permanent: false },
      // Skills moved from its own Settings page into an LLMs sub-tab when
      // OpenShell was promoted to take its top-level slot instead.
      { source: "/admin/skills", destination: "/admin/llms", permanent: false },
    ];
  },
};

export default nextConfig;
