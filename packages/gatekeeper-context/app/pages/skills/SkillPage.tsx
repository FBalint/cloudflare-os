import {
  Button,
  Dialog,
  Empty,
  InputArea,
  LayerCard,
  SkeletonLine,
  Text,
  useKumoToastManager,
} from "@cloudflare/kumo";
import { cn } from "@cloudflare/kumo/utils";
import { CaretLeftIcon, FolderIcon, PathIcon, ScrollIcon } from "@phosphor-icons/react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { motion, useAnimate, useReducedMotion } from "motion/react";
import { parseDocument } from "yaml";
import type {
  ContextDocument,
  ContextDocumentSummary,
  EnabledCollectionInfo,
} from "../../../src/context-types";
import { joinFrontmatter, splitFrontmatter } from "../../../src/description-extractors";
import { parseSkillManifest, type SkillManifestMetadata } from "../../../src/skill-manifest";
import { DocumentEditor } from "../../ContextLibraryPage";
import { useContextApi, usePresentWhileOpen } from "../../bridge";
import { SkillDocumentContent } from "./SkillDocumentContent";
import { SkillFileNavigator } from "./SkillFileNavigator";
import { SkillPageTabs, skillPanelId, skillTabId } from "./SkillPageTabs";
import { formatSkillName, type SkillNavigatorSkill } from "./skillNavigatorModel";

const directoryName = (path: string): string => {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
};

const displayPath = (directory: string, path: string): string =>
  directory ? path.slice(directory.length + 1) : path;

const fileName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

const canonicalSkillName = (displayName: string): string =>
  displayName.trim().toLowerCase().replace(/[\s-]+/g, "-");

const updateManifestMetadata = (
  body: string,
  metadata: SkillManifestMetadata,
): string => {
  const { frontmatter, content } = splitFrontmatter(body);
  if (frontmatter === null) throw new Error("Skill manifest frontmatter is missing.");

  const document = parseDocument(frontmatter);
  if (document.errors.length > 0) throw new Error("Skill manifest frontmatter is invalid.");
  document.set("name", metadata.name);
  document.set("description", metadata.description);
  return joinFrontmatter(document.toString().trimEnd(), content);
};

const SkillPageLoading = () => (
  <div className="grid gap-4">
    <div className="grid gap-3 rounded-xl p-6 ring ring-kumo-hairline">
      <SkeletonLine blockHeight={20} minWidth={18} maxWidth={30} />
      <SkeletonLine blockHeight={16} minWidth={65} maxWidth={85} />
      <SkeletonLine blockHeight={16} minWidth={45} maxWidth={70} />
    </div>
    <div className="grid gap-3 rounded-xl p-6 ring ring-kumo-hairline">
      <SkeletonLine blockHeight={16} minWidth={20} maxWidth={35} />
      <SkeletonLine blockHeight={16} minWidth={70} maxWidth={95} />
      <SkeletonLine blockHeight={16} minWidth={55} maxWidth={90} />
    </div>
  </div>
);

export const SkillPage = ({
  collection,
  skill,
  onBack,
  onSkillChange,
}: {
  collection: EnabledCollectionInfo;
  skill: SkillNavigatorSkill;
  onBack: () => void;
  onSkillChange: (skill: SkillNavigatorSkill) => void;
}) => {
  const context = useContextApi();
  const toasts = useKumoToastManager();
  const directory = directoryName(skill.manifestPath);
  const [documents, setDocuments] = useState<ContextDocument[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [canEditDocuments, setCanEditDocuments] = useState<boolean | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [activeTab, setActiveTab] = useState("overview");
  const [previewDocument, setPreviewDocument] = useState<ContextDocument | null>(null);
  const [pendingDeletePath, setPendingDeletePath] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [nameInput, setNameInput] = useState(() => formatSkillName(skill.name));
  const [descriptionInput, setDescriptionInput] = useState(skill.description);
  const [metadataDirty, setMetadataDirty] = useState(false);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [savedManifestBody, setSavedManifestBody] = useState<string | null>(null);
  const manifestBodyRef = useRef<string | null>(null);
  const metadataRevisionRef = useRef(0);
  const nameEditedRef = useRef(false);
  const [titleScope, animateTitle] = useAnimate();
  const reduceMotion = useReducedMotion();
  const deletePresentation = usePresentWhileOpen(pendingDeletePath !== null);

  const revealCanonicalName = useEffectEvent(async (name: string) => {
    const displayName = formatSkillName(name);
    if (displayName === nameInput) return;
    if (reduceMotion) {
      setNameInput(displayName);
      return;
    }

    try {
      await animateTitle(
        titleScope.current,
        { opacity: 0.3 },
        { duration: 0.1, ease: "easeOut" },
      );
      setNameInput(displayName);
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      await animateTitle(
        titleScope.current,
        { opacity: 1 },
        { duration: 0.16, ease: "easeOut" },
      );
    } catch {
      setNameInput(displayName);
      if (titleScope.current) titleScope.current.style.opacity = "1";
    }
  });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [summaries, metadata, canWrite]: [
          ContextDocumentSummary[],
          Awaited<ReturnType<typeof context.getContextCollectionMetadata>>,
          boolean,
        ] = await Promise.all([
          context.listContextDocuments(collection.id, directory ? `${directory}/` : undefined),
          context.getContextCollectionMetadata(collection.id),
          context.canWriteContextCollection(collection.id),
        ]);
        const loaded: (ContextDocument | null)[] = await Promise.all(
          summaries.map((summary) => context.getContextDocument(collection.id, summary.path)),
        );
        if (cancelled) return;

        setCanEditDocuments(canWrite && metadata?.content.source !== "git");
        setDocuments(
          loaded
            .filter((document): document is ContextDocument => document !== null)
            .toSorted((left, right) => {
              if (left.path === skill.manifestPath) return -1;
              if (right.path === skill.manifestPath) return 1;
              return left.path.localeCompare(right.path);
            }),
        );
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [collection.id, context, directory, reloadVersion, skill.manifestPath]);

  const readyDocuments = documents ?? [];
  const hasMultipleFiles = readyDocuments.length > 1;
  const manifest = readyDocuments.find((document) => document.path === skill.manifestPath);

  useEffect(() => {
    if (!manifest || metadataDirty) return;
    manifestBodyRef.current = manifest.body;
    try {
      const metadata = parseSkillManifest(manifest.path, manifest.body);
      setNameInput(formatSkillName(metadata.name));
      setDescriptionInput(metadata.description);
    } catch {
      // The load error state handles manifests that stop being valid skills.
    }
  }, [manifest, metadataDirty]);

  useEffect(() => {
    if (!metadataDirty || !manifest || !canEditDocuments) return;

    const name = canonicalSkillName(nameInput);
    const description = descriptionInput.trim();
    const nameError = !name
      ? "Skill name is required."
      : name.length > 64
        ? "Skill name must be at most 64 characters."
        : !directoryName(manifest.path) && name !== manifest.skillName
          ? "Root-level skills cannot be renamed."
        : null;
    const descriptionError = !description
      ? "Skill description is required."
      : description.length > 1024
        ? "Skill description must be at most 1024 characters."
        : null;
    const error = nameError ?? descriptionError;
    setMetadataError(error);
    if (error) return;

    const timer = window.setTimeout(() => {
      const save = async () => {
        const saveRevision = metadataRevisionRef.current;
        const nameWasEdited = nameEditedRef.current;
        const currentBody = manifestBodyRef.current ?? manifest.body;
        const nextMetadata = { name, description };
        const nextBody = updateManifestMetadata(currentBody, nextMetadata);
        const oldDirectory = directoryName(manifest.path);
        const parentDirectory = directoryName(oldDirectory);
        const nextDirectory = parentDirectory ? `${parentDirectory}/${name}` : name;
        let nextManifestPath = manifest.path;
        let movedDirectory = false;

        try {
          if (oldDirectory && oldDirectory !== nextDirectory) {
            await context.moveContextDocument(collection.id, oldDirectory, nextDirectory);
            nextManifestPath = `${nextDirectory}/SKILL.md`;
            movedDirectory = true;
          }
          await context.putContextDocument(collection.id, nextManifestPath, {
            body: nextBody,
            contentType: manifest.contentType,
            description,
          });
          manifestBodyRef.current = nextBody;
          if (nameWasEdited) await revealCanonicalName(name);
          if (metadataRevisionRef.current === saveRevision) {
            nameEditedRef.current = false;
            setMetadataDirty(false);
          }
          setMetadataError(null);
          setSavedManifestBody(nextBody);
          setDocuments((current) => current?.map((document) => {
            const path = movedDirectory &&
              (document.path === oldDirectory || document.path.startsWith(`${oldDirectory}/`))
              ? nextDirectory + document.path.slice(oldDirectory.length)
              : document.path;
            return document.path === manifest.path
              ? {
                  ...document,
                  path,
                  name: fileName(path),
                  body: nextBody,
                  description,
                  skillName: name,
                }
              : { ...document, path, name: fileName(path) };
          }) ?? null);
          setPreviewDocument((current) => {
            if (!current || !oldDirectory || oldDirectory === nextDirectory) return current;
            if (current.path !== oldDirectory && !current.path.startsWith(`${oldDirectory}/`)) {
              return current;
            }
            const path = nextDirectory + current.path.slice(oldDirectory.length);
            return { ...current, path, name: fileName(path) };
          });
          onSkillChange({
            manifestPath: nextManifestPath,
            name,
            description,
          });
          setReloadVersion((version) => version + 1);
        } catch {
          if (movedDirectory) {
            try {
              await context.moveContextDocument(collection.id, nextDirectory, oldDirectory);
            } catch {
              // The reload below reflects the server's actual state if rollback also fails.
            }
          }
          setMetadataError("Changes could not be saved.");
          toasts.add({ title: "Failed to update skill", variant: "error" });
          setReloadVersion((version) => version + 1);
        }
      };

      void save();
    }, 600);

    return () => window.clearTimeout(timer);
  }, [
    canEditDocuments,
    collection.id,
    context,
    descriptionInput,
    manifest,
    metadataDirty,
    nameInput,
    onSkillChange,
    toasts,
  ]);

  useEffect(() => {
    if (!dirty) return;
    const preventUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [dirty]);

  const renderEditor = (document: ContextDocument) => (
    <LayerCard className="h-[70vh] min-h-96 overflow-hidden bg-white">
      <DocumentEditor
        key={displayPath(directory, document.path)}
        collectionId={collection.id}
        path={document.path}
        readOnly={!canEditDocuments}
        embedded
        externalBody={document.path === skill.manifestPath ? savedManifestBody ?? undefined : undefined}
        hideDescription
        hideFilename
        preserveModeOnPathChange
        onDirtyChange={setDirty}
        onBodyChange={(body) => {
          if (document.path !== skill.manifestPath) return;
          manifestBodyRef.current = body;
          try {
            const metadata = parseSkillManifest(document.path, body);
            setNameInput(formatSkillName(metadata.name));
            setDescriptionInput(metadata.description);
          } catch {
            // Keep the last valid metadata while the user is midway through an edit.
          }
        }}
        onChanged={() => setReloadVersion((version) => version + 1)}
        onRenamed={(newPath) => {
          setPreviewDocument({
            ...document,
            path: newPath,
            name: fileName(newPath),
          });
          setReloadVersion((version) => version + 1);
        }}
        onRequestDelete={() => setPendingDeletePath(document.path)}
      />
    </LayerCard>
  );

  const deleteDocument = async () => {
    if (!pendingDeletePath) return;
    setDeleting(true);
    try {
      await context.deleteContextDocument(collection.id, pendingDeletePath);
      toasts.add({ title: "Document deleted", variant: "success" });
      const deletedManifest = pendingDeletePath === skill.manifestPath;
      setPendingDeletePath(null);
      setPreviewDocument(null);
      if (deletedManifest) {
        onBack();
      } else {
        setActiveTab("files");
        setReloadVersion((version) => version + 1);
      }
    } catch {
      toasts.add({ title: "Failed to delete document", variant: "error" });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <Dialog.Root
        open={pendingDeletePath !== null && deletePresentation.presenting}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDeletePath(null);
        }}
        onOpenChangeComplete={deletePresentation.onOpenChangeComplete}
      >
        <Dialog size="sm" className="p-0">
          <div className="p-6">
            <Dialog.Title>Delete document</Dialog.Title>
            <Dialog.Description>
              Permanently delete {pendingDeletePath ? fileName(pendingDeletePath) : "this document"}?
              This cannot be undone.
            </Dialog.Description>
          </div>
          <div className="flex justify-end gap-2 border-t border-kumo-line px-6 py-3">
            <Button variant="secondary" disabled={deleting} onClick={() => setPendingDeletePath(null)}>
              Cancel
            </Button>
            <Button variant="destructive" loading={deleting} onClick={deleteDocument}>
              Delete document
            </Button>
          </div>
        </Dialog>
      </Dialog.Root>
      <main className="mx-auto w-full max-w-5xl px-5 pb-12 pt-8 sm:px-10 sm:pt-10">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="mb-5 -ml-2 text-kumo-subtle hover:text-kumo-default"
        >
          <CaretLeftIcon aria-hidden="true" size={12} />
          Back to Skills
        </Button>

        <header className="mb-8">
          <div className="flex min-w-0 items-center gap-3">
            <ScrollIcon aria-hidden="true" size={28} className="shrink-0 text-kumo-default" />
            <motion.div
              ref={titleScope}
              role="heading"
              aria-level={1}
              className="flex min-w-0 flex-1 items-center"
            >
              <InputArea
                aria-label="Skill name"
                value={nameInput}
                readOnly={!canEditDocuments}
                tabIndex={canEditDocuments ? undefined : -1}
                rows={1}
                maxLength={64}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.preventDefault();
                }}
                onValueChange={(value) => {
                  if (!canEditDocuments || !/^[A-Za-z0-9 -]*$/.test(value)) return;
                  setNameInput(value.replace(/[\r\n]/g, ""));
                  nameEditedRef.current = true;
                  metadataRevisionRef.current += 1;
                  setMetadataDirty(true);
                }}
                className={cn(
                  "-mx-2 h-auto! min-h-0! min-w-0 resize-none overflow-hidden border-transparent! bg-transparent! px-2 py-0 text-lg font-semibold leading-7 shadow-none! outline-none! ring-0! [field-sizing:content]",
                  canEditDocuments && "transition-colors hover:bg-kumo-recessed! focus-visible:ring-0!",
                )}
              />
            </motion.div>
          </div>
          <InputArea
            aria-label="Skill description"
            value={descriptionInput}
            readOnly={!canEditDocuments}
            tabIndex={canEditDocuments ? undefined : -1}
            maxLength={1024}
            onValueChange={(value) => {
              if (!canEditDocuments) return;
              setDescriptionInput(value);
              metadataRevisionRef.current += 1;
              setMetadataDirty(true);
            }}
            className={cn(
              "-mx-2 mt-2 h-auto! min-h-0! max-w-3xl resize-none border-transparent! bg-transparent! px-2 py-0 text-sm leading-5 text-kumo-subtle shadow-none! outline-none! ring-0! [field-sizing:content]",
              canEditDocuments && "transition-colors hover:bg-kumo-recessed! focus-visible:ring-0!",
            )}
          />
          {metadataError && (
            <Text variant="error" size="xs" DANGEROUS_className="mt-1">
              {metadataError}
            </Text>
          )}
        </header>

        <dl className="mb-10 grid max-w-2xl grid-cols-[auto_minmax(0,1fr)] gap-x-8 gap-y-4 text-sm">
          <Text as="dt" variant="secondary" size="sm">Collection</Text>
          <dd className="flex min-w-0 items-center gap-2">
            <FolderIcon aria-hidden="true" size={16} className="shrink-0 text-kumo-subtle" />
            <Text size="sm" truncate>{collection.title}</Text>
          </dd>
          <Text as="dt" variant="secondary" size="sm">Path</Text>
          <dd className="flex min-w-0 items-center gap-2">
            <PathIcon aria-hidden="true" size={16} className="shrink-0 text-kumo-subtle" />
            <Text variant="mono" truncate>{directory || "/"}</Text>
          </dd>
        </dl>

        {hasMultipleFiles && (
          <div className="mb-5">
            <SkillPageTabs
              value={activeTab}
              onValueChange={(value) => {
                setActiveTab(value);
              }}
              tabs={[
                { value: "overview", label: "Overview" },
                { value: "files", label: "Files", badge: readyDocuments.length },
                ...(previewDocument
                  ? [{
                      value: "preview",
                      label: displayPath(directory, previewDocument.path),
                      closable: true,
                    }]
                  : []),
              ]}
              onClose={() => {
                setPreviewDocument(null);
                if (activeTab === "preview") setActiveTab("files");
              }}
            />
          </div>
        )}

        <div
          {...(hasMultipleFiles
            ? {
                role: "tabpanel",
                id: skillPanelId(activeTab),
                "aria-labelledby": skillTabId(activeTab),
                tabIndex: 0,
              }
            : {})}
        >
          {documents === null && !loadFailed ? (
            <SkillPageLoading />
          ) : loadFailed ? (
            <Empty
              icon={<ScrollIcon size={48} className="text-kumo-inactive" />}
              title="Skill could not be loaded"
              description="Return to Skills and try again."
            />
          ) : readyDocuments.length === 0 ? (
            <Empty
              icon={<ScrollIcon size={48} className="text-kumo-inactive" />}
              title="Skill files are unavailable"
              description="The files may have moved since the skill list was loaded."
            />
          ) : !hasMultipleFiles ? (
            renderEditor(readyDocuments[0])
          ) : activeTab === "overview" ? (
            <div className="grid gap-5">
              {readyDocuments.map((document) => (
                <SkillDocumentContent
                  key={document.path}
                  collectionId={collection.id}
                  document={document}
                  displayPath={displayPath(directory, document.path)}
                  onOpenFile={() => {
                    setPreviewDocument(document);
                    setActiveTab("preview");
                  }}
                />
              ))}
            </div>
          ) : activeTab === "files" ? (
            <SkillFileNavigator
              documents={readyDocuments}
              rootDirectory={directory}
              activePath={previewDocument?.path ?? null}
              onOpenFile={(path) => {
                const document = readyDocuments.find((candidate) => candidate.path === path);
                if (!document) return;
                setPreviewDocument(document);
                setActiveTab("preview");
              }}
            />
          ) : previewDocument ? (
            renderEditor(previewDocument)
          ) : null}
        </div>
      </main>
    </div>
  );
};
