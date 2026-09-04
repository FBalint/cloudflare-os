import { Button, Collapsible, LayerCard, Text } from "@cloudflare/kumo";
import { cn } from "@cloudflare/kumo/utils";
import {
  CaretDownIcon,
  CaretRightIcon,
  FolderIcon,
  ScrollIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import type {
  SkillNavigatorCollection,
  SkillNavigatorRoot,
  SkillNavigatorSkill,
} from "./skillNavigatorModel";
import { formatSkillName } from "./skillNavigatorModel";

const COLLAPSIBLE_PANEL_CLASS_NAME = cn(
  "h-[var(--collapsible-panel-height)] overflow-hidden",
  "transition-[height,opacity] duration-100 ease-out motion-reduce:transition-none",
  "data-ending-style:h-0 data-ending-style:opacity-0",
  "data-starting-style:h-0 data-starting-style:opacity-0",
  "[&[hidden]:not([hidden='until-found'])]:hidden",
);

const nestedPaddingLeft = (depth: number) => 12 + (depth + 1) * 24;

const CollectionCaret = ({ open }: { open: boolean }) => (
  <CaretDownIcon
    aria-hidden="true"
    size={14}
    className={cn(
      "shrink-0 text-kumo-inactive transition-transform duration-100 ease-out motion-reduce:transition-none",
      !open && "-rotate-90",
    )}
  />
);

const SkillRow = ({
  skill,
  collectionTitle,
  depth,
  onSelect,
}: {
  skill: SkillNavigatorSkill;
  collectionTitle: string;
  depth: number;
  onSelect: () => void;
}) => (
  <Button
    type="button"
    variant="ghost"
    size="base"
    onClick={onSelect}
    title={`${formatSkillName(skill.name)}\n${skill.description}\n${collectionTitle} · ${skill.manifestPath}`}
    className="!flex !h-auto min-h-11 w-full items-center justify-start gap-3 py-2.5 pr-3 text-left"
    style={{ paddingLeft: `${nestedPaddingLeft(depth)}px` }}
  >
    <ScrollIcon aria-hidden="true" size={16} className="shrink-0 text-kumo-default" />
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <Text
        as="span"
        size="sm"
        truncate
        DANGEROUS_className="min-w-0 shrink-0 sm:max-w-[35%]"
      >
        {formatSkillName(skill.name)}
      </Text>
      <CaretRightIcon
        aria-hidden="true"
        size={11}
        className="shrink-0 text-kumo-inactive"
      />
      <Text
        as="span"
        variant="secondary"
        size="sm"
        truncate
        DANGEROUS_className="min-w-0 flex-1"
      >
        {skill.description}
      </Text>
    </span>
    <Text
      as="span"
      size="xs"
      DANGEROUS_className="max-w-[30%] shrink-0 truncate text-kumo-inactive"
    >
      {collectionTitle} · {skill.manifestPath}
    </Text>
  </Button>
);

type CollectionBranchProps = {
  collection: SkillNavigatorCollection;
  rootId: string;
  rootTitle: string;
  depth: number;
  expanded: Set<string>;
  searchActive: boolean;
  onToggle: (path: string) => void;
  onSelectSkill: (skill: SkillNavigatorSkill) => void;
};

const CollectionBranch = ({
  collection,
  rootId,
  rootTitle,
  depth,
  expanded,
  searchActive,
  onToggle,
  onSelectSkill,
}: CollectionBranchProps) => {
  const nodeId = `${rootId}/${collection.path}`;
  const open = searchActive || expanded.has(nodeId);

  return (
    <Collapsible.Root open={open} onOpenChange={() => onToggle(nodeId)}>
      <Collapsible.Trigger
        render={
          <Button
            variant="ghost"
            size="base"
            className="!flex !h-auto min-h-11 w-full justify-start gap-2 pr-3 text-left"
            style={{ paddingLeft: `${nestedPaddingLeft(depth)}px` }}
          />
        }
      >
        <CollectionCaret open={open} />
        <FolderIcon size={18} className="shrink-0 text-kumo-subtle" />
        <Text as="span" size="sm" bold truncate DANGEROUS_className="flex-1">
          {collection.name}
        </Text>
        <Text as="span" size="xs" DANGEROUS_className="tabular-nums text-kumo-inactive">
          {collection.skillCount}
        </Text>
      </Collapsible.Trigger>

      <Collapsible.Panel className={COLLAPSIBLE_PANEL_CLASS_NAME}>
        <div>
          {collection.collections.map((child) => (
            <CollectionBranch
              key={child.path}
              collection={child}
              rootId={rootId}
              rootTitle={rootTitle}
              depth={depth + 1}
              expanded={expanded}
              searchActive={searchActive}
              onToggle={onToggle}
              onSelectSkill={onSelectSkill}
            />
          ))}
          {collection.skills.map((skill) => (
            <SkillRow
              key={skill.manifestPath}
              skill={skill}
              collectionTitle={rootTitle}
              depth={depth + 1}
              onSelect={() => onSelectSkill(skill)}
            />
          ))}
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
};

export const SkillCollectionTree = ({
  roots,
  searchActive,
  onSelectSkill,
}: {
  roots: SkillNavigatorRoot[];
  searchActive: boolean;
  onSelectSkill: (root: SkillNavigatorRoot, skill: SkillNavigatorSkill) => void;
}) => {
  const [expanded, setExpanded] = useState(
    () => new Set(),
  );

  const toggle = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <LayerCard className="p-1 bg-white">
      {roots.map((root) => {
        const rootPath = root.collection.id;
        const open = searchActive || expanded.has(rootPath);

        return (
          <Collapsible.Root
            key={root.collection.id}
            open={open}
            onOpenChange={() => toggle(rootPath)}
          >
            <Collapsible.Trigger
              render={
                <Button
                  variant="ghost"
                  size="base"
                  className="!flex !h-auto min-h-12 w-full justify-start gap-2 px-3 text-left"
                />
              }
            >
              <CollectionCaret open={open} />
              {root.collection.icon ? (
                <span
                  aria-hidden="true"
                  className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden whitespace-nowrap text-base leading-none"
                >
                  {root.collection.icon}
                </span>
              ) : (
                <FolderIcon size={19} className="shrink-0 text-kumo-subtle" />
              )}
              <Text as="span" size="sm" bold truncate DANGEROUS_className="flex-1">
                {root.collection.title}
              </Text>
              <Text as="span" size="xs" DANGEROUS_className="tabular-nums text-kumo-inactive">
                {root.contents.skillCount}
              </Text>
            </Collapsible.Trigger>

            <Collapsible.Panel className={COLLAPSIBLE_PANEL_CLASS_NAME}>
              <div>
                {root.contents.collections.map((collection) => (
                  <CollectionBranch
                    key={collection.path}
                    collection={collection}
                    rootId={root.collection.id}
                    rootTitle={root.collection.title}
                    depth={0}
                    expanded={expanded}
                    searchActive={searchActive}
                    onToggle={toggle}
                    onSelectSkill={(skill) => onSelectSkill(root, skill)}
                  />
                ))}
                {root.contents.skills.map((skill) => (
                  <SkillRow
                    key={skill.manifestPath}
                    skill={skill}
                    collectionTitle={root.collection.title}
                    depth={0}
                    onSelect={() => onSelectSkill(root, skill)}
                  />
                ))}
              </div>
            </Collapsible.Panel>
          </Collapsible.Root>
        );
      })}
    </LayerCard>
  );
};
