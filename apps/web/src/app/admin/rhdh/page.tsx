import { AdminPageHeader } from "@/components/AdminPageHeader";
import { RhdhPanel } from "@/components/RhdhPanel";

export default function RhdhPage() {
  return (
    <AdminPageHeader
      eyebrow="Self-service Portal"
      title="Red Hat Developer Hub"
      description="Install the RHDH operator and provision a Developer Hub instance with AgentStore integration — the end-user self-service portal for requesting and deploying agents."
    >
      <RhdhPanel />
    </AdminPageHeader>
  );
}
