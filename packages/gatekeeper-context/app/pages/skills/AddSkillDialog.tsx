import { Button, Dialog, Input, Select, Text } from "@cloudflare/kumo";
import { stringify } from "yaml";
import { useState } from "react";
import { useContextApi, usePresentWhileOpen } from "../../bridge";
import {
  buildSkillNavigatorRoot,
  formatSkillName,
  type SkillNavigatorCollection,
  type SkillNavigatorRoot,
  type SkillNavigatorSkill,
} from "./skillNavigatorModel";

const canonicalSkillName = (value: string): string =>
  value.trim().toLowerCase().replace(/[\s-]+/g, "-");

const findSkill = (
  collection: SkillNavigatorCollection,
  manifestPath: string,
): SkillNavigatorSkill | null => {
  const skill = collection.skills.find((candidate) => candidate.manifestPath === manifestPath);
  if (skill) return skill;
  for (const child of collection.collections) {
    const match = findSkill(child, manifestPath);
    if (match) return match;
  }
  return null;
};

export const AddSkillDialog = ({ open, roots, initialCollectionId, onOpenChange, onCreated }: {
  open: boolean;
  roots: SkillNavigatorRoot[];
  initialCollectionId?: string;
  onOpenChange: (open: boolean) => void;
  onCreated: (root: SkillNavigatorRoot, skill: SkillNavigatorSkill) => void;
}) => {
  const context = useContextApi();
  const presentation = usePresentWhileOpen(open);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [collectionId, setCollectionId] = useState(
    initialCollectionId ?? roots[0]?.collection.id ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const selectedCollectionId = collectionId || roots[0]?.collection.id || "";

  const reset = () => {
    setName("");
    setDescription("");
    setCollectionId(initialCollectionId ?? roots[0]?.collection.id ?? "");
    setError(null);
  };

  const close = () => {
    if (creating) return;
    reset();
    onOpenChange(false);
  };

  const createSkill = async () => {
    const root = roots.find((candidate) => candidate.collection.id === selectedCollectionId);
    const skillName = canonicalSkillName(name);
    const skillDescription = description.trim();
    if (!root) {
      setError("Choose a collection.");
      return;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skillName) || skillName.length > 64) {
      setError("Use letters, numbers, spaces, or single hyphens, up to 64 characters.");
      return;
    }
    if (!skillDescription || skillDescription.length > 1024) {
      setError("Enter a description of up to 1024 characters.");
      return;
    }

    const manifestPath = `${skillName}/SKILL.md`;
    setCreating(true);
    setError(null);
    try {
      const existing = await context.getContextDocument(root.collection.id, manifestPath);
      if (existing) {
        setError("A skill with this name already exists in the collection.");
        return;
      }

      const frontmatter = stringify({ name: skillName, description: skillDescription }).trimEnd();
      await context.putContextDocument(root.collection.id, manifestPath, {
        body: `---\n${frontmatter}\n---\n\n# ${formatSkillName(skillName)}\n`,
        contentType: "text/markdown",
        description: skillDescription,
      });

      const documents = await context.listContextDocuments(root.collection.id);
      const nextRoot = buildSkillNavigatorRoot(root.collection, documents);
      const skill = findSkill(nextRoot.contents, manifestPath);
      if (!skill) throw new Error("The new skill could not be loaded.");
      reset();
      onOpenChange(false);
      onCreated(nextRoot, skill);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The skill could not be created.");
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
          <Dialog.Title className="sr-only">Add skill</Dialog.Title>
          <Input
            autoFocus
            label="Skill name"
            value={name}
            maxLength={64}
            placeholder="Incident response"
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
          />
          <Input
            label="Description"
            value={description}
            maxLength={1024}
            placeholder="When agents should use this skill"
            onChange={(event) => {
              setDescription(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void createSkill();
              }
            }}
          />
          <div className="grid gap-1.5">
            <Text as="span" size="sm" bold>Collection</Text>
            <Select
              aria-label="Collection"
              value={selectedCollectionId}
              onValueChange={(value) => setCollectionId(value ?? "")}
              renderValue={(id) => roots.find((root) => root.collection.id === id)?.collection.title ?? id}
            >
              {roots.map((root) => (
                <Select.Option key={root.collection.id} value={root.collection.id}>
                  {root.collection.title}
                </Select.Option>
              ))}
            </Select>
          </div>
          {error && <Text variant="error" size="sm">{error}</Text>}
        </div>
        <div className="flex justify-end gap-2 border-t border-kumo-line px-6 py-3">
          <Button type="button" variant="secondary" disabled={creating} onClick={close}>
            Cancel
          </Button>
          <Button type="button" variant="primary" loading={creating} onClick={() => void createSkill()}>
            Create skill
          </Button>
        </div>
      </Dialog>
    </Dialog.Root>
  );
};
