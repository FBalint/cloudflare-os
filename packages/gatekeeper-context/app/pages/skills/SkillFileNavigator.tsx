import { Button, Collapsible, LayerCard, Text } from "@cloudflare/kumo";
import { cn } from "@cloudflare/kumo/utils";
import {
  CaretDownIcon,
  CaretRightIcon,
  FileTextIcon,
  ImageIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import type { ContextDocument } from "../../../src/context-types";
import { isImageContentType } from "../../../src/context-types";

type SkillFile = Pick<ContextDocument, "contentType" | "name"> & {
  path: string;
  sourcePath: string;
};

type FileTreeFolder = {
  name: string;
  path: string;
  folders: Map<string, FileTreeFolder>;
  files: SkillFile[];
};

const TREE_INDENT = 16;

const treePadding = (depth: number, isFile: boolean): number =>
  depth * TREE_INDENT + 8 + (isFile ? TREE_INDENT : 0);

const relativePath = (rootDirectory: string, path: string): string =>
  rootDirectory ? path.slice(rootDirectory.length + 1) : path;

const buildFileTree = (
  documents: ContextDocument[],
  rootDirectory: string,
): FileTreeFolder => {
  const root: FileTreeFolder = { name: "", path: "", folders: new Map(), files: [] };

  for (const document of documents) {
    const path = relativePath(rootDirectory, document.path);
    const segments = path.split("/");
    const name = segments.pop() ?? path;
    let folder = root;
    let folderPath = "";

    for (const segment of segments) {
      folderPath = folderPath ? `${folderPath}/${segment}` : segment;
      let child = folder.folders.get(segment);
      if (!child) {
        child = { name: segment, path: folderPath, folders: new Map(), files: [] };
        folder.folders.set(segment, child);
      }
      folder = child;
    }

    folder.files.push({
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

const FileRow = ({
  file,
  depth,
  active,
  onOpen,
}: {
  file: SkillFile;
  depth: number;
  active: boolean;
  onOpen: (path: string) => void;
}) => {
  const Icon = isImageContentType(file.contentType) ? ImageIcon : FileTextIcon;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => onOpen(file.sourcePath)}
      className={cn(
        "mb-0.5 !flex !h-7 w-full min-w-0 justify-start gap-2 pr-1.5 text-left",
        active && "bg-kumo-recessed",
      )}
      style={{ paddingLeft: `${treePadding(depth, true)}px` }}
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

const FolderBranch = ({
  folder,
  depth,
  expanded,
  onToggle,
  activePath,
  onOpenFile,
}: {
  folder: FileTreeFolder;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  activePath: string | null;
  onOpenFile: (path: string) => void;
}) => {
  const open = expanded.has(folder.path);
  const folders = [...folder.folders.values()].toSorted((left, right) =>
    left.name.localeCompare(right.name),
  );
  const files = folder.files.toSorted((left, right) => left.path.localeCompare(right.path));

  return (
    <Collapsible.Root open={open} onOpenChange={() => onToggle(folder.path)}>
      <Collapsible.Trigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mb-0.5 !flex !h-7 w-full justify-start gap-1.5 pr-1.5 text-left"
            style={{ paddingLeft: `${treePadding(depth, false)}px` }}
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
      <Collapsible.Panel className={COLLAPSIBLE_PANEL_CLASS_NAME}>
        <div>
          {folders.map((child) => (
            <FolderBranch
              key={child.path}
              folder={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              activePath={activePath}
              onOpenFile={onOpenFile}
            />
          ))}
          {files.map((file) => (
            <FileRow
              key={file.path}
              file={file}
              depth={depth + 1}
              active={file.sourcePath === activePath}
              onOpen={onOpenFile}
            />
          ))}
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
};

export const SkillFileNavigator = ({
  documents,
  rootDirectory,
  activePath,
  onOpenFile,
}: {
  documents: ContextDocument[];
  rootDirectory: string;
  activePath: string | null;
  onOpenFile: (path: string) => void;
}) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const tree = buildFileTree(documents, rootDirectory);
  const folders = [...tree.folders.values()].toSorted((left, right) =>
    left.name.localeCompare(right.name),
  );
  const files = tree.files.toSorted((left, right) => left.path.localeCompare(right.path));

  const toggle = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <LayerCard className="w-full p-2">
      <div className="w-full py-1">
        {folders.map((folder) => (
          <FolderBranch
            key={folder.path}
            folder={folder}
            depth={0}
            expanded={expanded}
            onToggle={toggle}
            activePath={activePath}
            onOpenFile={onOpenFile}
          />
        ))}
        {files.map((file) => (
          <FileRow
            key={file.path}
            file={file}
            depth={0}
            active={file.sourcePath === activePath}
            onOpen={onOpenFile}
          />
        ))}
      </div>
    </LayerCard>
  );
};
