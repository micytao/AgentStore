"use client";

import { useEffect, useState, useCallback } from "react";
import type { ReactNode } from "react";
import type { RhdhDeployStatus } from "@agentstore/shared";
import {
  AnsibleTowerIcon,
  CatalogIcon,
  KeyIcon,
  OpenshiftIcon,
  SyncAltIcon,
} from "@patternfly/react-icons";
import {
  Alert,
  Bullseye,
  Button,
  Card,
  CardBody,
  CardTitle,
  Content,
  ContentVariants,
  Divider,
  Flex,
  FlexItem,
  Form,
  FormGroup,
  Icon,
  Spinner,
  TextInput,
} from "@patternfly/react-core";
import {
  fetchRhdhPreflight,
  installRhdhOperator,
  fetchRhdhOperatorStatus,
  provisionRhdhInstance,
  fetchRhdhInstanceStatus,
} from "@/lib/api";

// --- Shared status-strip helpers (mirrored from PlatformPanel.tsx) ------

const STRIP_ICON_STATUS: Record<"green" | "red" | "grey", "success" | "danger" | undefined> = {
  green: "success",
  red: "danger",
  grey: undefined,
};

const STRIP_ICON_COLOR: Record<"green" | "red" | "grey", string> = {
  green: "var(--pf-t--global--icon--color--status--success--default)",
  red: "var(--pf-t--global--icon--color--status--danger--default)",
  grey: "var(--pf-t--global--icon--color--subtle)",
};

const STRIP_TEXT_COLOR: Record<"green" | "red" | "grey", string> = {
  green: "var(--pf-t--global--text--color--status--success--default)",
  red: "var(--pf-t--global--text--color--status--danger--default)",
  grey: "var(--pf-t--global--text--color--subtle)",
};

function StatusStat({
  icon,
  label,
  value,
  color,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  color: "green" | "red" | "grey";
}) {
  return (
    <Flex spaceItems={{ default: "spaceItemsSm" }} alignItems={{ default: "alignItemsCenter" }} flexWrap={{ default: "nowrap" }}>
      <FlexItem>
        <Icon size="md" status={STRIP_ICON_STATUS[color]} style={{ color: STRIP_ICON_COLOR[color] }}>
          {icon}
        </Icon>
      </FlexItem>
      <FlexItem>
        <Content component={ContentVariants.small} style={{ color: "var(--pf-t--global--text--color--subtle)" }}>
          {label}
        </Content>
      </FlexItem>
      <FlexItem>
        <span style={{ fontWeight: 600, color: STRIP_TEXT_COLOR[color] }}>{value}</span>
      </FlexItem>
    </Flex>
  );
}

// --- Preflight result type -----------------------------------------------

interface RhdhPreflightResult {
  aap: { status: string };
  openshift: { status: string };
  agentstoreOnCluster: { status: string };
  rhdhOperator: { status: string };
  rhdhInstance: { status: string };
  serviceToken: { status: string };
  deploy?: RhdhDeployStatus;
}

function statColor(status: string): "green" | "red" | "grey" {
  switch (status) {
    case "connected":
    case "running":
    case "installed":
    case "set":
      return "green";
    case "disconnected":
    case "failed":
      return "red";
    default:
      return "grey";
  }
}

function statLabel(status: string): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "disconnected":
      return "Disconnected";
    case "not-configured":
      return "Not configured";
    case "running":
      return "Running";
    case "not-deployed":
      return "Not deployed";
    case "deploying":
      return "Deploying";
    case "failed":
      return "Failed";
    case "installed":
      return "Installed";
    case "not-installed":
      return "Not installed";
    case "set":
      return "Set";
    case "not-set":
      return "Not set";
    default:
      return status;
  }
}

// --- Main component ------------------------------------------------------

export function RhdhPanel() {
  const [preflight, setPreflight] = useState<RhdhPreflightResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [operatorBusy, setOperatorBusy] = useState(false);
  const [instanceBusy, setInstanceBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Instance provision form
  const [namespace, setNamespace] = useState("rhdh");
  const [agentstoreUrl, setAgentstoreUrl] = useState("http://agentstore.agentstore.svc:3000/api");

  const load = useCallback(() => {
    fetchRhdhPreflight()
      .then(setPreflight)
      .catch((err: Error) => setError(err.message))
      .finally(() => setRefreshing(false));
  }, []);

  function refresh() {
    setRefreshing(true);
    load();
  }

  useEffect(load, [load]);

  // Poll operator install
  useEffect(() => {
    if (preflight?.deploy?.operatorStatus !== "installing") return;
    const id = setInterval(() => {
      fetchRhdhOperatorStatus()
        .then((settings) => {
          if (settings.rhdhDeploy?.operatorStatus !== "installing") {
            load();
          }
        })
        .catch(console.error);
    }, 4000);
    return () => clearInterval(id);
  }, [preflight?.deploy?.operatorStatus, load]);

  // Poll instance provision
  useEffect(() => {
    if (preflight?.deploy?.instanceStatus !== "deploying") return;
    const id = setInterval(() => {
      fetchRhdhInstanceStatus()
        .then((settings) => {
          if (settings.rhdhDeploy?.instanceStatus !== "deploying") {
            load();
          } else if (settings.rhdhDeploy?.routeUrl) {
            setPreflight((prev) =>
              prev
                ? {
                    ...prev,
                    deploy: settings.rhdhDeploy,
                    rhdhInstance: { status: "deploying" },
                  }
                : prev
            );
          }
        })
        .catch(console.error);
    }, 4000);
    return () => clearInterval(id);
  }, [preflight?.deploy?.instanceStatus, load]);

  async function handleInstallOperator() {
    setOperatorBusy(true);
    try {
      const settings = await installRhdhOperator();
      setPreflight((prev) =>
        prev ? { ...prev, deploy: settings.rhdhDeploy, rhdhOperator: { status: "not-installed" } } : prev
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setOperatorBusy(false);
    }
  }

  async function handleProvisionInstance() {
    setInstanceBusy(true);
    try {
      const settings = await provisionRhdhInstance({ namespace, agentstoreUrl });
      setPreflight((prev) =>
        prev ? { ...prev, deploy: settings.rhdhDeploy, rhdhInstance: { status: "deploying" } } : prev
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstanceBusy(false);
    }
  }

  if (error && !preflight) return <Alert variant="danger" isInline title={error} />;
  if (!preflight) {
    return (
      <Bullseye>
        <Spinner aria-label="Loading RHDH status" />
      </Bullseye>
    );
  }

  const operatorInstalling = preflight.deploy?.operatorStatus === "installing";
  const operatorInstalled = preflight.rhdhOperator.status === "installed" || preflight.deploy?.operatorStatus === "installed";
  const instanceDeploying = preflight.deploy?.instanceStatus === "deploying";
  const instanceRunning = preflight.rhdhInstance.status === "running" || preflight.deploy?.instanceStatus === "running";

  return (
    <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsLg" }}>
      {error ? (
        <FlexItem>
          <Alert variant="danger" isInline title={error} />
        </FlexItem>
      ) : null}

      {/* Section 1: Preflight status strip */}
      <FlexItem>
        <Card isCompact>
          <CardBody>
            <Flex spaceItems={{ default: "spaceItemsLg" }} flexWrap={{ default: "wrap" }} alignItems={{ default: "alignItemsCenter" }}>
              <FlexItem>
                <StatusStat
                  icon={<AnsibleTowerIcon />}
                  label="AAP"
                  value={statLabel(preflight.aap.status)}
                  color={statColor(preflight.aap.status)}
                />
              </FlexItem>
              <Divider orientation={{ default: "vertical" }} />
              <FlexItem>
                <StatusStat
                  icon={<OpenshiftIcon />}
                  label="OpenShift"
                  value={statLabel(preflight.openshift.status)}
                  color={statColor(preflight.openshift.status)}
                />
              </FlexItem>
              <Divider orientation={{ default: "vertical" }} />
              <FlexItem>
                <StatusStat
                  icon={<OpenshiftIcon />}
                  label="AgentStore on cluster"
                  value={statLabel(preflight.agentstoreOnCluster.status)}
                  color={statColor(preflight.agentstoreOnCluster.status)}
                />
              </FlexItem>
              <Divider orientation={{ default: "vertical" }} />
              <FlexItem>
                <StatusStat
                  icon={<CatalogIcon />}
                  label="RHDH Operator"
                  value={operatorInstalling ? "Installing…" : statLabel(preflight.rhdhOperator.status)}
                  color={operatorInstalling ? "grey" : statColor(preflight.rhdhOperator.status)}
                />
              </FlexItem>
              <Divider orientation={{ default: "vertical" }} />
              <FlexItem>
                <StatusStat
                  icon={<CatalogIcon />}
                  label="RHDH Instance"
                  value={statLabel(preflight.rhdhInstance.status)}
                  color={statColor(preflight.rhdhInstance.status)}
                />
              </FlexItem>
              <Divider orientation={{ default: "vertical" }} />
              <FlexItem>
                <StatusStat
                  icon={<KeyIcon />}
                  label="Service token"
                  value={statLabel(preflight.serviceToken.status)}
                  color={statColor(preflight.serviceToken.status)}
                />
              </FlexItem>
              <Divider orientation={{ default: "vertical" }} />
              <FlexItem>
                <Button variant="plain" aria-label="Refresh status" isDisabled={refreshing} onClick={refresh}>
                  <SyncAltIcon style={refreshing ? { animation: "spin 1s linear infinite" } : undefined} />
                </Button>
              </FlexItem>
            </Flex>
          </CardBody>
        </Card>
      </FlexItem>

      {/* Section 2: Install RHDH Operator */}
      <FlexItem>
        <Card>
          <CardTitle>
            <Flex justifyContent={{ default: "justifyContentSpaceBetween" }} alignItems={{ default: "alignItemsCenter" }}>
              <FlexItem>
                <Flex spaceItems={{ default: "spaceItemsSm" }} alignItems={{ default: "alignItemsCenter" }} flexWrap={{ default: "nowrap" }}>
                  <FlexItem style={{ display: "flex" }}>
                    <CatalogIcon />
                  </FlexItem>
                  <FlexItem>Install RHDH Operator</FlexItem>
                </Flex>
              </FlexItem>
              <FlexItem>
                <Button
                  variant="secondary"
                  isDisabled={operatorBusy || operatorInstalling || operatorInstalled}
                  onClick={() => void handleInstallOperator()}
                >
                  {operatorInstalled ? "Installed" : operatorInstalling ? "Installing…" : "Install Operator"}
                </Button>
              </FlexItem>
            </Flex>
          </CardTitle>
          <CardBody>
            <Content component={ContentVariants.small}>
              Creates the <code>rhdh</code> namespace, an OperatorGroup, and a Subscription for the
              Red Hat Developer Hub operator from the <code>redhat-operators</code> CatalogSource.
              The operator installs automatically once the Subscription is created.
            </Content>
            {operatorInstalled && (
              <Alert variant="success" isInline isPlain title="RHDH operator is installed and ready." style={{ marginTop: "0.5rem" }} />
            )}
            {preflight.deploy?.operatorStatus === "failed" && preflight.deploy?.error && (
              <Alert variant="danger" isInline isPlain title={preflight.deploy.error} style={{ marginTop: "0.5rem" }} />
            )}
          </CardBody>
        </Card>
      </FlexItem>

      {/* Section 3: Provision RHDH Instance */}
      <FlexItem>
        <Card>
          <CardTitle>
            <Flex justifyContent={{ default: "justifyContentSpaceBetween" }} alignItems={{ default: "alignItemsCenter" }}>
              <FlexItem>
                <Flex spaceItems={{ default: "spaceItemsSm" }} alignItems={{ default: "alignItemsCenter" }} flexWrap={{ default: "nowrap" }}>
                  <FlexItem style={{ display: "flex" }}>
                    <CatalogIcon />
                  </FlexItem>
                  <FlexItem>Provision RHDH Instance</FlexItem>
                </Flex>
              </FlexItem>
              <FlexItem>
                <Button
                  variant="secondary"
                  isDisabled={instanceBusy || instanceDeploying || !operatorInstalled}
                  onClick={() => void handleProvisionInstance()}
                >
                  {instanceRunning ? "Redeploy" : instanceDeploying ? "Deploying…" : "Deploy Instance"}
                </Button>
              </FlexItem>
            </Flex>
          </CardTitle>
          <CardBody>
            {!operatorInstalled && (
              <Alert variant="info" isInline isPlain title="Install the RHDH operator first." style={{ marginBottom: "0.5rem" }} />
            )}
            <Content component={ContentVariants.small}>
              Creates the app-config ConfigMap, dynamic-plugins ConfigMap, secrets, and a Backstage CR
              in the RHDH namespace. The operator then rolls out a Developer Hub pod with the AgentStore
              integration pre-configured.
            </Content>
            <Form style={{ marginTop: "0.75rem" }}>
              <Flex spaceItems={{ default: "spaceItemsMd" }}>
                <FlexItem flex={{ default: "flex_1" }}>
                  <FormGroup label="RHDH namespace" fieldId="rhdh-namespace">
                    <TextInput
                      id="rhdh-namespace"
                      value={namespace}
                      onChange={(_e, v) => setNamespace(v)}
                    />
                  </FormGroup>
                </FlexItem>
                <FlexItem flex={{ default: "flex_1" }}>
                  <FormGroup label="AgentStore internal URL" fieldId="rhdh-agentstore-url">
                    <TextInput
                      id="rhdh-agentstore-url"
                      value={agentstoreUrl}
                      onChange={(_e, v) => setAgentstoreUrl(v)}
                    />
                  </FormGroup>
                </FlexItem>
              </Flex>
            </Form>
            {instanceRunning && preflight.deploy?.routeUrl && (
              <Alert
                variant="success"
                isInline
                isPlain
                title={
                  <>
                    RHDH is running at{" "}
                    <a href={preflight.deploy.routeUrl} target="_blank" rel="noreferrer">
                      {preflight.deploy.routeUrl}
                    </a>
                  </>
                }
                style={{ marginTop: "0.5rem" }}
              />
            )}
            {preflight.deploy?.instanceStatus === "failed" && preflight.deploy?.error && (
              <Alert variant="danger" isInline isPlain title={preflight.deploy.error} style={{ marginTop: "0.5rem" }} />
            )}
            {instanceDeploying && (
              <Alert variant="info" isInline isPlain title="Waiting for RHDH pod to become ready…" style={{ marginTop: "0.5rem" }} />
            )}
          </CardBody>
        </Card>
      </FlexItem>
    </Flex>
  );
}
