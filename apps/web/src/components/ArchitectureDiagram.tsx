"use client";

import type { ComponentType, ReactNode } from "react";
import { Card, CardBody, CardTitle, Content, ContentVariants, Flex, FlexItem } from "@patternfly/react-core";
import {
  ArrowDownIcon,
  ArrowsAltHIcon,
  AutomationIcon,
  BookIcon,
  BrainIcon,
  CloudIcon,
  CogsIcon,
  PlugIcon,
  PuzzlePieceIcon,
  ServerIcon,
  TerminalIcon,
  UsersIcon,
} from "@patternfly/react-icons";

/**
 * Hand-built PatternFly diagram (Card/Flex primitives, no external diagram
 * library) illustrating AgentStore's real shape: one admin-configured
 * inputs layer, one *shared* provisioning + hosting trunk (AAP guards every
 * deploy, OpenShift hosts every deploy — for both agent types, not one
 * each), which then forks into the two end-user experiences. Built
 * entirely from PatternFly components so dark mode is automatic (see
 * lib/theme.tsx) — only the icon accent color and top border per box are
 * tinted, everything else (card surface, text, borders) stays on
 * PatternFly's theme tokens.
 */

function DiagramBox({
  icon: Icon,
  title,
  description,
  tint,
}: {
  icon: ComponentType;
  title: string;
  description: string;
  /** Accent color for the icon + a thin top border, ties each box to its
   * tier in the flow (inputs / shared trunk / one of the two end-user
   * columns). */
  tint: string;
}) {
  return (
    <Card isCompact style={{ width: "15rem", height: "100%", borderTop: `3px solid ${tint}` }}>
      <CardTitle>
        {/* alignItems flex-start (not center): when a title is long enough
         * to wrap onto two lines, centering would vertically center the
         * icon against the whole wrapped block, making it look like it
         * floats apart from the text instead of sitting inline with it. */}
        <Flex spaceItems={{ default: "spaceItemsSm" }} alignItems={{ default: "alignItemsFlexStart" }}>
          <FlexItem style={{ color: tint, display: "flex", paddingTop: "0.125rem" }}>
            <Icon />
          </FlexItem>
          <FlexItem>{title}</FlexItem>
        </Flex>
      </CardTitle>
      <CardBody>
        <Content component={ContentVariants.small}>{description}</Content>
      </CardBody>
    </Card>
  );
}

function Connector() {
  return (
    <Flex justifyContent={{ default: "justifyContentCenter" }}>
      <FlexItem>
        <ArrowDownIcon />
      </FlexItem>
    </Flex>
  );
}

/** Horizontal connector between two boxes in the same row — used between
 * the shared-inputs boxes to show they're peers configured together
 * (double-headed, not a one-way flow like the vertical Connector). */
function HorizontalConnector() {
  return (
    <FlexItem alignSelf={{ default: "alignSelfCenter" }}>
      <ArrowsAltHIcon />
    </FlexItem>
  );
}

function ColumnHeading({ children, tint }: { children: ReactNode; tint: string }) {
  return (
    <Content component={ContentVariants.h4} style={{ textAlign: "center", margin: 0, color: tint }}>
      {children}
    </Content>
  );
}

/** Accent palette: purple for the orchestrating console, blue/teal/green
 * for the shared inputs layer, amber/slate for the shared provisioning +
 * hosting trunk (AAP, OpenShift — both serve every agent type), and one
 * color per end-user column (orange for Autonomous, brand red for
 * Collaborative) so the two experiences stay visually distinct at the
 * bottom of the diagram. */
const TINT = {
  console: "#6753ac",
  providers: "#0066cc",
  mcp: "#009596",
  skills: "#3e8635",
  aap: "#b58100",
  openshift: "#4f5b66",
  autonomous: "#ec7a08",
  collaborative: "#c9190b",
} as const;

export function ArchitectureDiagram() {
  return (
    <Flex
      direction={{ default: "column" }}
      alignItems={{ default: "alignItemsCenter" }}
      spaceItems={{ default: "spaceItemsSm" }}
    >
      <DiagramBox
        icon={CogsIcon}
        title="Admin Console"
        description="Onboard agents, bind providers/tools/skills, deploy once"
        tint={TINT.console}
      />
      <Connector />

      <Flex
        justifyContent={{ default: "justifyContentCenter" }}
        alignItems={{ default: "alignItemsStretch" }}
        spaceItems={{ default: "spaceItemsSm" }}
        flexWrap={{ default: "wrap" }}
      >
        <FlexItem>
          <DiagramBox
            icon={PlugIcon}
            title="MCP Tool Servers"
            description="Tools an agent is allowed to call"
            tint={TINT.mcp}
          />
        </FlexItem>
        <HorizontalConnector />
        <FlexItem>
          <DiagramBox
            icon={BrainIcon}
            title="Model Providers"
            description="Anthropic / OpenAI / Gemini / compatible"
            tint={TINT.providers}
          />
        </FlexItem>
        <HorizontalConnector />
        <FlexItem>
          <DiagramBox
            icon={BookIcon}
            title="Skills Library"
            description="Reusable instructions, attached per agent"
            tint={TINT.skills}
          />
        </FlexItem>
      </Flex>
      <Content component={ContentVariants.small} style={{ textAlign: "center" }}>
        Configured once, bound per agent — feeds the shared pipeline below
      </Content>
      <Connector />

      {/* Shared trunk: AAP and OpenShift each serve BOTH agent types below,
       * so they render once here instead of being duplicated per column. */}
      <DiagramBox
        icon={AutomationIcon}
        title="Ansible Automation Platform"
        description="Shared provisioning + guardrail pipeline for every agent type"
        tint={TINT.aap}
      />
      <Connector />
      <DiagramBox
        icon={CloudIcon}
        title="OpenShift"
        description="Persistent Deployment + Route — hosts both agent types"
        tint={TINT.openshift}
      />
      <Connector />

      <Flex
        justifyContent={{ default: "justifyContentCenter" }}
        alignItems={{ default: "alignItemsFlexStart" }}
        spaceItems={{ default: "spaceItemsXl" }}
        flexWrap={{ default: "wrap" }}
      >
        <FlexItem>
          <Flex
            direction={{ default: "column" }}
            alignItems={{ default: "alignItemsCenter" }}
            spaceItems={{ default: "spaceItemsSm" }}
          >
            <ColumnHeading tint={TINT.autonomous}>Autonomous Agents</ColumnHeading>
            <Connector />
            <DiagramBox
              icon={PuzzlePieceIcon}
              title="Assemble Agent"
              description="Bind minimalist harness with necessary tools and skills"
              tint={TINT.autonomous}
            />
            <Connector />
            <DiagramBox
              icon={UsersIcon}
              title="End users"
              description="Chat via a shared link, no login"
              tint={TINT.autonomous}
            />
          </Flex>
        </FlexItem>

        <FlexItem>
          <Flex
            direction={{ default: "column" }}
            alignItems={{ default: "alignItemsCenter" }}
            spaceItems={{ default: "spaceItemsSm" }}
          >
            <ColumnHeading tint={TINT.collaborative}>Collaborative Agents</ColumnHeading>
            <Connector />
            <DiagramBox
              icon={TerminalIcon}
              title="OpenShell Gateway"
              description="Persistent gateway hosting real coding-agent sandboxes (e.g. opencode)"
              tint={TINT.collaborative}
            />
            <Connector />
            <DiagramBox
              icon={ServerIcon}
              title="Agent Sandbox Service"
              description="Creates a live session against the gateway"
              tint={TINT.collaborative}
            />
            <Connector />
            <DiagramBox
              icon={UsersIcon}
              title="End users"
              description="Open a live terminal in that session"
              tint={TINT.collaborative}
            />
          </Flex>
        </FlexItem>
      </Flex>
    </Flex>
  );
}
