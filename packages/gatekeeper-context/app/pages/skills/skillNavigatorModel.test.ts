import { describe, expect, it } from "vitest";
import type { ContextDocumentSummary, EnabledCollectionInfo } from "../../../src/context-types";
import {
  buildSkillNavigatorRoot,
  filterSkillNavigatorRoot,
  formatSkillName,
} from "./skillNavigatorModel";

const collection: EnabledCollectionInfo = {
  id: "design",
  title: "Design skills",
  description: "Design guidance",
  source: "public",
  lastUpdated: new Date("2026-01-01"),
};

const document = (
  path: string,
  options: { skillName?: string; description?: string } = {},
): ContextDocumentSummary => ({
  path,
  name: path.split("/").at(-1) ?? path,
  description: options.description ?? "",
  contentType: "text/markdown",
  ...(options.skillName ? { skillName: options.skillName } : {}),
  lastUpdated: new Date("2026-01-01"),
});

describe("formatSkillName", () => {
  it("turns the canonical kebab-case identifier into a display name", () => {
    expect(formatSkillName("pdf-processing")).toBe("Pdf Processing");
    expect(formatSkillName("code-review")).toBe("Code Review");
  });
});

describe("buildSkillNavigatorRoot", () => {
  it("represents manifests as skills and omits their files and unrelated context", () => {
    const root = buildSkillNavigatorRoot(collection, [
      document("design/kumo/SKILL.md", {
        skillName: "kumo-design",
        description: "Cloudflare product design guidance",
      }),
      document("design/kumo/references/colors.md"),
      document("context/company.md"),
    ]);

    expect(root.contents.skillCount).toBe(1);
    expect(root.contents.collections).toEqual([
      {
        path: "design",
        name: "design",
        skillCount: 1,
        collections: [],
        skills: [
          {
            manifestPath: "design/kumo/SKILL.md",
            name: "kumo-design",
            description: "Cloudflare product design guidance",
          },
        ],
      },
    ]);
  });

  it("preserves nested collections and supports root-level skills", () => {
    const root = buildSkillNavigatorRoot(collection, [
      document("SKILL.md", { skillName: "root-skill" }),
      document("teams/design/review/SKILL.md", { skillName: "design-review" }),
    ]);

    expect(root.contents.skills.map((skill) => skill.name)).toEqual(["root-skill"]);
    expect(root.contents.collections[0].collections[0].skills[0].name).toBe("design-review");
    expect(root.contents.skillCount).toBe(2);
  });
});

describe("filterSkillNavigatorRoot", () => {
  it("matches collection metadata, nested collection names, and skill metadata", () => {
    const root = buildSkillNavigatorRoot(collection, [
      document("teams/design/review/SKILL.md", {
        skillName: "design-review",
        description: "Review product interfaces",
      }),
    ]);

    expect(filterSkillNavigatorRoot(root, "guidance")).toBe(root);
    expect(filterSkillNavigatorRoot(root, "teams")?.contents.skillCount).toBe(1);
    expect(filterSkillNavigatorRoot(root, "interfaces")?.contents.skillCount).toBe(1);
    expect(filterSkillNavigatorRoot(root, "finance")).toBeNull();
  });

  it("removes unrelated skills while preserving their collection ancestors", () => {
    const root = buildSkillNavigatorRoot(collection, [
      document("teams/design/review/SKILL.md", { skillName: "design-review" }),
      document("teams/platform/deploy/SKILL.md", { skillName: "deploy-worker" }),
    ]);

    const filtered = filterSkillNavigatorRoot(root, "deploy");
    expect(filtered?.contents.skillCount).toBe(1);
    expect(filtered?.contents.collections[0].collections.map((item) => item.name)).toEqual([
      "platform",
    ]);
  });
});
