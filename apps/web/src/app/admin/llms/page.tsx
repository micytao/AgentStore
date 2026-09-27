import { AdminPageHeader } from "@/components/AdminPageHeader";
import { LLMsPanel } from "@/components/LLMsPanel";

export default function LLMsSettingsPage() {
  return (
    <AdminPageHeader
      eyebrow="Settings"
      title="LLMs"
      description="Manage model providers, MCP tool servers, and the OpenShell gateway/sandbox service."
    >
      <LLMsPanel />
    </AdminPageHeader>
  );
}
