import { Flex, FlexItem, Label } from "@patternfly/react-core";
import type { Skill } from "@agentstore/shared";

/**
 * Shared by CatalogManager's SkillPicker (binding skills to an agent) and
 * SkillsPanel (the skills library) — kept in its own module (not
 * co-located in either component file) so neither route needs to import
 * the other's file just to group skills by pack the same way.
 */

// Human-readable labels for the Red Hat Agentic Skill Pack ids imported by
// scripts/import-redhat-skills.ts — falls back to the raw pack id (or
// "Custom skills" for skills authored in this app) for anything unmapped.
const PACK_LABELS: Record<string, string> = {
  "rh-basic": "Red Hat Basics",
  "rh-sre": "Red Hat SRE",
  "rh-developer": "Red Hat Developer",
  "rh-virt": "Red Hat Virtualization",
  "ocp-admin": "OpenShift Admin",
  "rh-ai-engineer": "Red Hat AI Engineer",
  "rh-automation": "Red Hat Automation",
};

export function packLabel(pack: string): string {
  if (pack === "custom") return "Custom skills";
  return PACK_LABELS[pack] ?? pack;
}

export interface SkillGroup {
  key: string;
  label: string;
  skills: Skill[];
}

/** Groups skills by `pack` (skills with no pack, e.g. user-authored ones,
 * fall into a "custom" group), sorted alphabetically by label with
 * "custom" always last so home-grown skills don't get buried among the
 * Red Hat packs. */
export function groupSkillsByPack(skills: Skill[]): SkillGroup[] {
  const byKey = new Map<string, Skill[]>();
  for (const skill of skills) {
    const key = skill.pack ?? "custom";
    const bucket = byKey.get(key);
    if (bucket) bucket.push(skill);
    else byKey.set(key, [skill]);
  }
  return [...byKey.entries()]
    .map(([key, groupSkills]) => ({ key, label: packLabel(key), skills: groupSkills }))
    .sort((a, b) => {
      if (a.key === "custom") return 1;
      if (b.key === "custom") return -1;
      return a.label.localeCompare(b.label);
    });
}

/** Toggle content for the `ExpandableSection`s used to group skills by pack
 * in the skill picker and the skills library — a label plus a count/selection
 * badge. */
export function skillGroupToggle(label: string, badge?: string) {
  return (
    <Flex spaceItems={{ default: "spaceItemsSm" }} alignItems={{ default: "alignItemsCenter" }} display={{ default: "inlineFlex" }}>
      <FlexItem>{label}</FlexItem>
      {badge && (
        <FlexItem>
          <Label isCompact>{badge}</Label>
        </FlexItem>
      )}
    </Flex>
  );
}
