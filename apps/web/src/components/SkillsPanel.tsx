"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Bullseye,
  Button,
  Card,
  CardBody,
  CardTitle,
  Content,
  ContentVariants,
  ExpandableSection,
  Flex,
  FlexItem,
  Form,
  FormGroup,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  SearchInput,
  Spinner,
  TextArea,
  TextInput,
} from "@patternfly/react-core";
import type { Listing, Skill } from "@agentstore/shared";
import { Markdown } from "@/components/Markdown";
import {
  deleteSkillConfig,
  fetchListings,
  fetchSkills,
  importRedHatSkills,
  upsertSkillConfig,
} from "@/lib/api";
import { groupSkillsByPack, skillGroupToggle } from "@/lib/skillGrouping";

function slugify(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || `skill-${Date.now()}`
  );
}

// Display-only mirror of skillsImport.ts's RED_HAT_SKILL_PACKS — kept as a
// plain string list here (rather than importing the server module, which
// pulls in `fs`/`fetch`-to-GitHub code that has no place in a client
// bundle) so the panel can say which packs "Sync" will pull.
const RED_HAT_SKILL_PACK_LABELS = [
  "rh-basic",
  "rh-sre",
  "rh-developer",
  "rh-virt",
  "ocp-admin",
  "rh-ai-engineer",
  "rh-automation",
];

export function SkillsPanel() {
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [query, setQuery] = useState("");
  // Only the "custom" group (if any custom skills exist) starts open, every
  // Red Hat pack starts collapsed — seeded once skills first load.
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [seeded, setSeeded] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  function load() {
    fetchSkills()
      .then(setSkills)
      .catch((err: Error) => setError(err.message));
    fetchListings()
      .then(setListings)
      .catch(() => setListings([]));
  }

  useEffect(load, []);

  async function runImport() {
    setImporting(true);
    setImportMsg(null);
    try {
      const result = await importRedHatSkills();
      const failed = result.errors.length;
      const okPacks = result.packs.length - failed;
      setImportMsg(
        failed > 0
          ? `Imported ${result.written} skills from ${okPacks}/${result.packs.length} packs — ${failed} pack(s) failed (${result.errors.map((e) => e.pack).join(", ")}); check server logs.`
          : `Imported ${result.written} skills across ${result.packs.length} Red Hat packs.`
      );
      load();
    } catch (e) {
      setImportMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }

  // Which listings currently load each skill id, for the "used by" backlink
  // on each SkillRow — computed from the catalog, not stored on the skill.
  const usedByMap = useMemo(() => {
    const map = new Map<string, Listing[]>();
    for (const listing of listings) {
      for (const skillId of listing.agentConfig?.skillIds ?? []) {
        const list = map.get(skillId) ?? [];
        list.push(listing);
        map.set(skillId, list);
      }
    }
    return map;
  }, [listings]);

  useEffect(() => {
    if (seeded || !skills) return;
    setSeeded(true);
    if (skills.some((s) => s.source === "custom")) {
      setOpenGroups((prev) => new Set(prev).add("custom"));
    }
  }, [seeded, skills]);

  if (error) return <Alert variant="danger" isInline title={error} />;
  if (!skills) {
    return (
      <Bullseye>
        <Spinner aria-label="Loading skills" />
      </Bullseye>
    );
  }

  const groups = groupSkillsByPack(skills);

  function toggleGroup(key: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const trimmedQuery = query.trim().toLowerCase();
  const filteredGroups = groups
    .map((group) => ({
      ...group,
      skills: trimmedQuery
        ? group.skills.filter(
            (s) =>
              s.name.toLowerCase().includes(trimmedQuery) ||
              s.description.toLowerCase().includes(trimmedQuery)
          )
        : group.skills,
    }))
    .filter((group) => group.skills.length > 0);

  return (
    <Card>
      <CardTitle>Skills library</CardTitle>
      <CardBody>
        <Content component={ContentVariants.small}>
          Author reusable instruction bundles once, then attach one or more
          to any agent (from the Catalog tab or the onboarding wizard). A
          skill&apos;s instructions are merged into that agent&apos;s system
          prompt via progressive disclosure — the model sees a short menu and
          calls <code>load_skill</code> for the ones it needs. Red Hat pack
          skills below are imported and read-only; author your own with
          &quot;+ Add skill&quot;.
        </Content>

        <Card isCompact style={{ marginTop: "1rem" }}>
          <CardBody>
            <Flex justifyContent={{ default: "justifyContentSpaceBetween" }} alignItems={{ default: "alignItemsCenter" }}>
              <FlexItem>
                <strong>Sync Red Hat skill packs</strong>
                <Content component={ContentVariants.small}>
                  Pulls the latest {RED_HAT_SKILL_PACK_LABELS.join(", ")} packs from{" "}
                  <code>github.com/RHEcosystemAppEng/agentic-plugins</code> and refreshes
                  them below — no restart needed.
                </Content>
              </FlexItem>
              <FlexItem>
                <Button variant="secondary" onClick={runImport} isDisabled={importing}>
                  {importing ? "Syncing…" : "Sync now"}
                </Button>
              </FlexItem>
            </Flex>
            {importMsg && (
              <Content component={ContentVariants.small} style={{ marginTop: "0.5rem" }}>
                {importMsg}
              </Content>
            )}
          </CardBody>
        </Card>

        <div style={{ marginTop: "1rem" }}>
          <SearchInput
            aria-label="Search skills"
            placeholder={`Search ${skills.length} skills by name or description…`}
            value={query}
            onChange={(_e, v) => setQuery(v)}
            onClear={() => setQuery("")}
          />
        </div>

        {filteredGroups.length === 0 && (
          <Content component={ContentVariants.small}>No skills match &quot;{query}&quot;.</Content>
        )}

        <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsMd" }} style={{ marginTop: "1rem" }}>
          {filteredGroups.map((group) => {
            const isOpen = trimmedQuery.length > 0 || openGroups.has(group.key);
            return (
              <FlexItem key={group.key}>
                <ExpandableSection
                  toggleContent={skillGroupToggle(group.label, `${group.skills.length}`)}
                  isExpanded={isOpen}
                  onToggle={() => toggleGroup(group.key)}
                >
                  <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsMd" }}>
                    {group.skills.map((skill) => (
                      <FlexItem key={skill.id}>
                        <SkillRow skill={skill} usedBy={usedByMap.get(skill.id) ?? []} onChange={load} />
                      </FlexItem>
                    ))}
                  </Flex>
                </ExpandableSection>
              </FlexItem>
            );
          })}
        </Flex>

        <Button variant="secondary" style={{ marginTop: "1rem" }} onClick={() => setShowAdd(true)}>
          + Add skill
        </Button>

        {showAdd && (
          <AddSkillForm
            onDone={() => {
              setShowAdd(false);
              load();
            }}
            onCancel={() => setShowAdd(false)}
          />
        )}
      </CardBody>
    </Card>
  );
}

function AddSkillForm({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!name.trim() || !instructions.trim()) {
      setErr("Name and instructions are required");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await upsertSkillConfig({
        id: `${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`,
        name: name.trim(),
        description: description.trim(),
        instructions: instructions.trim(),
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal variant="large" isOpen onClose={onCancel} aria-label="Add skill">
      <ModalHeader title="Add skill" />
      <ModalBody>
        <Form>
          {err && <Alert variant="danger" isInline title={err} />}
          <FormGroup label="Name" isRequired fieldId="add-skill-name">
            <TextInput
              id="add-skill-name"
              placeholder="Name, e.g. Billing tone guide"
              value={name}
              onChange={(_e, v) => setName(v)}
            />
          </FormGroup>
          <FormGroup label="Description" fieldId="add-skill-description">
            <TextInput
              id="add-skill-description"
              placeholder="Short description (optional)"
              value={description}
              onChange={(_e, v) => setDescription(v)}
            />
          </FormGroup>
          <FormGroup label="Instructions" isRequired fieldId="add-skill-instructions">
            <TextArea
              id="add-skill-instructions"
              rows={8}
              placeholder="Instructions to merge into the agent's system prompt…"
              value={instructions}
              onChange={(_e, v) => setInstructions(v)}
            />
          </FormGroup>
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button variant="primary" onClick={() => void save()} isDisabled={saving}>
          {saving ? "Adding…" : "Add skill"}
        </Button>
        <Button variant="link" onClick={onCancel}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function SkillRow({
  skill,
  usedBy,
  onChange,
}: {
  skill: Skill;
  usedBy: Listing[];
  onChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [showUsedBy, setShowUsedBy] = useState(false);
  const [name, setName] = useState(skill.name);
  const [description, setDescription] = useState(skill.description);
  const [instructions, setInstructions] = useState(skill.instructions);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await upsertSkillConfig({ id: skill.id, name, description, instructions });
      setEditing(false);
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await deleteSkillConfig(skill.id);
      onChange();
    } finally {
      setBusy(false);
    }
  }

  const isBuiltin = skill.source === "built-in";

  return (
    <Card isCompact>
      <CardBody>
        <Flex justifyContent={{ default: "justifyContentSpaceBetween" }} alignItems={{ default: "alignItemsFlexStart" }}>
          <FlexItem>
            <strong>{skill.name}</strong>{" "}
            {skill.pack && (
              <Label isCompact color="grey">
                {skill.pack}
              </Label>
            )}
            {skill.description && <Content component={ContentVariants.small}>{skill.description}</Content>}
          </FlexItem>
          <FlexItem>
            <Flex spaceItems={{ default: "spaceItemsSm" }}>
              <FlexItem>
                <Button
                  variant="link"
                  isInline
                  onClick={() => setShowUsedBy((v) => !v)}
                  isDisabled={usedBy.length === 0}
                  title={usedBy.length === 0 ? "Not attached to any listing yet" : "Show which listings use this skill"}
                >
                  Used by {usedBy.length} listing{usedBy.length === 1 ? "" : "s"}
                </Button>
              </FlexItem>
              {isBuiltin ? (
                <FlexItem>
                  <Label isCompact color="grey">
                    Built-in (read-only)
                  </Label>
                </FlexItem>
              ) : (
                <>
                  <FlexItem>
                    <Button variant="secondary" onClick={() => setEditing((v) => !v)}>
                      {editing ? "Close" : "Edit"}
                    </Button>
                  </FlexItem>
                  <FlexItem>
                    <Button variant="danger" onClick={remove} isDisabled={busy}>
                      Remove
                    </Button>
                  </FlexItem>
                </>
              )}
            </Flex>
          </FlexItem>
        </Flex>

        {showUsedBy && usedBy.length > 0 && (
          <ul style={{ marginTop: "0.5rem" }}>
            {usedBy.map((listing) => (
              <li key={listing.id}>{listing.name}</li>
            ))}
          </ul>
        )}

        {!isBuiltin && editing ? (
          <Form style={{ marginTop: "0.75rem" }}>
            <Flex spaceItems={{ default: "spaceItemsMd" }}>
              <FlexItem flex={{ default: "flex_1" }}>
                <FormGroup label="Name" fieldId={`skill-${skill.id}-name`}>
                  <TextInput id={`skill-${skill.id}-name`} value={name} onChange={(_e, v) => setName(v)} />
                </FormGroup>
              </FlexItem>
              <FlexItem flex={{ default: "flex_1" }}>
                <FormGroup label="Description" fieldId={`skill-${skill.id}-description`}>
                  <TextInput
                    id={`skill-${skill.id}-description`}
                    value={description}
                    onChange={(_e, v) => setDescription(v)}
                  />
                </FormGroup>
              </FlexItem>
            </Flex>
            <FormGroup label="Instructions" fieldId={`skill-${skill.id}-instructions`}>
              <TextArea
                id={`skill-${skill.id}-instructions`}
                rows={4}
                value={instructions}
                onChange={(_e, v) => setInstructions(v)}
              />
            </FormGroup>
            <Button variant="primary" onClick={() => void save()} isDisabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </Form>
        ) : (
          <div style={{ marginTop: "0.5rem" }}>
            <Button variant="link" isInline onClick={() => setShowInstructions((v) => !v)}>
              {showInstructions ? "Hide instructions" : "Show instructions"}
            </Button>
            {showInstructions && <Markdown>{skill.instructions}</Markdown>}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

