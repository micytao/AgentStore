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
    // AgentStore is an admin-only console — every route collapses into the
    // Settings sub-pages under /admin/*.
    return [
      { source: "/", destination: "/admin/catalog", permanent: false },
      { source: "/admin", destination: "/admin/catalog", permanent: false },
    ];
  },
};

export default nextConfig;
