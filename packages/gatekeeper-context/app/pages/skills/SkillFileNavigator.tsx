import { Button, Collapsible, Input, LayerCard, Text } from "@cloudflare/kumo";
import { cn } from "@cloudflare/kumo/utils";
import {
  CaretDownIcon,
  CaretRightIcon,
  FileTextIcon,
  ImageIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { ContextDocument } from "../../../src/context-types";
import { isImageContentType } from "../../../src/context-types";

type SkillFile = Pick<ContextDocument, "contentType" | "name"> & {
  path: string;
  sourcePath: string;
};

type FileTreeFolder = {
  name: string;
  path: string;
  persisted: boolean;
  folders: Map<string, FileTreeFolder>;
  files: SkillFile[];
};

type TreeActions = {
  activePath: string | null;
  canEdit: boolean;
  dragPath: string | null;
  dragOverDirectory: string | null;
  expanded: Set<string>;
  renamingPath: string | null;
  renameValue: string;
  onDragStart: (path: string) => void;
  onDragEnd: () => void;
  onDragOverDirectory: (path: string | null) => void;
  onMove: (fromPath: string, targetDirectory: string) => void;
  onOpenFile: (path: string) => void;
  onRenameValueChange: (value: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onRenameStart: (path: string, name: string) => void;
  onToggle: (path: string) => void;
};

const TREE_INDENT = 16;

const treePadding = (depth: number, isFile: boolean): number =>
  depth * TREE_INDENT + 8 + (isFile ? TREE_INDENT : 0);

const relativePath = (rootDirectory: string, path: string): string =>
  rootDirectory ? path.slice(rootDirectory.length + 1) : path;

const directoryName = (path: string): string => {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
};

const buildFileTree = (
  documents: ContextDocument[],
  rootDirectory: string,
  pendingFolders: string[],
): FileTreeFolder => {
  const root: FileTreeFolder = {
    name: "",
    path: "",
    persisted: true,
    folders: new Map(),
    files: [],
  };

  const ensureFolder = (path: string, persisted: boolean): FileTreeFolder => {
    let folder = root;
    let folderPath = "";
    for (const segment of path.split("/").filter(Boolean)) {
      folderPath = folderPath ? `${folderPath}/${segment}` : segment;
      let child = folder.folders.get(segment);
      if (!child) {
        child = {
          name: segment,
          path: folderPath,
          persisted,
          folders: new Map(),
          files: [],
        };
        folder.folders.set(segment, child);
      } else if (persisted) {
        child.persisted = true;
      }
      folder = child;
    }
    return folder;
  };

  for (const path of pendingFolders) ensureFolder(path, false);
  for (const document of documents) {
    const path = relativePath(rootDirectory, document.path);
    const segments = path.split("/");
    const name = segments.pop() ?? path;
    ensureFolder(segments.join("/"), true).files.push({
      path,
      sourcePath: document.path,
      name,
      contentType: document.contentType,
    });
  }

  return root;
};

const COLLAPSIBLE_PANEL_CLASS_NAME = cn(
  "h-[var(--collapsible-panel-height)] overflow-hidden",
  "transition-[height,opacity] duration-100 ease-out motion-reduce:transition-none",
  "data-ending-style:h-0 data-ending-style:opacity-0",
  "data-starting-style:h-0 data-starting-style:opacity-0",
  "[&[hidden]:not([hidden='until-found'])]:hidden",
);

const RenameInput = ({ depth, isFile, actions }: {
  depth: number;
  isFile: boolean;
  actions: TreeActions;
}) => (
  <div className="mb-0.5 pr-1" style={{ paddingLeft: `${treePadding(depth, isFile)}px` }}>
    <Input
      autoFocus
      size="xs"
      value={actions.renameValue}
      onChange={(event) => actions.onRenameValueChange(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onBlur={actions.onRenameCommit}
      onKeyDown={(event) => {
        if (event.key === "Enter") actions.onRenameCommit();
        if (event.key === "Escape") actions.onRenameCancel();
      }}
      aria-label="Rename item"
      className="h-7!"
    />
  </div>
);

const FileRow = ({ file, depth, actions }: {
  file: SkillFile;
  depth: number;
  actions: TreeActions;
}) => {
  const active = file.sourcePath === actions.activePath;
  const protectedManifest = file.path === "SKILL.md";
  const Icon = isImageContentType(file.contentType) ? ImageIcon : FileTextIcon;

  if (actions.renamingPath === file.path) {
    return <RenameInput depth={depth} isFile actions={actions} />;
  }

  return (
    <Button
      draggable={actions.canEdit && !protectedManifest}
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => actions.onOpenFile(file.sourcePath)}
      onDoubleClick={() => {
        if (!protectedManifest && actions.canEdit) actions.onRenameStart(file.path, file.name);
      }}
      onDragStart={() => actions.onDragStart(file.path)}
      onDragEnd={actions.onDragEnd}
      className={cn(
        "mb-0.5 !flex !h-7 w-full min-w-0 justify-start gap-2 pr-1.5 text-left",
        active && "bg-kumo-recessed",
      )}
      style={{ paddingLeft: `${protectedManifest ? 8 : treePadding(depth, true)}px` }}
      title={file.path}
    >
      <Icon
        aria-hidden="true"
        size={14}
        className={cn("shrink-0", active ? "text-kumo-default" : "text-kumo-subtle")}
      />
      <Text as="span" size="sm" bold={active} truncate>{file.name}</Text>
    </Button>
  );
};

const FolderBranch = ({ folder, depth, actions }: {
  folder: FileTreeFolder;
  depth: number;
  actions: TreeActions;
}) => {
  const open = actions.expanded.has(folder.path);
  const folders = [...folder.folders.values()].toSorted((left, right) =>
    left.name.localeCompare(right.name),
  );
  const files = folder.files.toSorted((left, right) => left.path.localeCompare(right.path));

  return (
    <Collapsible.Root open={open} onOpenChange={() => actions.onToggle(folder.path)}>
      {actions.renamingPath === folder.path ? (
        <RenameInput depth={depth} isFile={false} actions={actions} />
      ) : (
        <div
          onDragOver={(event) => {
            if (!actions.canEdit || !actions.dragPath) return;
            event.preventDefault();
            event.stopPropagation();
            actions.onDragOverDirectory(folder.path);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              actions.onDragOverDirectory(null);
            }
          }}
          onDrop={(event) => {
            if (!actions.canEdit || !actions.dragPath) return;
            event.preventDefault();
            event.stopPropagation();
            actions.onMove(actions.dragPath, folder.path);
          }}
          className={cn(
            "mb-0.5 flex items-center rounded-md",
            actions.dragOverDirectory === folder.path && "bg-kumo-recessed",
          )}
        >
          <Collapsible.Trigger
            render={
              <Button
                draggable={actions.canEdit && folder.persisted}
                type="button"
                variant="ghost"
                size="sm"
                className="!flex !h-7 min-w-0 flex-1 justify-start gap-1.5 pr-1.5 text-left"
                style={{ paddingLeft: `${treePadding(depth, false)}px` }}
                onDoubleClick={() => {
                  if (actions.canEdit) actions.onRenameStart(folder.path, folder.name);
                }}
                onDragStart={() => actions.onDragStart(folder.path)}
                onDragEnd={actions.onDragEnd}
              />
            }
          >
            {open ? (
              <CaretDownIcon aria-hidden="true" size={12} className="shrink-0 text-kumo-inactive" />
            ) : (
              <CaretRightIcon aria-hidden="true" size={12} className="shrink-0 text-kumo-inactive" />
            )}
            <Text as="span" size="sm" bold truncate>{folder.name}</Text>
          </Collapsible.Trigger>
        </div>
      )}
      <Collapsible.Panel className={COLLAPSIBLE_PANEL_CLASS_NAME}>
        <div>
          {folders.map((child) => (
            <FolderBranch key={child.path} folder={child} depth={depth + 1} actions={actions} />
          ))}
          {files.map((file) => (
            <FileRow key={file.path} file={file} depth={depth + 1} actions={actions} />
          ))}
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
};

export const SkillFileNavigator = ({
  documents,
  rootDirectory,
  pendingFolders,
  activePath,
  canEdit,
  onOpenFile,
  onMovePath,
  onRenamePath,
}: {
  documents: ContextDocument[];
  rootDirectory: string;
  pendingFolders: string[];
  activePath: string | null;
  canEdit: boolean;
  onOpenFile: (path: string) => void;
  onMovePath: (fromPath: string, targetDirectory: string) => void;
  onRenamePath: (path: string, name: string) => Promise<boolean>;
}) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dragPath, setDragPath] = useState<string | null>(null);
  const [dragOverDirectory, setDragOverDirectory] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const openTimerRef = useRef<number | null>(null);
  const tree = buildFileTree(documents, rootDirectory, pendingFolders);
  const folders = [...tree.folders.values()].toSorted((left, right) =>
    left.name.localeCompare(right.name),
  );
  const files = tree.files.toSorted((left, right) => left.path.localeCompare(right.path));
  const manifest = files.find((file) => file.path === "SKILL.md");
  const supportingFiles = files.filter((file) => file.path !== "SKILL.md");

  const endDrag = () => {
    setDragPath(null);
    setDragOverDirectory(null);
  };

  useEffect(() => () => {
    if (openTimerRef.current !== null) window.clearTimeout(openTimerRef.current);
  }, []);

  const actions: TreeActions = {
    activePath,
    canEdit,
    dragPath,
    dragOverDirectory,
    expanded,
    renamingPath,
    renameValue,
    onDragStart: setDragPath,
    onDragEnd: endDrag,
    onDragOverDirectory: setDragOverDirectory,
    onMove: (fromPath, targetDirectory) => {
      onMovePath(fromPath, targetDirectory);
      endDrag();
    },
    onOpenFile: (path) => {
      if (openTimerRef.current !== null) window.clearTimeout(openTimerRef.current);
      openTimerRef.current = window.setTimeout(() => {
        openTimerRef.current = null;
        onOpenFile(path);
      }, 220);
    },
    onRenameValueChange: setRenameValue,
    onRenameCommit: () => {
      const path = renamingPath;
      if (!path) return;
      void onRenamePath(path, renameValue).then((renamed) => {
        if (renamed) setRenamingPath(null);
      });
    },
    onRenameCancel: () => setRenamingPath(null),
    onRenameStart: (path, name) => {
      if (openTimerRef.current !== null) {
        window.clearTimeout(openTimerRef.current);
        openTimerRef.current = null;
      }
      setRenamingPath(path);
      setRenameValue(name);
    },
    onToggle: (path) => {
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
    },
  };

  return (
    <LayerCard className="w-full overflow-hidden bg-white p-1">
      {manifest && (
        <div className="border-b border-kumo-hairline pb-1">
          <FileRow file={manifest} depth={0} actions={actions} />
        </div>
      )}
      <div className="pt-1">
        {folders.map((folder) => (
          <FolderBranch key={folder.path} folder={folder} depth={0} actions={actions} />
        ))}
        {supportingFiles.map((file) => (
          <FileRow key={file.path} file={file} depth={0} actions={actions} />
        ))}
        {dragPath && directoryName(dragPath) && (
          <div
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setDragOverDirectory("");
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onMovePath(dragPath, "");
              endDrag();
            }}
            className={cn(
              "m-1 flex h-8 items-center justify-center rounded-md border border-dashed border-kumo-line",
              dragOverDirectory === "" && "bg-kumo-recessed",
            )}
          >
            <Text size="xs" variant="secondary">Move to skill root</Text>
          </div>
        )}
      </div>
    </LayerCard>
  );
};
