import { AdminPageHeader } from "@/components/AdminPageHeader";
import { SkillsPanel } from "@/components/SkillsPanel";

export default function SkillsSettingsPage() {
  return (
    <AdminPageHeader
      title="Skills"
      description="Author reusable skill instructions and attach them to agents in the Catalog."
    >
      <SkillsPanel />
    </AdminPageHeader>
  );
}
