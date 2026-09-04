import { Empty, InputGroup, SkeletonLine, Text } from "@cloudflare/kumo";
import { BookOpenIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { ContextDocumentSummary, EnabledCollectionInfo } from "../src/context-types";
import { useContextApi } from "./bridge";
import { SkillCollectionTree } from "./SkillCollectionTree";
import { SkillPage } from "./SkillPage";
import {
  buildSkillNavigatorRoot,
  filterSkillNavigatorRoot,
  type SkillNavigatorRoot,
} from "./skillNavigatorModel";

const SkillsNavigatorPage = () => {
  const context = useContextApi();
  const [roots, setRoots] = useState<SkillNavigatorRoot[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedSkill, setSelectedSkill] = useState<{
    root: SkillNavigatorRoot;
    skill: SkillNavigatorRoot["contents"]["skills"][number];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const collections: EnabledCollectionInfo[] =
          await context.listEnabledContextCollections();
        const documents: ContextDocumentSummary[][] = await Promise.all(
          collections.map((collection) => context.listContextDocuments(collection.id)),
        );
        if (cancelled) return;

        setRoots(
          collections
            .map((collection, index) => buildSkillNavigatorRoot(collection, documents[index]))
            .filter((root) => root.contents.skillCount > 0)
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

  if (selectedSkill) {
    return (
      <SkillPage
        collection={selectedSkill.root.collection}
        skill={selectedSkill.skill}
      />
    );
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col px-5 sm:px-10">
      <header className="shrink-0 px-1 pb-5 pt-8 sm:pt-10">
        <Text as="h1" variant="heading" size="lg">Skills</Text>
        <Text variant="secondary" size="sm" DANGEROUS_className="mt-1">
          Collections of skills your agents can use.
        </Text>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <InputGroup size="base" className="w-full shrink-0">
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
              onSelectSkill={(root, skill) => setSelectedSkill({ root, skill })}
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
