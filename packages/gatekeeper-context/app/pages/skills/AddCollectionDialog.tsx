import { Button, Dialog, Input, Text } from "@cloudflare/kumo";
import { useState } from "react";
import type { EnabledCollectionInfo } from "../../../src/context-types";
import { DEFAULT_COLLECTION_ICON, IconPickerButton } from "../../ContextLibraryPage";
import { useContextApi, usePresentWhileOpen } from "../../bridge";

export const AddCollectionDialog = ({ open, onOpenChange, onCreated }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (collection: EnabledCollectionInfo) => void;
}) => {
  const context = useContextApi();
  const presentation = usePresentWhileOpen(open);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState(DEFAULT_COLLECTION_ICON);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const reset = () => {
    setName("");
    setIcon(DEFAULT_COLLECTION_ICON);
    setDescription("");
    setError(null);
  };

  const close = () => {
    if (creating) return;
    reset();
    onOpenChange(false);
  };

  const createCollection = async () => {
    const title = name.trim();
    if (!title) {
      setError("Enter a collection name.");
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const metadata = await context.createContextCollection(
        title,
        description.trim(),
        "private",
        icon,
        "web",
      );
      reset();
      onOpenChange(false);
      onCreated({
        id: metadata.id,
        title: metadata.title,
        description: metadata.description,
        icon: metadata.icon,
        source: metadata.visibility,
        lastUpdated: metadata.lastUpdated,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The collection could not be created.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog.Root
      open={open && presentation.presenting}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
      }}
      onOpenChangeComplete={presentation.onOpenChangeComplete}
    >
      <Dialog size="base" className="p-0">
        <div className="grid gap-4 p-6">
          <Dialog.Title className="sr-only">Add collection</Dialog.Title>
          <div className="grid gap-1.5">
            <Text as="span" size="sm" bold>Collection name</Text>
            <div className="flex items-center gap-2">
              <IconPickerButton value={icon} onChange={setIcon} size={24} />
              <Input
                autoFocus
                aria-label="Collection name"
                value={name}
                placeholder="Engineering playbooks"
                onChange={(event) => {
                  setName(event.target.value);
                  setError(null);
                }}
                className="h-9! min-w-0 flex-1"
              />
            </div>
          </div>
          <Input
            label="Description"
            value={description}
            placeholder="What this collection contains"
            onChange={(event) => {
              setDescription(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void createCollection();
              }
            }}
          />
          {error && <Text variant="error" size="sm">{error}</Text>}
        </div>
        <div className="flex justify-end gap-2 border-t border-kumo-line px-6 py-3">
          <Button type="button" variant="secondary" disabled={creating} onClick={close}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={creating}
            onClick={() => void createCollection()}
          >
            Create collection
          </Button>
        </div>
      </Dialog>
    </Dialog.Root>
  );
};
