import {
  Button,
  Dialog,
  DropdownMenu,
  Empty,
  InputGroup,
  SkeletonLine,
  Text,
  useKumoToastManager,
} from "@cloudflare/kumo";
import {
  BookOpenIcon,
  FolderPlusIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  ScrollIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { ContextDocumentSummary, EnabledCollectionInfo } from "../../../src/context-types";
import { useContextApi, usePresentWhileOpen } from "../../bridge";
import { AddCollectionDialog } from "./AddCollectionDialog";
import { AddSkillDialog } from "./AddSkillDialog";
import { SkillCollectionTree } from "./SkillCollectionTree";
import { SkillPage } from "./SkillPage";
import {
  buildSkillNavigatorRoot,
  filterSkillNavigatorRoot,
  formatSkillName,
  type SkillNavigatorRoot,
  type SkillNavigatorSkill,
} from "./skillNavigatorModel";

const runWithConcurrency = async <T,>(
  items: T[],
  limit: number,
  operation: (item: T) => Promise<void>,
): Promise<void> => {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await operation(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
};

type PendingDelete =
  | { kind: "skill"; root: SkillNavigatorRoot; skill: SkillNavigatorSkill }
  | { kind: "collection"; root: SkillNavigatorRoot };

const SkillsNavigatorPage = () => {
  const context = useContextApi();
  const toasts = useKumoToastManager();
  const [roots, setRoots] = useState<SkillNavigatorRoot[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addSkillCollectionId, setAddSkillCollectionId] = useState<string | null>(null);
  const [addCollectionOpen, setAddCollectionOpen] = useState(false);
  const [editableCollectionIds, setEditableCollectionIds] = useState<Set<string>>(new Set());
  const [writableCollectionIds, setWritableCollectionIds] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<{
    root: SkillNavigatorRoot;
    skill: SkillNavigatorRoot["contents"]["skills"][number];
    initialEdit?: boolean;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const collections: EnabledCollectionInfo[] =
          await context.listEnabledContextCollections();
        const [documents, access]: [
          ContextDocumentSummary[][],
          { writable: boolean; editable: boolean }[],
        ] = await Promise.all([
          Promise.all(
            collections.map((collection) => context.listContextDocuments(collection.id)),
          ),
          Promise.all(collections.map(async (collection) => {
            try {
              const [canWrite, metadata] = await Promise.all([
                context.canWriteContextCollection(collection.id),
                context.getContextCollectionMetadata(collection.id),
              ]);
              return {
                writable: canWrite,
                editable: canWrite && metadata?.content.source === "web",
              };
            } catch {
              return { writable: false, editable: false };
            }
          })),
        ]);
        if (cancelled) return;

        setEditableCollectionIds(new Set(
          collections.filter((_, index) => access[index].editable).map((collection) => collection.id),
        ));
        setWritableCollectionIds(new Set(
          collections.filter((_, index) => access[index].writable).map((collection) => collection.id),
        ));
        setRoots(
          collections
            .map((collection, index) => buildSkillNavigatorRoot(collection, documents[index]))
            .toSorted((left, right) => left.collection.title.localeCompare(right.collection.title)),
        );
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [context]);

  const visibleRoots =
    roots?.flatMap((root) => {
      const filtered = filterSkillNavigatorRoot(root, search);
      return filtered ? [filtered] : [];
    }) ?? [];
  const editableRoots = roots?.filter((root) => editableCollectionIds.has(root.collection.id)) ?? [];
  const deletePresentation = usePresentWhileOpen(pendingDelete !== null);

  const deleteItem = async () => {
    if (!pendingDelete) return;
    const { root } = pendingDelete;
    setDeleting(true);
    try {
      if (pendingDelete.kind === "collection") {
        await context.deleteContextCollection(root.collection.id);
        setRoots((current) => current?.filter((candidate) =>
          candidate.collection.id !== root.collection.id
        ) ?? current);
        setEditableCollectionIds((current) => {
          const next = new Set(current);
          next.delete(root.collection.id);
          return next;
        });
        setWritableCollectionIds((current) => {
          const next = new Set(current);
          next.delete(root.collection.id);
          return next;
        });
        setPendingDelete(null);
        toasts.add({ title: "Collection deleted", variant: "success" });
        return;
      }

      const { skill } = pendingDelete;
      const slashIndex = skill.manifestPath.lastIndexOf("/");
      const directory = slashIndex < 0 ? "" : skill.manifestPath.slice(0, slashIndex);
      const documents: ContextDocumentSummary[] =
        await context.listContextDocuments(root.collection.id);
      const paths = directory
        ? documents
            .map((document) => document.path)
            .filter((path) => path.startsWith(`${directory}/`))
        : [skill.manifestPath];
      await runWithConcurrency(paths, 6, (path) =>
        context.deleteContextDocument(root.collection.id, path)
      );
      const remainingDocuments = await context.listContextDocuments(root.collection.id);
      const nextRoot = buildSkillNavigatorRoot(root.collection, remainingDocuments);
      setRoots((current) => current?.map((candidate) =>
        candidate.collection.id === nextRoot.collection.id ? nextRoot : candidate
      ) ?? current);
      setPendingDelete(null);
      toasts.add({ title: "Skill deleted", variant: "success" });
    } catch {
      toasts.add({
        title: pendingDelete.kind === "collection"
          ? "Failed to delete collection"
          : "Failed to delete skill",
        variant: "error",
      });
    } finally {
      setDeleting(false);
    }
  };

  if (selectedSkill) {
    return (
      <SkillPage
        collection={selectedSkill.root.collection}
        skill={selectedSkill.skill}
        initialEdit={selectedSkill.initialEdit}
        onBack={() => setSelectedSkill(null)}
        onDeleted={(root) => {
          setRoots((current) => current?.map((candidate) =>
            candidate.collection.id === root.collection.id ? root : candidate
          ) ?? current);
          setSelectedSkill(null);
        }}
        onSkillChange={(skill) => {
          setSelectedSkill((current) => current ? { ...current, skill } : null);
        }}
      />
    );
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col px-5 sm:px-10">
      <AddSkillDialog
        key={addSkillCollectionId ?? "default"}
        open={addOpen}
        roots={editableRoots}
        initialCollectionId={addSkillCollectionId ?? undefined}
        onOpenChange={setAddOpen}
        onCreated={(root, skill) => {
          setRoots((current) => current?.map((candidate) =>
            candidate.collection.id === root.collection.id ? root : candidate
          ) ?? current);
          setSearch("");
          setSelectedSkill({ root, skill, initialEdit: true });
        }}
      />
      <AddCollectionDialog
        open={addCollectionOpen}
        onOpenChange={setAddCollectionOpen}
        onCreated={(collection) => {
          setRoots((current) => [
            ...(current ?? []),
            buildSkillNavigatorRoot(collection, []),
          ].toSorted((left, right) =>
            left.collection.title.localeCompare(right.collection.title)
          ));
          setEditableCollectionIds((current) => new Set(current).add(collection.id));
          setWritableCollectionIds((current) => new Set(current).add(collection.id));
          toasts.add({ title: "Collection created", variant: "success" });
        }}
      />
      <Dialog.Root
        open={pendingDelete !== null && deletePresentation.presenting}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null);
        }}
        onOpenChangeComplete={deletePresentation.onOpenChangeComplete}
      >
        <Dialog size="sm" className="p-0">
          <div className="p-6">
            <Dialog.Title>Delete {pendingDelete?.kind ?? "item"}</Dialog.Title>
            <Dialog.Description>
              Permanently delete {pendingDelete
                ? pendingDelete.kind === "collection"
                  ? pendingDelete.root.collection.title
                  : formatSkillName(pendingDelete.skill.name)
                : "this item"} and all of its files? This cannot be undone.
            </Dialog.Description>
          </div>
          <div className="flex justify-end gap-2 border-t border-kumo-line px-6 py-3">
            <Button
              type="button"
              variant="secondary"
              disabled={deleting}
              onClick={() => setPendingDelete(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              loading={deleting}
              onClick={() => void deleteItem()}
            >
              Delete {pendingDelete?.kind ?? "item"}
            </Button>
          </div>
        </Dialog>
      </Dialog.Root>
      <header className="shrink-0 px-1 pb-5 pt-8 sm:pt-10">
        <Text as="h1" variant="heading" size="lg">Skills</Text>
        <Text variant="secondary" size="sm" DANGEROUS_className="mt-1">
          Collections of skills your agents can use.
        </Text>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="flex shrink-0 items-center gap-2">
          <InputGroup size="base" className="min-w-0 flex-1">
            <InputGroup.Addon>
              <MagnifyingGlassIcon size={16} aria-hidden />
            </InputGroup.Addon>
            <InputGroup.Input
              type="search"
              className="text-sm"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search skills and collections..."
              aria-label="Search skills and collections"
            />
          </InputGroup>
          <DropdownMenu>
            <DropdownMenu.Trigger
              render={
                <Button
                  type="button"
                  variant="primary"
                  disabled={roots === null}
                  icon={PlusIcon}
                >
                  Add
                </Button>
              }
            />
            <DropdownMenu.Content align="end">
              <DropdownMenu.Item
                icon={ScrollIcon}
                disabled={editableRoots.length === 0}
                onClick={() => {
                  setAddSkillCollectionId(null);
                  setAddOpen(true);
                }}
              >
                Add skill
              </DropdownMenu.Item>
              <DropdownMenu.Item
                icon={FolderPlusIcon}
                onClick={() => setAddCollectionOpen(true)}
              >
                Add collection
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-px pt-px pb-8">
          {roots === null && !loadFailed ? (
            <div className="grid gap-4 rounded-xl p-4 ring ring-kumo-hairline">
              <SkeletonLine blockHeight={24} minWidth={35} maxWidth={55} />
              <SkeletonLine blockHeight={24} minWidth={55} maxWidth={80} />
              <SkeletonLine blockHeight={24} minWidth={45} maxWidth={70} />
            </div>
          ) : loadFailed ? (
            <EmptyState title="Skills could not be loaded" description="Try reopening this page." />
          ) : visibleRoots.length === 0 ? (
            <EmptyState
              title={search ? "No skills match" : "No skills yet"}
              description={
                search
                  ? "Try a different search term."
                  : "Valid skills with a SKILL.md manifest will appear here."
              }
            />
          ) : (
            <SkillCollectionTree
              roots={visibleRoots}
              searchActive={search.trim().length > 0}
              canDeleteSkill={(root) => editableCollectionIds.has(root.collection.id)}
              canDeleteCollection={(root) => writableCollectionIds.has(root.collection.id)}
              onSelectSkill={(root, skill) => setSelectedSkill({ root, skill })}
              onRequestDelete={(root, skill) => setPendingDelete({ kind: "skill", root, skill })}
              onRequestDeleteCollection={(root) => setPendingDelete({ kind: "collection", root })}
              onAddSkill={(root) => {
                setAddSkillCollectionId(root.collection.id);
                setAddOpen(true);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
};

const EmptyState = ({ title, description }: { title: string; description: string }) => (
  <Empty
    icon={<BookOpenIcon size={48} className="text-kumo-inactive" />}
    title={title}
    description={description}
  />
);

export default SkillsNavigatorPage;
