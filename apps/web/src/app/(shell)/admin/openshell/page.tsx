import { AdminPageHeader } from "@/components/AdminPageHeader";
import { OpenShellDiagram } from "@/components/OpenShellDiagram";
import { OpenShellPanel } from "@/components/OpenShellPanel";

export default function OpenShellSettingsPage() {
  return (
    <AdminPageHeader
      eyebrow="Settings"
      title="OpenShell"
      description="Onboard the OpenShell gateway and monitor the Agent Sandbox Service that powers Collaborative Agents."
    >
      <OpenShellDiagram />
      <div style={{ marginTop: "1.5rem" }} />
      <OpenShellPanel />
    </AdminPageHeader>
  );
}
