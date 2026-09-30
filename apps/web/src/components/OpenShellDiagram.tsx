"use client";

import { useCallback, useRef, useState, type ComponentType, type ReactNode } from "react";
import {
  Button,
  Card,
  CardBody,
  CardTitle,
  Content,
  ContentVariants,
  ExpandableSection,
  Flex,
  FlexItem,
} from "@patternfly/react-core";
import {
  ArrowDownIcon,
  ArrowsAltHIcon,
  CloudIcon,
  CogsIcon,
  CubesIcon,
  DownloadIcon,
  ServerIcon,
  TerminalIcon,
  UsersIcon,
} from "@patternfly/react-icons";

/**
 * High-level architecture diagram for the OpenShell page, showing how a
 * user's "Open terminal" click flows through the system: Admin Console
 * configures the listing, the Agent Sandbox Service creates a sandbox via
 * the OpenShell Gateway, which provisions a real pod through the Agent
 * Sandbox Controller, and the user connects via a live WebSocket terminal.
 *
 * Same DiagramBox/Connector pattern as ArchitectureDiagram.tsx — built
 * entirely from PatternFly components so dark mode is automatic.
 *
 * Wrapped in an ExpandableSection so the admin can collapse it once
 * they're familiar with the architecture; a "Download as PNG" button
 * captures the diagram content via html-to-image.
 */

const TINT = {
  admin: "#6753ac",
  service: "#c9190b",
  gateway: "#b58100",
  controller: "#4f5b66",
  sandbox: "#009596",
  user: "#0066cc",
} as const;

function DiagramBox({
  icon: Icon,
  title,
  description,
  items,
  tint,
  wide,
}: {
  icon: ComponentType;
  title: string;
  description?: string;
  items?: string[];
  tint: string;
  wide?: boolean;
}) {
  return (
    <Card isCompact style={{ width: wide ? "20rem" : "15rem", height: "100%", borderTop: `3px solid ${tint}` }}>
      <CardTitle>
        <Flex spaceItems={{ default: "spaceItemsSm" }} alignItems={{ default: "alignItemsFlexStart" }}>
          <FlexItem style={{ color: tint, display: "flex", paddingTop: "0.125rem" }}>
            <Icon />
          </FlexItem>
          <FlexItem>{title}</FlexItem>
        </Flex>
      </CardTitle>
      <CardBody>
        {description ? <Content component={ContentVariants.small}>{description}</Content> : null}
        {items ? (
          <Content component={ContentVariants.small}>
            <ul style={{ margin: description ? "0.35rem 0 0" : 0, paddingLeft: "1.1rem" }}>
              {items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Content>
        ) : null}
      </CardBody>
    </Card>
  );
}

function Connector({ label, tint }: { label?: string; tint?: string }) {
  return (
    <Flex direction={{ default: "column" }} alignItems={{ default: "alignItemsCenter" }} spaceItems={{ default: "spaceItemsNone" }}>
      <FlexItem>
        <ArrowDownIcon />
      </FlexItem>
      {label && (
        <FlexItem>
          <Content
            component={ContentVariants.small}
            style={{ fontSize: "0.7rem", color: tint ?? "inherit", lineHeight: 1.2, textAlign: "center" }}
          >
            {label}
          </Content>
        </FlexItem>
      )}
    </Flex>
  );
}

function HorizontalConnector({ label }: { label?: string }) {
  return (
    <Flex
      direction={{ default: "column" }}
      alignItems={{ default: "alignItemsCenter" }}
      alignSelf={{ default: "alignSelfCenter" }}
      spaceItems={{ default: "spaceItemsNone" }}
    >
      <FlexItem>
        <ArrowsAltHIcon />
      </FlexItem>
      {label && (
        <FlexItem>
          <Content component={ContentVariants.small} style={{ fontSize: "0.7rem", lineHeight: 1.2, textAlign: "center" }}>
            {label}
          </Content>
        </FlexItem>
      )}
    </Flex>
  );
}

function DiagramContent({ captureRef }: { captureRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div ref={captureRef} style={{ padding: "1rem", background: "var(--pf-t--global--background--color--primary--default)" }}>
      <Flex
        direction={{ default: "column" }}
        alignItems={{ default: "alignItemsCenter" }}
        spaceItems={{ default: "spaceItemsSm" }}
      >
        <DiagramBox
          icon={CogsIcon}
          title="Admin Console (AgentStore)"
          description="Configure an agent listing with a model provider, MCP tools, and skills. Click Deploy to create a sandbox session."
          tint={TINT.admin}
          wide
        />
        <Connector label="POST /sessions (REST)" tint={TINT.service} />

        <DiagramBox
          icon={ServerIcon}
          title="Agent Sandbox Service"
          description="A microservice built from AgentStore and deployed on OpenShift. Bridges AgentStore's REST/WebSocket API to the OpenShell gateway's gRPC interface."
          items={[
            "Creates sandboxes via SDK",
            "Uploads agent config (opencode.json)",
            "Mints short-lived terminal tokens",
            "Relays WebSocket \u2194 execInteractive",
          ]}
          tint={TINT.service}
          wide
        />
        <Connector label="gRPC (OpenShell SDK)" tint={TINT.gateway} />

        <Flex
          justifyContent={{ default: "justifyContentCenter" }}
          alignItems={{ default: "alignItemsStretch" }}
          spaceItems={{ default: "spaceItemsSm" }}
        >
          <FlexItem>
            <DiagramBox
              icon={CubesIcon}
              title="OpenShell Gateway"
              description="NVIDIA's sandbox orchestrator. Receives gRPC requests, creates Sandbox CRs in the openshell namespace."
              tint={TINT.gateway}
            />
          </FlexItem>
          <HorizontalConnector label="Sandbox CR" />
          <FlexItem>
            <DiagramBox
              icon={CloudIcon}
              title="Agent Sandbox Controller"
              description="Watches Sandbox CRs, provisions real pods with OPA network isolation and a sidecar runtime."
              tint={TINT.controller}
            />
          </FlexItem>
        </Flex>
        <Connector label="Pod created" tint={TINT.sandbox} />

        <DiagramBox
          icon={TerminalIcon}
          title="Sandbox Pod"
          description="An isolated container running the agent (e.g. opencode). The canonical process runs the agent command; terminal access spawns a separate /bin/sh via execInteractive."
          items={[
            "Non-root (UID 1000790000)",
            "OPA network boundary",
            "2 Gi persistent workspace volume",
          ]}
          tint={TINT.sandbox}
          wide
        />
        <Connector label="WebSocket (wss://)" tint={TINT.user} />

        <DiagramBox
          icon={UsersIcon}
          title="User's Browser"
          description="Opens the terminal modal, connects via WebSocket to the Agent Sandbox Service, which relays I/O to the sandbox's interactive shell."
          tint={TINT.user}
          wide
        />

        <Content component={ContentVariants.small} style={{ marginTop: "0.75rem", textAlign: "center", maxWidth: "36rem" }}>
          The OpenShell Gateway and Agent Sandbox Controller run in the <code>openshell</code> and{" "}
          <code>agent-sandbox-system</code> namespaces respectively. Sandbox pods are created in{" "}
          <code>openshell</code>. The Agent Sandbox Service runs in <code>agent-workloads</code>{" "}
          alongside other agent deployments.
        </Content>
      </Flex>
    </div>
  );
}

export function OpenShellDiagram() {
  const [expanded, setExpanded] = useState(true);
  const captureRef = useRef<HTMLDivElement>(null);

  const downloadPng = useCallback(async () => {
    if (!captureRef.current) return;
    const { toPng } = await import("html-to-image");
    const dataUrl = await toPng(captureRef.current, { pixelRatio: 2 });
    const link = document.createElement("a");
    link.download = "openshell-architecture.png";
    link.href = dataUrl;
    link.click();
  }, []);

  return (
    <Card>
      <CardBody>
        <ExpandableSection
          toggleText={expanded ? "How OpenShell Works" : "How OpenShell Works (click to expand)"}
          onToggle={(_e, isExpanded) => setExpanded(isExpanded)}
          isExpanded={expanded}
        >
          <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsSm" }}>
            <FlexItem>
              <DiagramContent captureRef={captureRef} />
            </FlexItem>
            <FlexItem>
              <Button variant="link" icon={<DownloadIcon />} onClick={() => void downloadPng()}>
                Download as PNG
              </Button>
            </FlexItem>
          </Flex>
        </ExpandableSection>
      </CardBody>
    </Card>
  );
}
