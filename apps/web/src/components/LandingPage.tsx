"use client";

import Link from "next/link";
import type { ComponentType } from "react";
import {
  Button,
  Card,
  CardBody,
  CardTitle,
  Content,
  ContentVariants,
  Flex,
  FlexItem,
  Gallery,
  Label,
  PageSection,
  Title,
} from "@patternfly/react-core";
import {
  BoltIcon,
  BookIcon,
  CoinsIcon,
  LayerGroupIcon,
  PlugIcon,
  PuzzlePieceIcon,
  RocketIcon,
  ShareAltIcon,
  ShieldAltIcon,
} from "@patternfly/react-icons";
import { ArchitectureDiagram } from "@/components/ArchitectureDiagram";

/** Subset of PatternFly's Label `color` palette used on this page, kept to
 * a handful of hues so the page reads as "colorful accents", not a rainbow. */
type AccentColor = "blue" | "teal" | "green" | "orange" | "purple" | "yellow";

const IMPACT_STATS: {
  icon: ComponentType;
  color: AccentColor;
  tag: string;
  headline: string;
  caption: string;
}[] = [
  {
    icon: RocketIcon,
    color: "blue",
    tag: "Speed",
    headline: "Minutes, not weeks",
    caption: "Go from an approved catalog listing to a live, shareable agent — no new infrastructure project required.",
  },
  {
    icon: ShieldAltIcon,
    color: "green",
    tag: "Governance",
    headline: "Fully governed",
    caption: "Every model, tool, and skill binding is centrally reviewed and auditable — no unmanaged shadow-AI sprawl.",
  },
  {
    icon: CoinsIcon,
    color: "yellow",
    tag: "Cost control",
    headline: "Pay for infrastructure once",
    caption: "One persistent Deployment or sandbox service serves the whole team — not one per user, not one per launch.",
  },
  {
    icon: PuzzlePieceIcon,
    color: "purple",
    tag: "Composability",
    headline: "Assembled for the business case",
    caption: "Mix and match a model, tool servers, and skills per listing, so each agent is purpose-built for the job it does — not a generic one-size-fits-all bot.",
  },
];

const VALUE_PROPS: {
  icon: ComponentType;
  tint: string;
  color: AccentColor;
  tag: string;
  title: string;
  body: string;
}[] = [
  {
    icon: LayerGroupIcon,
    tint: "#6753ac",
    color: "purple",
    tag: "Runtimes",
    title: "Two governed runtimes, one console",
    body: "Ship always-on chat agents (persistent Deployment + Route via AAP/OpenShift) and interactive coding sandboxes (OpenShell) from the same admin experience.",
  },
  {
    icon: ShareAltIcon,
    tint: "#0066cc",
    color: "blue",
    tag: "Efficiency",
    title: "Deploy once, everyone benefits",
    body: "No per-launch provisioning. An admin deploys a listing a single time; every teammate opens the same persistent link or session.",
  },
  {
    icon: PlugIcon,
    tint: "#009596",
    color: "teal",
    tag: "Flexibility",
    title: "Bring your own models & tools",
    body: "Point agents at Anthropic, OpenAI, Gemini, or any OpenAI-compatible endpoint, and wire in MCP tool servers per agent.",
  },
  {
    icon: BookIcon,
    tint: "#3e8635",
    color: "green",
    tag: "Governance",
    title: "Reusable, governed skills",
    body: "Author instructions once as a Skill, attach it to any number of agents; risk tier and review status keep everything auditable.",
  },
  {
    icon: BoltIcon,
    tint: "#ec7a08",
    color: "orange",
    tag: "Speed",
    title: "Faster time-to-value",
    body: "Agents move from an approved catalog listing to a live, shareable link or session in minutes, not a new infrastructure project.",
  },
  {
    icon: CoinsIcon,
    tint: "#b58100",
    color: "yellow",
    tag: "Cost control",
    title: "Lower total cost of ownership",
    body: "One persistent Deployment or sandbox service serves the whole team, instead of paying for infrastructure per user or per launch.",
  },
];

export function LandingPage() {
  return (
    <>
      <PageSection variant="secondary">
        <Content>
          <Title headingLevel="h1" size="4xl" style={{ marginBottom: "0.25rem" }}>
            <span style={{ color: "#c9190b" }}>AgentStore</span> — your private agent store
          </Title>
          <Content component={ContentVariants.p} style={{ fontSize: "1.15rem", fontWeight: 600, marginTop: 0 }}>
            Governed AI agents, deployed once, used by everyone.
          </Content>
          <Content component={ContentVariants.p}>
            AgentStore is the admin console that turns approved AI agents into persistent, shareable
            tools — chat agents and interactive sandboxes alike — without asking every user to
            provision their own infrastructure.
          </Content>
        </Content>
        {/* Deliberately outside <Content>: Content's typography CSS restyles
         * descendant <a> tags with the link text color, which — since Button's
         * `component` override here renders as an <a> — clashed with the
         * primary button's own white-on-blue styling and made the label
         * unreadable (blue text on a blue background). */}
        <Button
          component={(props) => <Link {...props} href="/catalog" />}
          variant="primary"
          style={{ marginTop: "1rem" }}
        >
          Browse the Catalog
        </Button>
      </PageSection>

      <PageSection>
        <Title headingLevel="h2" size="xl" style={{ textAlign: "center", marginBottom: "1.5rem" }}>
          Why it matters
        </Title>
        <Gallery hasGutter minWidths={{ default: "16rem" }}>
          {IMPACT_STATS.map((stat) => {
            const Icon = stat.icon;
            return (
              <Card key={stat.headline} isFullHeight>
                <CardBody>
                  <Label icon={<Icon />} color={stat.color} isCompact style={{ marginBottom: "0.75rem" }}>
                    {stat.tag}
                  </Label>
                  <Title headingLevel="h3" size="lg" style={{ margin: "0 0 0.35rem" }}>
                    {stat.headline}
                  </Title>
                  <Content component={ContentVariants.small}>{stat.caption}</Content>
                </CardBody>
              </Card>
            );
          })}
        </Gallery>
      </PageSection>

      <PageSection>
        <Title headingLevel="h2" size="xl" style={{ textAlign: "center", marginBottom: "1.5rem" }}>
          Everything you need to run agents responsibly
        </Title>
        <Gallery hasGutter minWidths={{ default: "18rem" }}>
          {VALUE_PROPS.map((prop) => {
            const Icon = prop.icon;
            return (
              <Card key={prop.title} isFullHeight>
                <CardTitle>
                  <Flex spaceItems={{ default: "spaceItemsSm" }} alignItems={{ default: "alignItemsCenter" }}>
                    <FlexItem style={{ color: prop.tint, display: "flex" }}>
                      <Icon />
                    </FlexItem>
                    <FlexItem>{prop.title}</FlexItem>
                  </Flex>
                </CardTitle>
                <CardBody>
                  <Label isCompact color={prop.color} style={{ marginBottom: "0.5rem" }}>
                    {prop.tag}
                  </Label>
                  <Content component={ContentVariants.small}>{prop.body}</Content>
                </CardBody>
              </Card>
            );
          })}
        </Gallery>
      </PageSection>

      <PageSection>
        <Title headingLevel="h2" size="xl" style={{ textAlign: "center", marginBottom: "1.5rem" }}>
          How it works
        </Title>
        <ArchitectureDiagram />
      </PageSection>
    </>
  );
}
