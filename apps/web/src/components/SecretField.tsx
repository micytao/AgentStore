"use client";

import { useState } from "react";
import type { SecretSummary } from "@agentstore/shared";
import {
  Button,
  Card,
  CardBody,
  Content,
  ContentVariants,
  Flex,
  FlexItem,
  InputGroup,
  InputGroupItem,
  Label,
  TextInput,
} from "@patternfly/react-core";
import { EyeIcon, EyeSlashIcon } from "@patternfly/react-icons";
import { clearSecretValue, setSecretValue } from "@/lib/api";

const SOURCE_COLOR: Record<SecretSummary["source"], "green" | "blue" | "grey"> = {
  vault: "green",
  env: "blue",
  none: "grey",
};

const SOURCE_LABEL: Record<SecretSummary["source"], string> = {
  vault: "Vault",
  env: "Env",
  none: "Not set",
};

/** Inline card for viewing/setting/clearing a single fixed secret slot.
 * Shared by the Platform tab (AAP/OpenShift tokens) and the LLMs tab's
 * OpenShell sub-tab (gateway token, git PAT). */
export function SecretField({
  secret,
  onChange,
  badge,
}: {
  secret: SecretSummary;
  onChange: () => void;
  badge?: string;
}) {
  const [value, setValue] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!value.trim()) return;
    setBusy(true);
    try {
      await setSecretValue(secret.key, value.trim());
      setValue("");
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    try {
      await clearSecretValue(secret.key);
      onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card isCompact>
      <CardBody>
        <Flex justifyContent={{ default: "justifyContentSpaceBetween" }} alignItems={{ default: "alignItemsFlexStart" }}>
          <FlexItem>
            <Content>
              <Content component={ContentVariants.p}>
                <strong>{secret.label}</strong>
              </Content>
              <Content component={ContentVariants.small}>
                {secret.description} · Used by: {secret.usedBy}
              </Content>
            </Content>
          </FlexItem>
          <FlexItem>
            {badge && (
              <>
                <Label color="blue" isCompact variant="outline">
                  {badge}
                </Label>{" "}
              </>
            )}
            <Label color={SOURCE_COLOR[secret.source]} isCompact>
              {SOURCE_LABEL[secret.source]}
            </Label>{" "}
            {secret.preview && (
              <Label color="grey" isCompact>
                {secret.preview}
              </Label>
            )}
          </FlexItem>
        </Flex>

        <InputGroup style={{ marginTop: "0.75rem" }}>
          <InputGroupItem isFill>
            <TextInput
              type={visible ? "text" : "password"}
              aria-label={`New value for ${secret.label}`}
              placeholder="Set a new value"
              value={value}
              onChange={(_e, v) => setValue(v)}
            />
          </InputGroupItem>
          <InputGroupItem>
            <Button
              variant="control"
              aria-label={visible ? "Hide value" : "Show value"}
              onClick={() => setVisible((v) => !v)}
            >
              {visible ? <EyeSlashIcon /> : <EyeIcon />}
            </Button>
          </InputGroupItem>
          <InputGroupItem>
            <Button variant="secondary" onClick={() => void save()} isDisabled={busy || !value.trim()}>
              Save
            </Button>
          </InputGroupItem>
          {secret.hasValue && (
            <InputGroupItem>
              <Button variant="danger" onClick={() => void clear()} isDisabled={busy}>
                Clear
              </Button>
            </InputGroupItem>
          )}
        </InputGroup>
      </CardBody>
    </Card>
  );
}
