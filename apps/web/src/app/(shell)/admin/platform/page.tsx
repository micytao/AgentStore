"use client";

import { useState } from "react";
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from "@patternfly/react-core";
import { AdminPageHeader } from "@/components/AdminPageHeader";
import { PlatformPanel } from "@/components/PlatformPanel";
import { resetClusterState } from "@/lib/api";

export default function PlatformSettingsPage() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  async function handleReset() {
    setResetting(true);
    try {
      await resetClusterState();
      setConfirmOpen(false);
      window.location.reload();
    } catch (err) {
      console.error(err);
    } finally {
      setResetting(false);
    }
  }

  return (
    <AdminPageHeader
      eyebrow="Settings"
      title="Platform"
      description="Connect Ansible Automation Platform and OpenShift so agents can be deployed for real."
      action={
        <Button variant="link" isDanger onClick={() => setConfirmOpen(true)}>
          Reset for New Cluster
        </Button>
      }
    >
      <PlatformPanel />

      {confirmOpen && (
        <Modal variant="small" isOpen onClose={() => setConfirmOpen(false)} aria-label="Reset for new cluster">
          <ModalHeader title="Reset for New Cluster?" titleIconVariant="warning" />
          <ModalBody>
            This will clear all deploy statuses, build results, image references,
            and sync tokens — keeping your connection URLs, AAP job template IDs,
            execution environment IDs, and project configuration.
            <br /><br />
            Use this when switching to a new cluster so stale state from
            the previous cluster doesn&apos;t interfere.
          </ModalBody>
          <ModalFooter>
            <Button variant="danger" isLoading={resetting} isDisabled={resetting} onClick={() => void handleReset()}>
              Reset
            </Button>
            <Button variant="link" onClick={() => setConfirmOpen(false)} isDisabled={resetting}>
              Cancel
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </AdminPageHeader>
  );
}
