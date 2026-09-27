import { AdminPageHeader } from "@/components/AdminPageHeader";
import { CatalogManager } from "@/components/CatalogManager";

export default function CatalogSettingsPage() {
  return (
    <AdminPageHeader
      title="Catalog"
      description="Onboard new agents, edit existing listings, and manage per-agent model/tool/skill bindings."
    >
      <CatalogManager />
    </AdminPageHeader>
  );
}
