import {
  Button,
  Dialog,
  DropdownMenu,
  Empty,
  Input,
  InputArea,
  LayerCard,
  SkeletonLine,
  Text,
  useKumoToastManager,
} from "@cloudflare/kumo";
import { cn } from "@cloudflare/kumo/utils";
import {
  CaretLeftIcon,
  FilePlusIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  PathIcon,
  PlusIcon,
  ScrollIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { motion, useAnimate, useReducedMotion } from "motion/react";
import { parseDocument } from "yaml";
import type {
  ContextDocument,
  ContextDocumentSummary,
  EnabledCollectionInfo,
} from "../../../src/context-types";
import { contentTypeFromPath, isTextContentType } from "../../../src/context-types";
import {
  extractDescription,
  joinFrontmatter,
  splitFrontmatter,
} from "../../../src/description-extractors";
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

const joinPath = (...parts: string[]): string => parts.filter(Boolean).join("/");

const replacePathPrefix = (path: string, from: string, to: string): string =>
  path === from ? to : path.startsWith(`${from}/`) ? to + path.slice(from.length) : path;

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    });
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });

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
  const [editOnOpenPath, setEditOnOpenPath] = useState<string | null>(null);
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef("");
  const uploadDragDepthRef = useRef(0);
  const [uploading, setUploading] = useState(false);
  const [uploadDragActive, setUploadDragActive] = useState(false);
  const [pendingFolders, setPendingFolders] = useState<Set<string>>(new Set());
  const [createKind, setCreateKind] = useState<"file" | "folder" | null>(null);
  const [createName, setCreateName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [titleScope, animateTitle] = useAnimate();
  const reduceMotion = useReducedMotion();
  const deletePresentation = usePresentWhileOpen(pendingDeletePath !== null);
  const createPresentation = usePresentWhileOpen(createKind !== null);

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
    if (!manifest || metadataDirty || dirty) return;
    manifestBodyRef.current = manifest.body;
    try {
      const metadata = parseSkillManifest(manifest.path, manifest.body);
      setNameInput(formatSkillName(metadata.name));
      setDescriptionInput(metadata.description);
    } catch {
      // The load error state handles manifests that stop being valid skills.
    }
  }, [dirty, manifest, metadataDirty]);

  useEffect(() => {
    if (!metadataDirty || !manifest || !canEditDocuments || dirty) return;

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
    dirty,
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
        canDelete={document.path !== skill.manifestPath}
        initialMode={editOnOpenPath === document.path ? "edit" : "read"}
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

  const uploadFiles = async (files: FileList | File[], targetDirectory = "") => {
    const selectedFiles = Array.from(files);
    if (selectedFiles.length === 0 || !canEditDocuments) return;
    if (dirty) {
      toasts.add({ title: "Save the current file before uploading", variant: "error" });
      return;
    }

    setUploading(true);
    let uploaded = 0;
    let skipped = 0;
    let failed = 0;
    const occupiedPaths = new Set(readyDocuments.map((document) => document.path));
    try {
      await runWithConcurrency(selectedFiles, 6, async (file) => {
        const relativeFilePath = file.webkitRelativePath || file.name;
        const path = joinPath(directory, targetDirectory, relativeFilePath);
        if (occupiedPaths.has(path) || path === skill.manifestPath) {
          skipped += 1;
          return;
        }
        occupiedPaths.add(path);
        const contentType = contentTypeFromPath(path);
        try {
          const body = isTextContentType(contentType) ? await file.text() : await fileToBase64(file);
          await context.putContextDocument(collection.id, path, {
            body,
            contentType,
            description: extractDescription(contentType, body) ?? "",
          });
          uploaded += 1;
        } catch {
          failed += 1;
        }
      });

      if (readyDocuments.length === 1) {
        setPreviewDocument(readyDocuments[0]);
        setActiveTab("preview");
      }
      toasts.add({
        title: [
          `Uploaded ${uploaded} file${uploaded === 1 ? "" : "s"}`,
          skipped ? `${skipped} skipped` : "",
          failed ? `${failed} failed` : "",
        ].filter(Boolean).join(", "),
        variant: failed ? "error" : "success",
      });
      setReloadVersion((version) => version + 1);
    } finally {
      setUploading(false);
    }
  };

  const requestUpload = (targetDirectory: string, kind: "files" | "folder") => {
    if (dirty) return;
    uploadTargetRef.current = targetDirectory;
    (kind === "files" ? fileInputRef : folderInputRef).current?.click();
  };

  const openCreate = (kind: "file" | "folder") => {
    if (dirty) return;
    setCreateName("");
    setCreateError(null);
    setCreateKind(kind);
  };

  const createItem = async () => {
    if (!createKind || !canEditDocuments) return;
    const name = createName.trim();
    if (!name || name === "." || name === ".." || name.includes("/")) {
      setCreateError(`Enter a valid ${createKind} name without slashes.`);
      return;
    }

    if (createKind === "folder") {
      const exists = pendingFolders.has(name) || readyDocuments.some(
        (document) => {
          const path = displayPath(directory, document.path);
          return path === name || path.startsWith(`${name}/`);
        },
      );
      if (exists) {
        setCreateError("A folder with this name already exists.");
        return;
      }
      setPendingFolders((current) => new Set(current).add(name));
      setCreateKind(null);
      setActiveTab("files");
      return;
    }

    const filename = name.includes(".") ? name : `${name}.md`;
    const path = joinPath(directory, filename);
    if (
      readyDocuments.some((document) => document.path === path) ||
      pendingFolders.has(filename)
    ) {
      setCreateError("A file with this name already exists.");
      return;
    }

    setCreating(true);
    try {
      const contentType = contentTypeFromPath(path);
      await context.putContextDocument(collection.id, path, {
        body: "",
        contentType,
        description: "",
      });
      const document = await context.getContextDocument(collection.id, path);
      if (!document) throw new Error("Created file could not be loaded.");
      setPreviewDocument(document);
      setEditOnOpenPath(path);
      setActiveTab("preview");
      setCreateKind(null);
      setReloadVersion((version) => version + 1);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "File could not be created.");
    } finally {
      setCreating(false);
    }
  };

  const movePath = async (fromPath: string, targetDirectory: string) => {
    const currentDirectory = directoryName(fromPath);
    if (
      currentDirectory === targetDirectory ||
      targetDirectory === fromPath ||
      targetDirectory.startsWith(`${fromPath}/`)
    ) return;

    const destinationPath = joinPath(targetDirectory, fileName(fromPath));
    const absoluteFromPath = joinPath(directory, fromPath);
    const absoluteDestinationPath = joinPath(directory, destinationPath);
    try {
      await context.moveContextDocument(collection.id, absoluteFromPath, absoluteDestinationPath);
      setPreviewDocument((current) => {
        if (!current ||
          (current.path !== absoluteFromPath && !current.path.startsWith(`${absoluteFromPath}/`))) {
          return current;
        }
        const path = absoluteDestinationPath + current.path.slice(absoluteFromPath.length);
        return { ...current, path, name: fileName(path) };
      });
      setPendingFolders((current) => new Set(
        [...current].map((path) => replacePathPrefix(path, fromPath, destinationPath)),
      ));
      setReloadVersion((version) => version + 1);
    } catch (error) {
      toasts.add({
        title: `Failed to move item: ${error instanceof Error ? error.message : "Unknown error"}`,
        variant: "error",
      });
    }
  };

  const renamePath = async (path: string, nextName: string): Promise<boolean> => {
    const name = nextName.trim();
    if (!name || name === "." || name === ".." || name.includes("/")) {
      toasts.add({ title: "Enter a valid name without slashes", variant: "error" });
      return false;
    }

    const destinationPath = joinPath(directoryName(path), name);
    if (destinationPath === path) return true;
    const hasPersistedContent = readyDocuments.some((document) => {
      const relativeDocumentPath = displayPath(directory, document.path);
      return relativeDocumentPath === path || relativeDocumentPath.startsWith(`${path}/`);
    });

    if (!hasPersistedContent && pendingFolders.has(path)) {
      setPendingFolders((current) => new Set(
        [...current].map((folder) => replacePathPrefix(folder, path, destinationPath)),
      ));
      return true;
    }

    const absolutePath = joinPath(directory, path);
    const absoluteDestinationPath = joinPath(directory, destinationPath);
    try {
      await context.moveContextDocument(collection.id, absolutePath, absoluteDestinationPath);
      setPreviewDocument((current) => {
        if (!current ||
          (current.path !== absolutePath && !current.path.startsWith(`${absolutePath}/`))) {
          return current;
        }
        const nextPath = replacePathPrefix(current.path, absolutePath, absoluteDestinationPath);
        return { ...current, path: nextPath, name: fileName(nextPath) };
      });
      setPendingFolders((current) => new Set(
        [...current].map((folder) => replacePathPrefix(folder, path, destinationPath)),
      ));
      setReloadVersion((version) => version + 1);
      return true;
    } catch (error) {
      toasts.add({
        title: `Failed to rename item: ${error instanceof Error ? error.message : "Unknown error"}`,
        variant: "error",
      });
      return false;
    }
  };

  const uploadMenu = (
    <DropdownMenu>
      <DropdownMenu.Trigger
        render={
          <Button type="button" variant="ghost" size="base" disabled={uploading || dirty}>
            <PlusIcon aria-hidden="true" size={16} />
            Add new
          </Button>
        }
      />
      <DropdownMenu.Content
        align="end"
        className="z-[1100]!"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <DropdownMenu.Item
          icon={<FilePlusIcon aria-hidden="true" size={14} />}
          onClick={(event) => {
            event.stopPropagation();
            openCreate("file");
          }}
        >
          New file
        </DropdownMenu.Item>
        <DropdownMenu.Item
          icon={<FolderPlusIcon aria-hidden="true" size={14} />}
          onClick={(event) => {
            event.stopPropagation();
            openCreate("folder");
          }}
        >
          New folder
        </DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Item
          icon={<UploadSimpleIcon aria-hidden="true" size={14} />}
          onClick={(event) => {
            event.stopPropagation();
            requestUpload("", "files");
          }}
        >
          Upload files
        </DropdownMenu.Item>
        <DropdownMenu.Item
          icon={<FolderOpenIcon aria-hidden="true" size={14} />}
          onClick={(event) => {
            event.stopPropagation();
            requestUpload("", "folder");
          }}
        >
          Upload folder
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu>
  );

  const uploadDropArea = canEditDocuments && (
    <div
      onDragEnter={(event) => {
        if (dirty || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        uploadDragDepthRef.current += 1;
        setUploadDragActive(true);
      }}
      onDragOver={(event) => {
        if (!dirty && event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDragLeave={() => {
        uploadDragDepthRef.current = Math.max(0, uploadDragDepthRef.current - 1);
        if (uploadDragDepthRef.current === 0) setUploadDragActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        uploadDragDepthRef.current = 0;
        setUploadDragActive(false);
        if (!dirty) void uploadFiles(event.dataTransfer.files);
      }}
      className={cn(
        "rounded-xl border border-dashed border-kumo-line p-1",
        uploadDragActive && "bg-kumo-recessed",
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="base"
        disabled={uploading || dirty}
        onClick={() => openCreate("file")}
        className="h-28! w-full! flex-col justify-center gap-1 text-center"
      >
        <FilePlusIcon aria-hidden="true" size={18} />
        <span className="text-sm font-medium text-kumo-default">
          {uploading ? "Uploading..." : "Add new"}
        </span>
        <span className="text-xs font-normal text-kumo-subtle">
          {dirty
            ? "Save the current file before adding files"
            : "Click to create a file, or drag and drop files to upload"}
        </span>
      </Button>
    </div>
  );

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
      <Dialog.Root
        open={createKind !== null && createPresentation.presenting}
        onOpenChange={(open) => {
          if (!open && !creating) setCreateKind(null);
        }}
        onOpenChangeComplete={createPresentation.onOpenChangeComplete}
      >
        <Dialog size="sm" className="p-0">
          <div>
            <div className="grid gap-4 p-6">
              <div>
                <Dialog.Title>{createKind === "folder" ? "New folder" : "New file"}</Dialog.Title>
                <Dialog.Description>
                  Create it in the root of this skill.
                </Dialog.Description>
              </div>
              <Input
                autoFocus
                label={createKind === "folder" ? "Folder name" : "File name"}
                value={createName}
                onChange={(event) => {
                  setCreateName(event.target.value);
                  setCreateError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void createItem();
                  }
                }}
                placeholder={createKind === "folder" ? "references" : "reference.md"}
                variant={createError ? "error" : "default"}
                error={createError ?? undefined}
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-kumo-line px-6 py-3">
              <Button type="button" variant="secondary" disabled={creating} onClick={() => setCreateKind(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                loading={creating}
                onClick={() => void createItem()}
              >
                Create
              </Button>
            </div>
          </div>
        </Dialog>
      </Dialog.Root>
      <main className="mx-auto w-full max-w-5xl px-5 pb-12 pt-8 sm:px-10 sm:pt-10">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            if (event.target.files) void uploadFiles(event.target.files, uploadTargetRef.current);
            event.target.value = "";
          }}
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          // @ts-expect-error Chromium directory-picker extension
          webkitdirectory=""
          className="hidden"
          onChange={(event) => {
            if (event.target.files) void uploadFiles(event.target.files, uploadTargetRef.current);
            event.target.value = "";
          }}
        />
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
          <div className="mb-5 flex items-center justify-between gap-4">
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
            {canEditDocuments && uploadMenu}
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
            <div className="grid gap-5">
              {renderEditor(readyDocuments[0])}
              {uploadDropArea}
            </div>
          ) : activeTab === "overview" ? (
            <div className="grid gap-5">
              {readyDocuments.map((document) => (
                <SkillDocumentContent
                  key={document.path}
                  collectionId={collection.id}
                  document={document}
                  displayPath={displayPath(directory, document.path)}
                  onOpenFile={() => {
                    setEditOnOpenPath(null);
                    setPreviewDocument(document);
                    setActiveTab("preview");
                  }}
                />
              ))}
              {uploadDropArea}
            </div>
          ) : activeTab === "files" ? (
            <SkillFileNavigator
              documents={readyDocuments}
              rootDirectory={directory}
              pendingFolders={[...pendingFolders]}
              activePath={previewDocument?.path ?? null}
              canEdit={canEditDocuments === true}
              onMovePath={(fromPath, targetDirectory) => void movePath(fromPath, targetDirectory)}
              onRenamePath={renamePath}
              onOpenFile={(path) => {
                const document = readyDocuments.find((candidate) => candidate.path === path);
                if (!document) return;
                setEditOnOpenPath(null);
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
