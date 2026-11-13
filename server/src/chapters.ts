import { readFile, rm, writeFile } from "node:fs/promises";
import {
  HttpError,
  isChapterFile,
  isIdFilename,
  newDocFilename,
  safePath,
  writeMeta,
  type ChapterStatus,
  type Project,
} from "./projects.ts";

export interface ChapterInfo {
  file: string;
  title: string;
  words: number;
  status: ChapterStatus;
}

export function chapterTitle(file: string, content: string): string {
  const heading = content.match(/^#\s+(.+?)\s*#*\s*$/m);
  if (heading) return heading[1];
  if (isIdFilename(file)) return "Untitled";
  return file
    .replace(/\.md$/i, "")
    .replace(/^\d+[-_ ]*/, "")
    .replace(/[-_]+/g, " ")
    .trim() || file;
}

export function countWords(markdown: string): number {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~\-|]/g, " ");
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

function chapterPath(project: Project, file: string): string {
  if (!isChapterFile(file)) throw new HttpError(400, `Invalid chapter filename: ${file}`);
  return safePath(project.root, project.meta.chaptersDir, file);
}

function requireChapter(project: Project, file: string): string {
  if (!project.meta.chapters.includes(file)) throw new HttpError(404, `No such chapter: ${file}`);
  return chapterPath(project, file);
}

export async function listChapters(project: Project): Promise<ChapterInfo[]> {
  return Promise.all(
    project.meta.chapters.map(async (file) => {
      const content = await readFile(chapterPath(project, file), "utf8");
      return {
        file,
        title: chapterTitle(file, content),
        words: countWords(content),
        status: project.meta.chapterStatus[file] ?? "todo",
      };
    }),
  );
}

export async function readChapter(project: Project, file: string): Promise<string> {
  return readFile(requireChapter(project, file), "utf8");
}

export async function writeChapter(project: Project, file: string, content: string): Promise<void> {
  await writeFile(requireChapter(project, file), content);
}

export async function createChapter(project: Project, title: string): Promise<string> {
  const clean = title.trim() || "Untitled";
  const file = await newDocFilename(safePath(project.root, project.meta.chaptersDir));
  await writeFile(chapterPath(project, file), `# ${clean}\n\n`);
  project.meta.chapters.push(file);
  await writeMeta(project.root, project.meta);
  return file;
}

/** Change the chapter's `# heading`. The filename never changes, so links and history stay valid. */
export async function renameChapter(project: Project, file: string, title: string): Promise<void> {
  const clean = title.trim();
  if (!clean) throw new HttpError(400, "Title is required");
  const p = requireChapter(project, file);
  await writeFile(p, setHeading(await readFile(p, "utf8"), clean));
}

export function setHeading(content: string, title: string): string {
  return /^#\s+.+$/m.test(content) ? content.replace(/^#\s+.+$/m, `# ${title}`) : `# ${title}\n\n${content}`;
}

export async function deleteChapter(project: Project, file: string): Promise<void> {
  await rm(requireChapter(project, file));
  project.meta.chapters = project.meta.chapters.filter((c) => c !== file);
  delete project.meta.chapterNotes[file];
  delete project.meta.chapterStatus[file];
  await writeMeta(project.root, project.meta);
}

export async function writeChapterNotes(project: Project, file: string, notes: string): Promise<void> {
  requireChapter(project, file);
  if (notes.trim()) project.meta.chapterNotes[file] = notes;
  else delete project.meta.chapterNotes[file];
  await writeMeta(project.root, project.meta);
}

export async function writeChapterStatus(project: Project, file: string, status: ChapterStatus): Promise<void> {
  requireChapter(project, file);
  if (status === "todo") delete project.meta.chapterStatus[file];
  else project.meta.chapterStatus[file] = status;
  await writeMeta(project.root, project.meta);
}

export async function reorderChapters(project: Project, order: string[]): Promise<void> {
  const current = new Set(project.meta.chapters);
  if (order.length !== current.size || new Set(order).size !== order.length || !order.every((c) => current.has(c))) {
    throw new HttpError(400, "Order must contain every chapter exactly once");
  }
  project.meta.chapters = order;
  await writeMeta(project.root, project.meta);
}
