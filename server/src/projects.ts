import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig, touchRecent } from "./config.ts";

export const CHAPTER_STATUSES = ["todo", "started", "good", "done"] as const;
export type ChapterStatus = (typeof CHAPTER_STATUSES)[number];

export function isChapterStatus(value: unknown): value is ChapterStatus {
  return CHAPTER_STATUSES.includes(value as ChapterStatus);
}

export interface ProjectMeta {
  title: string;
  author: string;
  language: string;
  identifier: string;
  /** Folder holding chapter files, relative to the project root. */
  chaptersDir: string;
  /** Chapter filenames in reading order. */
  chapters: string[];
  /** Folder holding free-form notes (never exported), relative to the project root. */
  notesDir: string;
  /** Per-chapter notes keyed by chapter filename (never exported). */
  chapterNotes: Record<string, string>;
  /** Per-chapter writing status keyed by chapter filename; missing means "todo". */
  chapterStatus: Record<string, ChapterStatus>;
  /** Cover image path relative to the project root, if any. */
  cover?: string;
}

export interface Project {
  id: string;
  root: string;
  meta: ProjectMeta;
}

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

const META_FILE = "flow.json";

export function projectId(root: string): string {
  return createHash("sha1").update(root).digest("hex").slice(0, 12);
}

/** Resolve `parts` under `root`, refusing anything that escapes it. */
export function safePath(root: string, ...parts: string[]): string {
  const resolved = path.resolve(root, ...parts);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new HttpError(400, "Path escapes project folder");
  }
  return resolved;
}

/** Generated document filenames: a random id, so files never need renaming when reordered or retitled. */
const ID_FILE = /^[0-9a-f]{8}\.md$/;

export function isIdFilename(name: string): boolean {
  return ID_FILE.test(name);
}

/** A new, unused `<id>.md` filename in `dir`. */
export async function newDocFilename(dir: string): Promise<string> {
  for (;;) {
    const name = `${randomBytes(4).toString("hex")}.md`;
    if (!(await exists(path.join(dir, name)))) return name;
  }
}

export function isChapterFile(name: string): boolean {
  return /^[^/\\]+\.md$/i.test(name) && !name.startsWith(".");
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function listMarkdown(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && isChapterFile(e.name))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  } catch {
    return [];
  }
}

export async function writeMeta(root: string, meta: ProjectMeta): Promise<void> {
  await writeFile(path.join(root, META_FILE), JSON.stringify(meta, null, 2) + "\n");
}

/**
 * Read flow.json (creating it if missing) and reconcile the chapter list with
 * what is actually on disk: drop files that vanished, append new ones.
 */
export async function loadMeta(root: string): Promise<ProjectMeta> {
  const metaPath = path.join(root, META_FILE);
  let meta: ProjectMeta;
  let dirty = false;

  if (await exists(metaPath)) {
    let raw: Partial<ProjectMeta>;
    try {
      raw = JSON.parse(await readFile(metaPath, "utf8"));
    } catch {
      throw new HttpError(422, `${META_FILE} is not valid JSON`);
    }
    meta = {
      title: raw.title ?? path.basename(root),
      author: raw.author ?? "",
      language: raw.language ?? "en",
      identifier: raw.identifier ?? `urn:uuid:${randomUUID()}`,
      chaptersDir: raw.chaptersDir ?? "chapters",
      chapters: Array.isArray(raw.chapters) ? raw.chapters.filter(isChapterFile) : [],
      notesDir: raw.notesDir ?? "notes",
      chapterNotes: raw.chapterNotes && typeof raw.chapterNotes === "object" ? raw.chapterNotes : {},
      chapterStatus: Object.fromEntries(
        Object.entries(raw.chapterStatus && typeof raw.chapterStatus === "object" ? raw.chapterStatus : {}).filter(
          ([, s]) => isChapterStatus(s) && s !== "todo",
        ),
      ),
      ...(raw.cover ? { cover: raw.cover } : {}),
    };
    dirty = !raw.identifier || !raw.chaptersDir || !raw.notesDir || !raw.chapterNotes;
  } else {
    // Existing folder of loose .md files: use them in place rather than moving them.
    const hasChaptersDir = await exists(path.join(root, "chapters"));
    const rootMd = await listMarkdown(root);
    const chaptersDir = !hasChaptersDir && rootMd.length > 0 ? "." : "chapters";
    meta = {
      title: path.basename(root),
      author: "",
      language: "en",
      identifier: `urn:uuid:${randomUUID()}`,
      chaptersDir,
      chapters: [],
      notesDir: "notes",
      chapterNotes: {},
      chapterStatus: {},
    };
    dirty = true;
  }

  const dir = safePath(root, meta.chaptersDir);
  await mkdir(dir, { recursive: true });
  const onDisk = await listMarkdown(dir);
  const onDiskSet = new Set(onDisk);
  const kept = [...new Set(meta.chapters)].filter((c) => onDiskSet.has(c));
  const keptSet = new Set(kept);
  const added = onDisk.filter((c) => !keptSet.has(c));
  if (added.length || kept.length !== meta.chapters.length) {
    meta.chapters = [...kept, ...added];
    dirty = true;
  }

  if (dirty) await writeMeta(root, meta);
  return meta;
}

export async function openProject(dir: string): Promise<Project> {
  const root = path.resolve(dir);
  const s = await stat(root).catch(() => null);
  if (!s?.isDirectory()) throw new HttpError(404, `Not a folder: ${root}`);
  const meta = await loadMeta(root);
  await touchRecent(root, meta.title);
  return { id: projectId(root), root, meta };
}

export async function createProject(
  parent: string,
  folderName: string,
  title: string,
  author: string,
): Promise<Project> {
  if (!folderName || /[/\\]/.test(folderName) || folderName.startsWith(".")) {
    throw new HttpError(400, "Invalid folder name");
  }
  const root = path.resolve(parent, folderName);
  if (await exists(root)) throw new HttpError(409, `Folder already exists: ${root}`);
  await mkdir(path.join(root, "chapters"), { recursive: true });
  await mkdir(path.join(root, "assets"), { recursive: true });
  await mkdir(path.join(root, "notes"), { recursive: true });
  const first = await newDocFilename(path.join(root, "chapters"));
  await writeFile(path.join(root, "chapters", first), "# Chapter One\n\n");
  const meta: ProjectMeta = {
    title: title || folderName,
    author,
    language: "en",
    identifier: `urn:uuid:${randomUUID()}`,
    chaptersDir: "chapters",
    chapters: [first],
    notesDir: "notes",
    chapterNotes: {},
    chapterStatus: {},
  };
  await writeMeta(root, meta);
  return openProject(root);
}

/** Look up a project by id among recently opened ones. */
export async function getProject(id: string): Promise<Project> {
  const { recent } = await loadConfig();
  const entry = recent.find((r) => projectId(r.path) === id);
  if (!entry) throw new HttpError(404, "Unknown project; open it first");
  if (!(await exists(entry.path))) throw new HttpError(404, `Project folder is gone: ${entry.path}`);
  const meta = await loadMeta(entry.path);
  return { id, root: entry.path, meta };
}

const metaLocks = new Map<string, Promise<unknown>>();

/**
 * Run `fn` with exclusive access to a project's flow.json, so concurrent requests
 * (e.g. autosaving chapter notes while reordering) don't overwrite each other.
 */
export function withProject<T>(id: string, fn: (project: Project) => Promise<T>): Promise<T> {
  const prev = metaLocks.get(id) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(async () => fn(await getProject(id)));
  metaLocks.set(id, run);
  run.finally(() => metaLocks.get(id) === run && metaLocks.delete(id)).catch(() => {});
  return run;
}
