"use client";

import type { ReactNode } from "react";
import { Content, ContentVariants, PageSection, Title } from "@patternfly/react-core";

/**
 * Shared page shell for every Settings sub-page (Catalog/Platform/LLMs/
 * Skills) — the sub-navigation itself lives in the left sidebar (see
 * AppShell.tsx's "Settings" NavExpandable) instead of a horizontal
 * <Tabs> bar, so each Settings route renders its own header + panel.
 *
 * This is a client component so that `page.tsx` (a Server Component) never
 * imports from `@patternfly/react-core` directly — PatternFly ships no RSC
 * boundaries of its own, so any of its modules reachable from a Server
 * Component can non-deterministically get bundled into the RSC module
 * graph, where React's "react-server" condition export doesn't have
 * `Component`, breaking any class-based PatternFly internals (e.g.
 * `@patternfly/react-icons`'s `createIconBase`).
 */
export function AdminPageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <>
      <PageSection variant="secondary">
        <Content>
          <Content component={ContentVariants.small}>Settings</Content>
          <Title headingLevel="h1" size="2xl">
            {title}
          </Title>
          <Content component={ContentVariants.p}>{description}</Content>
        </Content>
      </PageSection>
      <PageSection>{children}</PageSection>
    </>
  );
}
