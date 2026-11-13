import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { chapterTitle, countWords, setHeading, type ChapterInfo } from "./chapters.ts";
import { HttpError, isChapterFile, newDocFilename, safePath, type Project } from "./projects.ts";

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

export async function listNotes(project: Project): Promise<NoteInfo[]> {
  const entries = await readdir(notesDir(project), { withFileTypes: true }).catch(() => []);
  const files = entries.filter((e) => e.isFile() && isChapterFile(e.name)).map((e) => e.name);
  const notes = await Promise.all(
    files.map(async (file) => {
      const content = await readFile(notePath(project, file), "utf8");
      return { file, title: chapterTitle(file, content), words: countWords(content) };
    }),
  );
  return notes.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
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
  const file = await newDocFilename(notesDir(project));
  await writeFile(notePath(project, file), `# ${clean}\n\n`);
  return file;
}

export async function renameNote(project: Project, file: string, title: string): Promise<void> {
  const clean = title.trim();
  if (!clean) throw new HttpError(400, "Title is required");
  const p = notePath(project, file);
  await writeFile(p, setHeading(await readFile(p, "utf8"), clean));
}

export async function deleteNote(project: Project, file: string): Promise<void> {
  await rm(notePath(project, file));
}
