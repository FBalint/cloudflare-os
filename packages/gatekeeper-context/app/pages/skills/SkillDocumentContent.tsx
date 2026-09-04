import { Button, LayerCard, Text } from "@cloudflare/kumo";
import { cn } from "@cloudflare/kumo/utils";
import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ContextDocument } from "../../../src/context-types";
import {
  isImageContentType,
  isMarkdownContentType,
  isTextContentType,
} from "../../../src/context-types";
import { useContextApi } from "../../bridge";

const directoryName = (path: string): string => {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
};

const resolveCollectionPath = (baseDirectory: string, relativePath: string): string => {
  const path = relativePath.split(/[?#]/)[0];
  const segments = !path.startsWith("/") && baseDirectory ? baseDirectory.split("/") : [];

  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }

  return segments.join("/");
};

const isExternalImageSource = (source: string): boolean =>
  /^[a-z][a-z0-9+.-]*:/i.test(source) || source.startsWith("//") || source.startsWith("#");

const stripFrontmatter = (source: string): string =>
  source.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, "");

const SkillMarkdownImage = ({
  collectionId,
  documentPath,
  source = "",
  alt = "",
}: {
  collectionId: string;
  documentPath: string;
  source?: string;
  alt?: string;
}) => {
  const context = useContextApi();
  const [resolvedSource, setResolvedSource] = useState(source);

  useEffect(() => {
    setResolvedSource(source);
    if (!source || isExternalImageSource(source)) return;

    let cancelled = false;
    const imagePath = resolveCollectionPath(directoryName(documentPath), source);
    context
      .getContextDocument(collectionId, imagePath)
      .then((document) => {
        if (!cancelled && document && isImageContentType(document.contentType)) {
          setResolvedSource(`data:${document.contentType};base64,${document.body}`);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [collectionId, context, documentPath, source]);

  return <img src={resolvedSource} alt={alt} />;
};

const MarkdownContent = ({
  collectionId,
  document,
}: {
  collectionId: string;
  document: ContextDocument;
}) => {
  return (
    <div className="kb-mdx-content min-w-0 max-w-full text-sm text-kumo-default">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        components={{
          img: ({ src, alt }: ComponentProps<"img">) => (
            <SkillMarkdownImage
              collectionId={collectionId}
              documentPath={document.path}
              source={typeof src === "string" ? src : ""}
              alt={typeof alt === "string" ? alt : ""}
            />
          ),
        }}
      >
        {stripFrontmatter(document.body).trim()}
      </ReactMarkdown>
    </div>
  );
};

const DocumentBody = ({
  collectionId,
  document,
}: {
  collectionId: string;
  document: ContextDocument;
}) => {
  if (!document.body) {
    return <Text variant="secondary" size="sm">This file is empty.</Text>;
  }

  if (isMarkdownContentType(document.contentType)) {
    return <MarkdownContent collectionId={collectionId} document={document} />;
  }

  if (isImageContentType(document.contentType)) {
    return (
      <img
        src={`data:${document.contentType};base64,${document.body}`}
        alt={document.name}
        className="max-h-[32rem] max-w-full rounded-lg object-contain"
      />
    );
  }

  if (isTextContentType(document.contentType)) {
    return (
      <Text
        as="pre"
        variant="mono"
        DANGEROUS_className="max-w-full overflow-x-auto whitespace-pre p-4 text-xs leading-5 text-kumo-default"
      >
        <code>{document.body}</code>
      </Text>
    );
  }

  return <Text variant="secondary" size="sm">Preview is unavailable for this file type.</Text>;
};

export const SkillDocumentContent = ({
  collectionId,
  document,
  displayPath,
  onOpenFile,
}: {
  collectionId: string;
  document: ContextDocument;
  displayPath: string;
  onOpenFile?: () => void;
}) => {
  const [isOverflowing, setIsOverflowing] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!onOpenFile || !body) {
      setIsOverflowing(false);
      return;
    }

    const measure = () => setIsOverflowing(body.scrollHeight > body.clientHeight + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    for (const child of body.children) observer.observe(child);
    measure();

    return () => observer.disconnect();
  }, [document.body, onOpenFile]);

  return (
    <LayerCard
      className={cn(
        "relative overflow-hidden bg-white",
        onOpenFile && "hover:bg-kumo-elevated!",
      )}
    >
      {onOpenFile ? (
        <div className="flex h-10 min-w-0 items-center px-5 sm:px-8">
          <Text as="h2" size="xs" truncate DANGEROUS_className="min-w-0 text-kumo-subtle">
            {displayPath}
          </Text>
        </div>
      ) : null}
      <div
        ref={bodyRef}
        className={cn(
          "min-w-0 px-5 py-6 sm:px-8 sm:py-8",
          onOpenFile && "pt-0 sm:pt-0",
          onOpenFile && "max-h-96 overflow-hidden",
        )}
      >
        <DocumentBody collectionId={collectionId} document={document} />
      </div>
      {onOpenFile && (
        <>
          {isOverflowing && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-20 bg-gradient-to-b from-transparent to-kumo-base"
            />
          )}
          <Button
            type="button"
            variant="ghost"
            aria-label={`Open ${displayPath}`}
            onClick={onOpenFile}
            className="absolute inset-0 z-20 h-full! w-full! cursor-pointer bg-transparent! p-0! hover:bg-transparent!"
          >
            <span className="sr-only">Open {displayPath}</span>
          </Button>
        </>
      )}
    </LayerCard>
  );
};
