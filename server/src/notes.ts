import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { chapterTitle, countWords, slugify, type ChapterInfo } from "./chapters.ts";
import { HttpError, isChapterFile, safePath, type Project } from "./projects.ts";

export type NoteInfo = Omit<ChapterInfo, "status">;

function notesDir(project: Project): string {
  return safePath(project.root, project.meta.notesDir);
}

function notePath(project: Project, file: string): string {
  if (!isChapterFile(file)) throw new HttpError(400, `Invalid note filename: ${file}`);
  return safePath(notesDir(project), file);
}

async function exists(p: string): Promise<boolean> {
  return stat(p).then(
    () => true,
    () => false,
  );
}

async function uniqueFilename(project: Project, title: string, exclude?: string): Promise<string> {
  const base = slugify(title);
  for (let i = 1; ; i++) {
    const name = i === 1 ? `${base}.md` : `${base}-${i}.md`;
    if (name === exclude || !(await exists(notePath(project, name)))) return name;
  }
}

export async function listNotes(project: Project): Promise<NoteInfo[]> {
  const entries = await readdir(notesDir(project), { withFileTypes: true }).catch(() => []);
  const files = entries
    .filter((e) => e.isFile() && isChapterFile(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return Promise.all(
    files.map(async (file) => {
      const content = await readFile(notePath(project, file), "utf8");
      return { file, title: chapterTitle(file, content), words: countWords(content) };
    }),
  );
}

export async function readNote(project: Project, file: string): Promise<string> {
  return readFile(notePath(project, file), "utf8");
}

export async function writeNote(project: Project, file: string, content: string): Promise<void> {
  const p = notePath(project, file);
  if (!(await exists(p))) throw new HttpError(404, `No such note: ${file}`);
  await writeFile(p, content);
}

export async function createNote(project: Project, title: string): Promise<string> {
  const clean = title.trim() || "Untitled";
  await mkdir(notesDir(project), { recursive: true });
  const file = await uniqueFilename(project, clean);
  await writeFile(notePath(project, file), `# ${clean}\n\n`);
  return file;
}

export async function renameNote(project: Project, file: string, title: string): Promise<string> {
  const clean = title.trim();
  if (!clean) throw new HttpError(400, "Title is required");
  const from = notePath(project, file);
  const content = await readFile(from, "utf8");
  const updated = /^#\s+.+$/m.test(content)
    ? content.replace(/^#\s+.+$/m, `# ${clean}`)
    : `# ${clean}\n\n${content}`;
  const next = await uniqueFilename(project, clean, file);
  await writeFile(from, updated);
  if (next !== file) await rename(from, notePath(project, next));
  return next;
}

export async function deleteNote(project: Project, file: string): Promise<void> {
  await rm(notePath(project, file));
}
