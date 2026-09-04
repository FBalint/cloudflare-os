import type { ContextDocumentSummary, EnabledCollectionInfo } from "../../../src/context-types";

export type SkillNavigatorSkill = {
  manifestPath: string;
  name: string;
  description: string;
};

export type SkillNavigatorCollection = {
  path: string;
  name: string;
  collections: SkillNavigatorCollection[];
  skills: SkillNavigatorSkill[];
  skillCount: number;
};

export type SkillNavigatorRoot = {
  collection: EnabledCollectionInfo;
  contents: SkillNavigatorCollection;
};

type MutableCollection = Omit<SkillNavigatorCollection, "collections" | "skillCount"> & {
  collections: Map<string, MutableCollection>;
};

const directoryName = (path: string): string => {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
};

const finalizeCollection = (collection: MutableCollection): SkillNavigatorCollection => {
  const collections = [...collection.collections.values()]
    .map(finalizeCollection)
    .toSorted((left, right) => left.name.localeCompare(right.name));
  const skills = collection.skills.toSorted((left, right) => left.name.localeCompare(right.name));

  return {
    path: collection.path,
    name: collection.name,
    collections,
    skills,
    skillCount:
      skills.length + collections.reduce((count, child) => count + child.skillCount, 0),
  };
};

export const buildSkillNavigatorRoot = (
  collection: EnabledCollectionInfo,
  documents: ContextDocumentSummary[],
): SkillNavigatorRoot => {
  const root: MutableCollection = {
    path: "",
    name: collection.title,
    collections: new Map(),
    skills: [],
  };

  const ensureCollection = (path: string): MutableCollection => {
    let current = root;
    let currentPath = "";

    for (const segment of path.split("/").filter(Boolean)) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      let child = current.collections.get(segment);
      if (!child) {
        child = {
          path: currentPath,
          name: segment,
          collections: new Map(),
          skills: [],
        };
        current.collections.set(segment, child);
      }
      current = child;
    }

    return current;
  };

  for (const document of documents) {
    if (!document.skillName) continue;

    const skillDirectory = directoryName(document.path);
    const parentDirectory = directoryName(skillDirectory);
    ensureCollection(parentDirectory).skills.push({
      manifestPath: document.path,
      name: document.skillName,
      description: document.description,
    });
  }

  return { collection, contents: finalizeCollection(root) };
};

export const filterSkillNavigatorRoot = (
  root: SkillNavigatorRoot,
  query: string,
): SkillNavigatorRoot | null => {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return root;

  if (
    root.collection.title.toLowerCase().includes(normalizedQuery) ||
    root.collection.description.toLowerCase().includes(normalizedQuery)
  ) {
    return root;
  }

  const filterCollection = (
    collection: SkillNavigatorCollection,
  ): SkillNavigatorCollection | null => {
    if (collection.name.toLowerCase().includes(normalizedQuery)) return collection;

    const collections = collection.collections.flatMap((child) => {
      const match = filterCollection(child);
      return match ? [match] : [];
    });
    const skills = collection.skills.filter(
      (skill) =>
        skill.name.toLowerCase().includes(normalizedQuery) ||
        skill.description.toLowerCase().includes(normalizedQuery),
    );
    const skillCount =
      skills.length + collections.reduce((count, child) => count + child.skillCount, 0);

    return skillCount > 0 ? { ...collection, collections, skills, skillCount } : null;
  };

  const contents = filterCollection(root.contents);
  return contents ? { ...root, contents } : null;
};
