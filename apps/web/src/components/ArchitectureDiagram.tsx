"use client";

import type { ComponentType, ReactNode } from "react";
import { Card, CardBody, CardTitle, Content, ContentVariants, Flex, FlexItem } from "@patternfly/react-core";
import {
  ArrowDownIcon,
  ArrowsAltHIcon,
  BookIcon,
  BrainIcon,
  CatalogIcon,
  CloudIcon,
  CogsIcon,
  CubesIcon,
  PlugIcon,
  PuzzlePieceIcon,
  ServerIcon,
  TerminalIcon,
  UsersIcon,
} from "@patternfly/react-icons";

/**
 * Hand-built PatternFly diagram (Card/Flex primitives, no external diagram
 * library) illustrating AgentStore's real shape: one admin-configured
 * inputs layer, OpenShift as the direct provisioning + hosting platform
 * for both agent types, which then forks into the two end-user
 * experiences. Built entirely from PatternFly components so dark mode is
 * automatic (see lib/theme.tsx).
 */

function DiagramBox({
  icon: Icon,
  title,
  description,
  items,
  tint,
}: {
  icon: ComponentType;
  title: string;
  description?: string;
  items?: string[];
  tint: string;
}) {
  return (
    <Card isCompact style={{ width: "15rem", height: "100%", borderTop: `3px solid ${tint}` }}>
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

function Connector() {
  return (
    <Flex justifyContent={{ default: "justifyContentCenter" }}>
      <FlexItem>
        <ArrowDownIcon />
      </FlexItem>
    </Flex>
  );
}

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

const TINT = {
  console: "#6753ac",
  providers: "#0066cc",
  mcp: "#009596",
  skills: "#3e8635",
  openshift: "#4f5b66",
  containerImages: "#8f4700",
  autonomous: "#ec7a08",
  collaborative: "#c9190b",
  rhdh: "#0066cc",
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

      <Flex
        justifyContent={{ default: "justifyContentCenter" }}
        alignItems={{ default: "alignItemsStretch" }}
        spaceItems={{ default: "spaceItemsSm" }}
        flexWrap={{ default: "wrap" }}
      >
        <FlexItem>
          <DiagramBox
            icon={CubesIcon}
            title="Container Images"
            items={["Agent Runtime Image"]}
            tint={TINT.containerImages}
          />
        </FlexItem>
        <HorizontalConnector />
        <FlexItem>
          <DiagramBox
            icon={CloudIcon}
            title="OpenShift API"
            description="Direct provisioning — persistent Deployment + Route for both agent types"
            tint={TINT.openshift}
          />
        </FlexItem>
      </Flex>
      <Content component={ContentVariants.small} style={{ textAlign: "center" }}>
        Builds via OpenShift BuildConfig, deploys via OpenShift API — no intermediate orchestrator
      </Content>
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

      <Connector />
      <DiagramBox
        icon={CatalogIcon}
        title="Red Hat Developer Hub"
        description="Self-service portal — end users discover agents, request new ones, and trigger deploys via Software Templates"
        tint={TINT.rhdh}
      />
      <Content component={ContentVariants.small} style={{ textAlign: "center", fontStyle: "italic" }}>
        Optional overlay — AgentStore works without it
      </Content>
    </Flex>
  );
}
