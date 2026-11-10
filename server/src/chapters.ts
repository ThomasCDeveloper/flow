import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { HttpError, isChapterFile, safePath, writeMeta, type ChapterStatus, type Project } from "./projects.ts";

export interface ChapterInfo {
  file: string;
  title: string;
  words: number;
  status: ChapterStatus;
}

export function chapterTitle(file: string, content: string): string {
  const heading = content.match(/^#\s+(.+?)\s*#*\s*$/m);
  if (heading) return heading[1];
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

export function slugify(title: string): string {
  return (
    title
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "chapter"
  );
}

function chapterPath(project: Project, file: string): string {
  if (!isChapterFile(file)) throw new HttpError(400, `Invalid chapter filename: ${file}`);
  return safePath(project.root, project.meta.chaptersDir, file);
}

function requireChapter(project: Project, file: string): string {
  if (!project.meta.chapters.includes(file)) throw new HttpError(404, `No such chapter: ${file}`);
  return chapterPath(project, file);
}

async function exists(p: string): Promise<boolean> {
  return stat(p).then(
    () => true,
    () => false,
  );
}

async function uniqueFilename(project: Project, title: string, exclude?: string): Promise<string> {
  const prefix = String(project.meta.chapters.length + 1).padStart(2, "0");
  const base = `${prefix}-${slugify(title)}`;
  for (let i = 1; ; i++) {
    const name = i === 1 ? `${base}.md` : `${base}-${i}.md`;
    if (name === exclude) return name;
    if (!(await exists(chapterPath(project, name)))) return name;
  }
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
  const file = await uniqueFilename(project, clean);
  await writeFile(chapterPath(project, file), `# ${clean}\n\n`);
  project.meta.chapters.push(file);
  await writeMeta(project.root, project.meta);
  return file;
}

/** Change the chapter heading and rename the file to match, keeping its place in the order. */
export async function renameChapter(project: Project, file: string, title: string): Promise<string> {
  const clean = title.trim();
  if (!clean) throw new HttpError(400, "Title is required");
  const from = requireChapter(project, file);
  const content = await readFile(from, "utf8");
  const updated = /^#\s+.+$/m.test(content)
    ? content.replace(/^#\s+.+$/m, `# ${clean}`)
    : `# ${clean}\n\n${content}`;

  const prefix = file.match(/^(\d+)[-_ ]/)?.[1];
  let next = prefix ? `${prefix}-${slugify(clean)}.md` : `${slugify(clean)}.md`;
  if (next !== file && (await exists(chapterPath(project, next)))) {
    next = await uniqueFilename(project, clean, file);
  }
  const to = chapterPath(project, next);
  await writeFile(from, updated);
  if (next !== file) {
    await rename(from, to);
    project.meta.chapters = project.meta.chapters.map((c) => (c === file ? next : c));
    const notes = project.meta.chapterNotes[file];
    delete project.meta.chapterNotes[file];
    if (notes) project.meta.chapterNotes[next] = notes;
    const status = project.meta.chapterStatus[file];
    delete project.meta.chapterStatus[file];
    if (status) project.meta.chapterStatus[next] = status;
    await writeMeta(project.root, project.meta);
  }
  return next;
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
