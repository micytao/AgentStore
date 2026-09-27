import { AdminPageHeader } from "@/components/AdminPageHeader";
import { PlatformPanel } from "@/components/PlatformPanel";

export default function PlatformSettingsPage() {
  return (
    <AdminPageHeader
      title="Platform"
      description="Connect Ansible Automation Platform and OpenShift so agents can be deployed for real."
    >
      <PlatformPanel />
    </AdminPageHeader>
  );
}
