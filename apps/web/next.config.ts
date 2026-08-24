import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  devIndicators: false,
  transpilePackages: [
    "@agentstore/shared",
    "@agentstore/engine-fake",
    "@agentstore/engine-ansible",
    "@patternfly/react-core",
    "@patternfly/react-icons",
    "@patternfly/react-styles",
    "@patternfly/react-table",
  ],
};

export default nextConfig;
