import "dotenv/config";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import { prisma } from "../lib/prisma.js";
import { buildMarkdownDocumentTree } from "../features/embeddings/services/chunker.service.js";
import { storeDocumentTree } from "../features/embeddings/services/document-tree-indexer.service.js";
import type { DocumentSourceType } from "../features/embeddings/types/embeddings.types.js";

const DEFAULT_DOC_DIRS = ["docs", "documentation", "../frontend/docs"];

interface MarkdownFile {
  absolutePath: string;
  relativePath: string;
}

async function main(): Promise<void> {
  const requestedPaths = process.argv.slice(2);
  const roots = requestedPaths.length > 0 ? requestedPaths : DEFAULT_DOC_DIRS;
  const files = await collectMarkdownFiles(roots.map((root) => resolve(process.cwd(), root)));

  let indexed = 0;
  for (const file of files) {
    const markdown = await readFile(file.absolutePath, "utf8");
    const title = extractTitle(markdown) ?? titleFromPath(file.absolutePath);
    const sourceType = inferDocumentSourceType(file.absolutePath, markdown);
    const tree = buildMarkdownDocumentTree({
      title,
      sourceType,
      sourceId: file.relativePath,
      fileUrl: file.relativePath,
      markdown,
      metadata: {
        path: file.relativePath,
      },
    });

    await storeDocumentTree(tree);
    indexed += 1;
  }

  console.info(`Indexed ${indexed} markdown document(s) into PageIndex trees.`);
}

async function collectMarkdownFiles(roots: string[]): Promise<MarkdownFile[]> {
  const files: MarkdownFile[] = [];

  for (const root of roots) {
    if (!(await pathExists(root))) continue;
    const rootStat = await stat(root);
    if (rootStat.isFile() && extname(root).toLowerCase() === ".md") {
      files.push({ absolutePath: root, relativePath: relative(process.cwd(), root) });
      continue;
    }

    if (rootStat.isDirectory()) {
      files.push(...await collectMarkdownFilesFromDirectory(root));
    }
  }

  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function collectMarkdownFilesFromDirectory(directory: string): Promise<MarkdownFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: MarkdownFile[] = [];

  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectMarkdownFilesFromDirectory(absolutePath));
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") {
      files.push({ absolutePath, relativePath: relative(process.cwd(), absolutePath) });
    }
  }

  return files;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function extractTitle(markdown: string): string | null {
  const match = /^#\s+(.+)$/m.exec(markdown);
  return match?.[1]?.trim() || null;
}

function titleFromPath(path: string): string {
  return basename(path, extname(path)).replace(/[-_]+/g, " ");
}

function inferDocumentSourceType(path: string, markdown: string): DocumentSourceType {
  const haystack = `${path}\n${markdown.slice(0, 500)}`.toLowerCase();

  if (haystack.includes("datasheet")) return "datasheet";
  if (haystack.includes("manual")) return "manual";
  if (haystack.includes("policy") || haystack.includes("privacy") || haystack.includes("refund")) return "policy";
  if (haystack.includes("tutorial") || haystack.includes("guide") || haystack.includes("quickstart")) return "tutorial";
  if (haystack.includes("project")) return "project_report";
  return "course_material";
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown document indexing failure";
    console.error(`Document indexing failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
