"use client";

import { useEffect, useState } from "react";
import type { ComponentType } from "react";
import { BookIcon, NetworkIcon, PlugIcon } from "@patternfly/react-icons";
import {
  Alert,
  Bullseye,
  Button,
  Card,
  CardBody,
  CardTitle,
  Checkbox,
  Content,
  ContentVariants,
  Flex,
  FlexItem,
  Form,
  FormGroup,
  FormSelect,
  FormSelectOption,
  InputGroup,
  InputGroupItem,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Spinner,
  Tab,
  Tabs,
  TabTitleIcon,
  TabTitleText,
  TextInput,
} from "@patternfly/react-core";
import {
  PROVIDER_KINDS,
  type McpServerStatus,
  type McpTransport,
  type ProviderConfig,
  type ProviderKind,
  type ProviderStatus,
} from "@agentstore/shared";
import { SkillsPanel } from "@/components/SkillsPanel";
import {
  activateProviderConfig,
  connectMcpServerConfig,
  deleteMcpServerConfig,
  deleteProviderConfig,
  disconnectMcpServerConfig,
  fetchMcpServers,
  fetchProviders,
  setMcpAuthTokenValue,
  setMcpToolEnabledValue,
  setProviderKeyValue,
  testProviderConnection,
  upsertMcpServerConfig,
  upsertProviderConfig,
} from "@/lib/api";

type LLMsSubTab = "providers" | "mcp" | "skills";

const LLMS_SUBTABS: { id: LLMsSubTab; label: string; icon: ComponentType }[] = [
  { id: "providers", label: "Providers", icon: PlugIcon },
  { id: "mcp", label: "MCP", icon: NetworkIcon },
  { id: "skills", label: "Skills", icon: BookIcon },
];

export function LLMsPanel() {
  const [subTab, setSubTab] = useState<LLMsSubTab>("providers");

  return (
    <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsLg" }}>
      <FlexItem>
        <Tabs
          activeKey={subTab}
          onSelect={(_event, eventKey) => setSubTab(eventKey as LLMsSubTab)}
          aria-label="LLM sections"
          isSubtab
        >
          {LLMS_SUBTABS.map((item) => {
            const Icon = item.icon;
            return (
              <Tab
                key={item.id}
                eventKey={item.id}
                title={
                  <>
                    <TabTitleIcon>
                      <Icon />
                    </TabTitleIcon>
                    <TabTitleText>{item.label}</TabTitleText>
                  </>
                }
              />
            );
          })}
        </Tabs>
      </FlexItem>

      <FlexItem>
        {subTab === "providers" && <ProvidersPanel />}
        {subTab === "mcp" && <McpPanel />}
        {subTab === "skills" && <SkillsPanel />}
      </FlexItem>
    </Flex>
  );
}

function slugify(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || `provider-${Date.now()}`
  );
}

function ProvidersPanel() {
  const [providers, setProviders] = useState<ProviderStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  function load() {
    fetchProviders()
      .then(setProviders)
      .catch((err: Error) => setError(err.message));
  }

  useEffect(load, []);

  if (error) return <Alert variant="danger" isInline title={error} />;
  if (!providers) {
    return (
      <Bullseye>
        <Spinner aria-label="Loading providers" />
      </Bullseye>
    );
  }

  return (
    <Card>
      <CardTitle>Model providers</CardTitle>
      <CardBody>
        <Content component={ContentVariants.small}>
          Add a real API key for a provider, test the connection, and mark
          one provider active. The active provider powers generic-chat
          agent conversations and OpenShell model selection whenever a
          listing doesn't bind its own provider.
        </Content>

        {providers.length === 0 && (
          <Content component={ContentVariants.small}>No providers configured yet.</Content>
        )}

        <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsMd" }} style={{ marginTop: "1rem" }}>
          {providers.map((provider) => (
            <FlexItem key={provider.id}>
              <ProviderRow provider={provider} onChange={load} />
            </FlexItem>
          ))}
        </Flex>

        <Button variant="secondary" style={{ marginTop: "1rem" }} onClick={() => setShowAdd(true)}>
          + Add provider
        </Button>

        {showAdd && (
          <AddProviderForm
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

function AddProviderForm({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  // Default to "OpenAI-compatible endpoint" — the kind the "OpenShift AI"
  // quick preset above actually configures (OpenShift AI isn't its own
  // ProviderKind, it's an openai-compatible endpoint with a prefilled
  // label/base URL), so Kind already matches the featured preset on open.
  const [kind, setKind] = useState<ProviderKind>("openai-compatible");
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function applyMaasPreset() {
    setKind("openai-compatible");
    setLabel((prev) => prev || "OpenShift AI (MaaS)");
    setBaseUrl((prev) => prev || "http://localhost:8000/v1");
  }

  async function save() {
    if (!label.trim()) {
      setErr("Label is required");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const config: ProviderConfig = {
        id: `${slugify(label)}-${Math.random().toString(36).slice(2, 6)}`,
        kind,
        label: label.trim(),
        baseUrl: kind === "openai-compatible" ? baseUrl.trim() || undefined : undefined,
      };
      await upsertProviderConfig(config);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal variant="medium" isOpen onClose={onCancel} aria-label="Add provider">
      <ModalHeader title="Add provider" />
      <ModalBody>
        <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsMd" }}>
          {err && (
            <FlexItem>
              <Alert variant="danger" isInline title={err} />
            </FlexItem>
          )}
          <FlexItem>
            <Content component={ContentVariants.small}>
              Quick preset:{" "}
              <Button variant="link" isInline onClick={applyMaasPreset}>
                OpenShift AI — Model as a Service
              </Button>{" "}
              — points an OpenAI-compatible provider at a vLLM endpoint served by
              Red Hat OpenShift AI&apos;s Model as a Service (KServe/vLLM); no API key
              required for a locally self-hosted one.
            </Content>
          </FlexItem>
          <FlexItem>
            <Form>
              <FormGroup label="Kind" fieldId="add-provider-kind">
                <FormSelect id="add-provider-kind" value={kind} onChange={(_e, v) => setKind(v as ProviderKind)}>
                  {PROVIDER_KINDS.map((k) => (
                    <FormSelectOption key={k.id} value={k.id} label={k.label} />
                  ))}
                </FormSelect>
              </FormGroup>
              <FormGroup label="Label" isRequired fieldId="add-provider-label">
                <TextInput
                  id="add-provider-label"
                  placeholder="Label, e.g. Anthropic (prod)"
                  value={label}
                  onChange={(_e, v) => setLabel(v)}
                />
              </FormGroup>
              {kind === "openai-compatible" && (
                <FormGroup label="Base URL" fieldId="add-provider-base-url">
                  <TextInput
                    id="add-provider-base-url"
                    placeholder="Base URL, e.g. http://localhost:8000/v1"
                    value={baseUrl}
                    onChange={(_e, v) => setBaseUrl(v)}
                  />
                </FormGroup>
              )}
            </Form>
          </FlexItem>
          {kind === "openai-compatible" && (
            <FlexItem>
              <Content component={ContentVariants.small}>
                No API key needed for a self-hosted server with no auth configured
                — leave the key blank after adding and just hit &quot;Test
                connection&quot;.
              </Content>
            </FlexItem>
          )}
        </Flex>
      </ModalBody>
      <ModalFooter>
        <Button variant="primary" onClick={() => void save()} isDisabled={saving}>
          {saving ? "Adding…" : "Add provider"}
        </Button>
        <Button variant="link" onClick={onCancel}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function ProviderRow({
  provider,
  onChange,
}: {
  provider: ProviderStatus;
  onChange: () => void;
}) {
  const [keyInput, setKeyInput] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [model, setModel] = useState(provider.defaultModel ?? "");
  const [busy, setBusy] = useState(false);

  async function saveKey() {
    if (!keyInput.trim()) return;
    setSavingKey(true);
    try {
      await setProviderKeyValue(provider.id, keyInput.trim());
      setKeyInput("");
      onChange();
    } finally {
      setSavingKey(false);
    }
  }

  async function test() {
    setTesting(true);
    try {
      await testProviderConnection(provider.id);
      onChange();
    } finally {
      setTesting(false);
    }
  }

  async function saveModel(next: string) {
    setModel(next);
    await upsertProviderConfig({ ...provider, defaultModel: next });
    onChange();
  }

  async function activate() {
    setBusy(true);
    try {
      await activateProviderConfig(provider.id);
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await deleteProviderConfig(provider.id);
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
            <strong>{provider.label}</strong>
            <Content component={ContentVariants.small}>
              {PROVIDER_KINDS.find((k) => k.id === provider.kind)?.label ?? provider.kind}
            </Content>
          </FlexItem>
          <FlexItem>
            <Flex spaceItems={{ default: "spaceItemsSm" }}>
              <FlexItem>
                <Label color={provider.active ? "green" : "grey"} isCompact>
                  {provider.active ? "Active" : "Inactive"}
                </Label>
              </FlexItem>
              <FlexItem>
                <Label
                  color={provider.hasKey ? "green" : provider.kind === "openai-compatible" ? "grey" : "orange"}
                  isCompact
                >
                  {provider.hasKey
                    ? `Key set (${provider.keyPreview})`
                    : provider.kind === "openai-compatible"
                      ? "No key (optional for self-hosted servers)"
                      : "No key"}
                </Label>
              </FlexItem>
              {provider.lastError && (
                <FlexItem>
                  <Label color="red" isCompact>
                    Test failed
                  </Label>
                </FlexItem>
              )}
              {provider.lastChecked && !provider.lastError && (
                <FlexItem>
                  <Label color="blue" isCompact>
                    Tested OK
                  </Label>
                </FlexItem>
              )}
            </Flex>
          </FlexItem>
        </Flex>

        <InputGroup style={{ marginTop: "0.75rem" }}>
          <InputGroupItem isFill>
            <TextInput
              type="password"
              aria-label={`API key for ${provider.label}`}
              placeholder="Paste API key"
              value={keyInput}
              onChange={(_e, v) => setKeyInput(v)}
            />
          </InputGroupItem>
          <InputGroupItem>
            <Button variant="secondary" onClick={saveKey} isDisabled={savingKey || !keyInput.trim()}>
              {savingKey ? "Saving…" : "Save key"}
            </Button>
          </InputGroupItem>
          <InputGroupItem>
            <Button
              variant="secondary"
              onClick={test}
              isDisabled={testing || (!provider.hasKey && provider.kind !== "openai-compatible")}
            >
              {testing ? "Testing…" : "Test connection"}
            </Button>
          </InputGroupItem>
        </InputGroup>

        {provider.lastError && <Alert variant="danger" isInline title={provider.lastError} style={{ marginTop: "0.5rem" }} />}

        {provider.models && provider.models.length > 0 && (
          <FormSelect
            aria-label={`Default model for ${provider.label}`}
            value={model}
            onChange={(_e, v) => saveModel(v)}
            style={{ marginTop: "0.75rem" }}
          >
            <FormSelectOption value="" label="Default model…" />
            {provider.models.map((m) => (
              <FormSelectOption key={m} value={m} label={m} />
            ))}
          </FormSelect>
        )}

        <Flex spaceItems={{ default: "spaceItemsSm" }} style={{ marginTop: "0.75rem" }}>
          {!provider.active && (
            <FlexItem>
              <Button variant="secondary" onClick={activate} isDisabled={busy}>
                Make active
              </Button>
            </FlexItem>
          )}
          <FlexItem>
            <Button variant="danger" onClick={remove} isDisabled={busy}>
              Remove
            </Button>
          </FlexItem>
        </Flex>
      </CardBody>
    </Card>
  );
}

const MCP_TRANSPORTS: { id: McpTransport; label: string }[] = [
  { id: "stdio", label: "stdio (local command)" },
  { id: "streamable-http", label: "Streamable HTTP" },
  { id: "sse", label: "SSE (legacy)" },
];

function McpPanel() {
  const [servers, setServers] = useState<McpServerStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  function load() {
    fetchMcpServers()
      .then(setServers)
      .catch((err: Error) => setError(err.message));
  }

  useEffect(load, []);

  if (error) return <Alert variant="danger" isInline title={error} />;
  if (!servers) {
    return (
      <Bullseye>
        <Spinner aria-label="Loading MCP servers" />
      </Bullseye>
    );
  }

  return (
    <Card>
      <CardTitle>MCP servers &amp; tools</CardTitle>
      <CardBody>
        <Content component={ContentVariants.small}>
          Connect a real MCP server, then enable individual tools you want
          your agents to be able to call.{" "}
          <strong>stdio servers run a local command you specify — only
          connect servers you trust.</strong>
        </Content>

        {servers.length === 0 && (
          <Content component={ContentVariants.small}>No MCP servers registered yet.</Content>
        )}

        <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsMd" }} style={{ marginTop: "1rem" }}>
          {servers.map((server) => (
            <FlexItem key={server.id}>
              <McpServerRow server={server} onChange={load} />
            </FlexItem>
          ))}
        </Flex>

        <Button variant="secondary" style={{ marginTop: "1rem" }} onClick={() => setShowAdd(true)}>
          + Add MCP server
        </Button>

        {showAdd && (
          <AddMcpServerForm
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

function AddMcpServerForm({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const [transport, setTransport] = useState<McpTransport>("stdio");
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) {
      setErr("Name is required");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await upsertMcpServerConfig({
        id: `${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`,
        name: name.trim(),
        transport,
        command: transport === "stdio" ? command.trim() || undefined : undefined,
        args: transport === "stdio" ? args.split(" ").filter(Boolean) : undefined,
        url: transport !== "stdio" ? url.trim() || undefined : undefined,
        enabled: true,
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal variant="medium" isOpen onClose={onCancel} aria-label="Add MCP server">
      <ModalHeader title="Add MCP server" />
      <ModalBody>
        <Form>
          {err && <Alert variant="danger" isInline title={err} />}
          <FormGroup label="Transport" fieldId="add-mcp-transport">
            <FormSelect id="add-mcp-transport" value={transport} onChange={(_e, v) => setTransport(v as McpTransport)}>
              {MCP_TRANSPORTS.map((t) => (
                <FormSelectOption key={t.id} value={t.id} label={t.label} />
              ))}
            </FormSelect>
          </FormGroup>
          <FormGroup label="Name" isRequired fieldId="add-mcp-name">
            <TextInput id="add-mcp-name" placeholder="Name" value={name} onChange={(_e, v) => setName(v)} />
          </FormGroup>
          {transport === "stdio" ? (
            <>
              <FormGroup label="Command" fieldId="add-mcp-command">
                <TextInput
                  id="add-mcp-command"
                  placeholder="Command, e.g. npx"
                  value={command}
                  onChange={(_e, v) => setCommand(v)}
                />
              </FormGroup>
              <FormGroup label="Args" fieldId="add-mcp-args">
                <TextInput
                  id="add-mcp-args"
                  placeholder="Args, space separated"
                  value={args}
                  onChange={(_e, v) => setArgs(v)}
                />
              </FormGroup>
            </>
          ) : (
            <FormGroup label="Server URL" fieldId="add-mcp-url">
              <TextInput
                id="add-mcp-url"
                placeholder="Server URL, e.g. https://host/mcp"
                value={url}
                onChange={(_e, v) => setUrl(v)}
              />
            </FormGroup>
          )}
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button variant="primary" onClick={() => void save()} isDisabled={saving}>
          {saving ? "Adding…" : "Add server"}
        </Button>
        <Button variant="link" onClick={onCancel}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function McpServerRow({
  server,
  onChange,
}: {
  server: McpServerStatus;
  onChange: () => void;
}) {
  const [connecting, setConnecting] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function connect() {
    setConnecting(true);
    try {
      await connectMcpServerConfig(server.id);
      onChange();
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await disconnectMcpServerConfig(server.id);
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function saveToken() {
    if (!tokenInput.trim()) return;
    setBusy(true);
    try {
      await setMcpAuthTokenValue(server.id, tokenInput.trim());
      setTokenInput("");
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await deleteMcpServerConfig(server.id);
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function toggleTool(toolName: string, enabled: boolean) {
    await setMcpToolEnabledValue(server.id, toolName, enabled);
    onChange();
  }

  const stateColor: "green" | "red" | "grey" =
    server.connectionState === "connected" ? "green" : server.connectionState === "error" ? "red" : "grey";

  return (
    <Card isCompact>
      <CardBody>
        <Flex justifyContent={{ default: "justifyContentSpaceBetween" }} alignItems={{ default: "alignItemsFlexStart" }}>
          <FlexItem>
            <strong>{server.name}</strong>
            <Content component={ContentVariants.small}>
              {MCP_TRANSPORTS.find((t) => t.id === server.transport)?.label ?? server.transport} ·{" "}
              {server.transport === "stdio" ? server.command : server.url}
            </Content>
          </FlexItem>
          <FlexItem>
            <Label color={stateColor} isCompact>
              {server.connectionState}
            </Label>
          </FlexItem>
        </Flex>

        {server.lastError && <Alert variant="danger" isInline title={server.lastError} style={{ marginTop: "0.5rem" }} />}

        {server.transport !== "stdio" && (
          <InputGroup style={{ marginTop: "0.75rem" }}>
            <InputGroupItem isFill>
              <TextInput
                type="password"
                aria-label={`Auth token for ${server.name}`}
                placeholder={server.hasAuthToken ? "Auth token set — enter to replace" : "Bearer auth token (optional)"}
                value={tokenInput}
                onChange={(_e, v) => setTokenInput(v)}
              />
            </InputGroupItem>
            <InputGroupItem>
              <Button variant="secondary" onClick={saveToken} isDisabled={busy || !tokenInput.trim()}>
                Save token
              </Button>
            </InputGroupItem>
          </InputGroup>
        )}

        <Flex spaceItems={{ default: "spaceItemsSm" }} style={{ marginTop: "0.75rem" }}>
          <FlexItem>
            <Button variant="secondary" onClick={connect} isDisabled={connecting}>
              {connecting ? "Connecting…" : server.connectionState === "connected" ? "Reconnect" : "Connect"}
            </Button>
          </FlexItem>
          {server.connectionState === "connected" && (
            <FlexItem>
              <Button variant="secondary" onClick={disconnect} isDisabled={busy}>
                Disconnect
              </Button>
            </FlexItem>
          )}
          <FlexItem>
            <Button variant="danger" onClick={remove} isDisabled={busy}>
              Remove
            </Button>
          </FlexItem>
        </Flex>

        {server.connectionState === "connected" && (
          <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsXs" }} style={{ marginTop: "0.75rem" }}>
            {server.tools.length === 0 ? (
              <FlexItem>
                <Content component={ContentVariants.small}>This server did not advertise any tools.</Content>
              </FlexItem>
            ) : (
              server.tools.map((tool) => (
                <FlexItem key={tool.name}>
                  <Checkbox
                    id={`mcp-tool-${server.id}-${tool.name}`}
                    isChecked={tool.enabled}
                    onChange={(_e, checked) => toggleTool(tool.name, checked)}
                    label={
                      <>
                        {tool.name}
                        {tool.description && (
                          <Content component={ContentVariants.small}>{tool.description}</Content>
                        )}
                      </>
                    }
                  />
                </FlexItem>
              ))
            )}
          </Flex>
        )}
      </CardBody>
    </Card>
  );
}
