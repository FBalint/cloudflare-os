import { Button, Empty, LayerCard, SkeletonLine, Tabs, Text } from "@cloudflare/kumo";
import { CaretLeftIcon, FolderIcon, PathIcon, ScrollIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type {
  ContextDocument,
  ContextDocumentSummary,
  EnabledCollectionInfo,
} from "../../../src/context-types";
import { useContextApi } from "../../bridge";
import { SkillDocumentContent } from "./SkillDocumentContent";
import type { SkillNavigatorSkill } from "./skillNavigatorModel";

const directoryName = (path: string): string => {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
};

const displayPath = (directory: string, path: string): string =>
  directory ? path.slice(directory.length + 1) : path;

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

const SkillFiles = ({
  documents,
  directory,
}: {
  documents: ContextDocument[];
  directory: string;
}) => (
  <LayerCard className="divide-y divide-kumo-hairline px-2 py-1">
    {documents.map((document) => (
      <div key={document.path} className="flex min-w-0 items-center gap-3 px-3 py-3">
        <ScrollIcon aria-hidden="true" size={16} className="shrink-0 text-kumo-default" />
        <div className="min-w-0 flex-1">
          <Text size="sm" truncate>{displayPath(directory, document.path)}</Text>
          <Text variant="secondary" size="xs" truncate>{document.contentType}</Text>
        </div>
      </div>
    ))}
  </LayerCard>
);

export const SkillPage = ({
  collection,
  skill,
  onBack,
}: {
  collection: EnabledCollectionInfo;
  skill: SkillNavigatorSkill;
  onBack: () => void;
}) => {
  const context = useContextApi();
  const directory = directoryName(skill.manifestPath);
  const [documents, setDocuments] = useState<ContextDocument[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const summaries: ContextDocumentSummary[] = await context.listContextDocuments(
          collection.id,
          directory ? `${directory}/` : undefined,
        );
        const loaded: (ContextDocument | null)[] = await Promise.all(
          summaries.map((summary) => context.getContextDocument(collection.id, summary.path)),
        );
        if (cancelled) return;

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
  }, [collection.id, context, directory, skill.manifestPath]);

  const readyDocuments = documents ?? [];

  return (
    <div className="h-full overflow-y-auto">
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
            <Text as="h1" variant="heading" size="lg" DANGEROUS_className="min-w-0 break-words">
              {skill.name}
            </Text>
          </div>
          <Text variant="secondary" size="base" DANGEROUS_className="mt-2 max-w-3xl">
            {skill.description}
          </Text>
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

        <div className="mb-5">
          <Tabs
            variant="segmented"
            value={activeTab}
            onValueChange={setActiveTab}
            tabs={[
              { value: "overview", label: "Overview" },
              { value: "files", label: `Files${documents ? ` (${readyDocuments.length})` : ""}` },
            ]}
          />
        </div>

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
        ) : activeTab === "overview" ? (
          <div className="grid gap-5">
            {readyDocuments.map((document) => (
              <SkillDocumentContent
                key={document.path}
                collectionId={collection.id}
                document={document}
                displayPath={displayPath(directory, document.path)}
              />
            ))}
          </div>
        ) : (
          <SkillFiles documents={readyDocuments} directory={directory} />
        )}
      </main>
    </div>
  );
};
