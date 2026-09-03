import type { DocumentSourceType, DocumentTreeInput, DocumentTreeNodeInput, EmbeddingChunk } from "../types/embeddings.types.js";

export interface ComponentIndexRecord {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  typicalUseCase: string | null;
  category: string;
  subcategory: string;
  productType: string;
  brand: string | null;
  tags: string[];
  unitPriceCents: number;
  stockQuantity: number;
  imageUrl: string | null;
  vendorLink: string | null;
  isBestSeller: boolean;
  isRobomaniacItem: boolean;
  isSoftware: boolean;
}

export interface ProjectIndexRecord {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  description: string | null;
  category: string;
  tags: string[];
  difficulty: string;
  projectType: string;
  estimatedCostCents: number | null;
  estimatedBuildTimeMinutes: number | null;
  thumbnailUrl: string | null;
  learningOutcomes: string[];
  prerequisites: string[];
}

export interface ShortDocumentInput {
  id: string;
  sourceType: "faq" | "short_policy";
  title: string;
  body: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface MarkdownDocumentInput {
  title: string;
  sourceType: DocumentSourceType;
  sourceId?: string;
  fileUrl?: string;
  markdown: string;
  metadata?: Record<string, string | number | boolean | null>;
}

function compactText(parts: Array<string | number | null | undefined>): string {
  return parts
    .filter((part): part is string | number => part !== null && part !== undefined && String(part).trim().length > 0)
    .map((part) => String(part).trim())
    .join(" | ")
    .replace(/\s+/g, " ");
}

function firstSentences(text: string, sentenceCount: number): string {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  return sentences.slice(0, sentenceCount).join(" ");
}

export function chunkComponent(component: ComponentIndexRecord): EmbeddingChunk {
  const priceRupees = component.unitPriceCents / 100;
  const chunkText = compactText([
    `Component: ${component.name}`,
    component.sku ? `SKU: ${component.sku}` : null,
    `Category: ${component.category} > ${component.subcategory}`,
    `Type: ${component.productType}`,
    component.brand ? `Brand: ${component.brand}` : null,
    `Price: INR ${priceRupees}`,
    `Stock: ${component.stockQuantity}`,
    component.description,
    component.typicalUseCase ? `Typical use: ${component.typicalUseCase}` : null,
    component.tags.length > 0 ? `Tags: ${component.tags.join(", ")}` : null,
  ]);

  return {
    sourceType: "component",
    sourceId: component.id,
    chunkText,
    metadata: {
      name: component.name,
      sku: component.sku,
      category: component.category,
      subcategory: component.subcategory,
      productType: component.productType,
      brand: component.brand,
      priceCents: component.unitPriceCents,
      stock: component.stockQuantity,
      imageUrl: component.imageUrl,
      vendorLink: component.vendorLink,
      isBestSeller: component.isBestSeller,
      isRobomaniacItem: component.isRobomaniacItem,
      isSoftware: component.isSoftware,
    },
  };
}

export function chunkProject(project: ProjectIndexRecord): EmbeddingChunk {
  const estimatedCost = project.estimatedCostCents === null ? null : project.estimatedCostCents / 100;
  const chunkText = compactText([
    `Project: ${project.title}`,
    `Category: ${project.category}`,
    `Difficulty: ${project.difficulty}`,
    `Type: ${project.projectType}`,
    estimatedCost === null ? null : `Estimated cost: INR ${estimatedCost}`,
    project.estimatedBuildTimeMinutes === null ? null : `Build time: ${project.estimatedBuildTimeMinutes} minutes`,
    project.summary,
    project.description,
    project.learningOutcomes.length > 0 ? `Learning outcomes: ${project.learningOutcomes.join(", ")}` : null,
    project.prerequisites.length > 0 ? `Prerequisites: ${project.prerequisites.join(", ")}` : null,
    project.tags.length > 0 ? `Tags: ${project.tags.join(", ")}` : null,
  ]);

  return {
    sourceType: "project",
    sourceId: project.id,
    chunkText,
    metadata: {
      title: project.title,
      slug: project.slug,
      category: project.category,
      difficulty: project.difficulty,
      projectType: project.projectType,
      estimatedCostCents: project.estimatedCostCents,
      estimatedBuildTimeMinutes: project.estimatedBuildTimeMinutes,
      thumbnailUrl: project.thumbnailUrl,
    },
  };
}

export function chunkShortDocument(input: ShortDocumentInput): EmbeddingChunk {
  return {
    sourceType: input.sourceType,
    sourceId: input.id,
    chunkText: compactText([input.title, input.body]),
    metadata: {
      title: input.title,
      ...input.metadata,
    },
  };
}

export function buildMarkdownDocumentTree(input: MarkdownDocumentInput): DocumentTreeInput {
  const lines = input.markdown.split(/\r?\n/);
  const root: DocumentTreeNodeInput = {
    nodeId: "0000",
    title: input.title,
    summary: firstSentences(input.markdown, 2) || input.title,
    fullText: input.markdown,
    startIndex: 0,
    endIndex: lines.length,
    children: [],
  };

  const stack: Array<{ level: number; node: DocumentTreeNodeInput }> = [{ level: 0, node: root }];
  let nodeCounter = 1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) continue;

    const match = /^(#{1,6})\s+(.+)$/.exec(line);
    const headingMarker = match?.[1];
    const headingTitle = match?.[2];
    if (!headingMarker || !headingTitle) continue;

    const level = headingMarker.length;
    const title = headingTitle.trim();
    const nextHeadingIndex = findNextHeadingIndex(lines, index + 1, level);
    const sectionText = lines.slice(index + 1, nextHeadingIndex).join("\n").trim();
    const node: DocumentTreeNodeInput = {
      nodeId: String(nodeCounter).padStart(4, "0"),
      title,
      summary: firstSentences(sectionText, 2) || title,
      fullText: sectionText || title,
      startIndex: index,
      endIndex: nextHeadingIndex,
      children: [],
    };
    nodeCounter += 1;

    while (stack.length > 1) {
      const current = stack[stack.length - 1];
      if (!current || current.level < level) break;
      stack.pop();
    }

    const parent = stack[stack.length - 1];
    if (!parent) {
      throw new Error("Markdown tree stack is unexpectedly empty");
    }

    parent.node.children.push(node);
    stack.push({ level, node });
  }

  if (root.children.length === 0) {
    root.children.push({
      nodeId: "0001",
      title: input.title,
      summary: firstSentences(input.markdown, 2) || input.title,
      fullText: input.markdown,
      startIndex: 0,
      endIndex: lines.length,
      children: [],
    });
  }

  const tree: DocumentTreeInput = {
    title: input.title,
    sourceType: input.sourceType,
    metadata: input.metadata ?? {},
    nodes: root.children,
  };

  if (input.sourceId !== undefined) tree.sourceId = input.sourceId;
  if (input.fileUrl !== undefined) tree.fileUrl = input.fileUrl;

  return tree;
}

function findNextHeadingIndex(lines: string[], startIndex: number, currentLevel: number): number {
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) continue;

    const match = /^(#{1,6})\s+/.exec(line);
    const headingMarker = match?.[1];
    if (headingMarker && headingMarker.length <= currentLevel) {
      return index;
    }
  }

  return lines.length;
}
