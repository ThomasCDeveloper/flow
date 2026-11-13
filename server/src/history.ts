import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { countWords, readChapter } from "./chapters.ts";
import { listNotes, readNote } from "./notes.ts";
import { HttpError, safePath, type Project } from "./projects.ts";

/**
 * Lightweight local version history, one document (chapter or note) per commit. Contents are
 * stored once per distinct version under .flow/history/objects, keyed by their SHA-256.
 */

export type DocKind = "chapter" | "note";

interface Commit {
  id: string;
  kind: DocKind;
  file: string;
  blob: string;
  /** A chapter's notes from flow.json when committed; absent when there were none. */
  notesBlob?: string;
  message: string;
  createdAt: string;
  words: number;
}

export type CommitSummary = Omit<Commit, "blob" | "notesBlob">;

export interface Comparison {
  oldContent: string;
  newContent: string;
  oldNotes: string;
  newNotes: string;
}

/** What a commit records for a document: its text, plus its notes for a chapter. */
interface DocState {
  content: string;
  notes: string;
}

export interface UncommittedDocs {
  chapters: string[];
  notes: string[];
}

export const WORKING = "working";

export function isDocKind(value: unknown): value is DocKind {
  return value === "chapter" || value === "note";
}

const historyDir = (project: Project) => safePath(project.root, ".flow", "history");
const logPath = (project: Project) => path.join(historyDir(project), "log.json");
const blobPath = (project: Project, blob: string) => {
  if (!/^[0-9a-f]{64}$/.test(blob)) throw new HttpError(500, "Corrupt history entry");
  return path.join(historyDir(project), "objects", blob);
};
const hash = (content: string) => createHash("sha256").update(content).digest("hex");

async function readLog(project: Project): Promise<Commit[]> {
  try {
    return JSON.parse(await readFile(logPath(project), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new HttpError(422, ".flow/history/log.json is not valid JSON");
  }
}

async function writeLog(project: Project, log: Commit[]): Promise<void> {
  const file = logPath(project);
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(log, null, 1) + "\n");
  await rename(tmp, file);
}

async function storeBlob(project: Project, content: string): Promise<string> {
  const blob = hash(content);
  await mkdir(path.join(historyDir(project), "objects"), { recursive: true });
  await writeFile(blobPath(project, blob), content, { flag: "wx" }).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== "EEXIST") throw e;
  });
  return blob;
}

const readBlob = (project: Project, blob: string) => readFile(blobPath(project, blob), "utf8");
const readDoc = (project: Project, kind: DocKind, file: string) =>
  kind === "chapter" ? readChapter(project, file) : readNote(project, file);

async function readState(project: Project, kind: DocKind, file: string): Promise<DocState> {
  return {
    content: await readDoc(project, kind, file),
    notes: kind === "chapter" ? (project.meta.chapterNotes[file] ?? "") : "",
  };
}

async function readCommitState(project: Project, commit: Commit | undefined): Promise<DocState> {
  if (!commit) return { content: "", notes: "" };
  return {
    content: await readBlob(project, commit.blob),
    notes: commit.notesBlob ? await readBlob(project, commit.notesBlob) : "",
  };
}

function isCommitted(commit: Commit | undefined, state: DocState): boolean {
  return (
    commit !== undefined &&
    commit.blob === hash(state.content) &&
    (commit.notesBlob ?? hash("")) === hash(state.notes)
  );
}

const summarize = ({ blob: _, notesBlob: __, ...summary }: Commit): CommitSummary => summary;
const docCommits = (log: Commit[], kind: DocKind, file: string) =>
  log.filter((c) => c.kind === kind && c.file === file);

/** Commits of one document, newest first. */
export async function listCommits(project: Project, kind: DocKind, file: string): Promise<CommitSummary[]> {
  return docCommits(await readLog(project), kind, file).map(summarize).reverse();
}

export async function createCommit(project: Project, kind: DocKind, file: string, message: string): Promise<CommitSummary> {
  const log = await readLog(project);
  const state = await readState(project, kind, file);
  if (isCommitted(docCommits(log, kind, file).at(-1), state)) {
    throw new HttpError(409, "Nothing changed since the last commit");
  }

  const commit: Commit = {
    id: randomBytes(4).toString("hex"),
    kind,
    file,
    blob: await storeBlob(project, state.content),
    ...(state.notes ? { notesBlob: await storeBlob(project, state.notes) } : {}),
    message: message.trim(),
    createdAt: new Date().toISOString(),
    words: countWords(state.content),
  };
  log.push(commit);
  await writeLog(project, log);
  return summarize(commit);
}

/** Point a document's past commits at its new filename (old name -> new name). */
export async function renameInHistory(project: Project, kind: DocKind, renames: Record<string, string>): Promise<void> {
  const log = await readLog(project);
  let changed = false;
  for (const c of log) {
    const to = c.kind === kind ? renames[c.file] : undefined;
    if (to) {
      c.file = to;
      changed = true;
    }
  }
  if (changed) await writeLog(project, log);
}

/** Documents (with their chapter notes) that differ from their latest commit, or were never committed. */
export async function uncommittedDocs(project: Project): Promise<UncommittedDocs> {
  const heads = new Map<string, Commit>();
  for (const c of await readLog(project)) heads.set(`${c.kind}:${c.file}`, c);
  const changed = async (kind: DocKind, files: string[]) => {
    const flags = await Promise.all(
      files.map(async (file) => !isCommitted(heads.get(`${kind}:${file}`), await readState(project, kind, file))),
    );
    return files.filter((_, i) => flags[i]);
  };
  return {
    chapters: await changed("chapter", project.meta.chapters),
    notes: await changed("note", (await listNotes(project)).map((n) => n.file)),
  };
}

/**
 * Compare two versions of a document. `to` is a commit id or "working" (the file on disk);
 * `from` defaults to the commit before `to`, so the default shows what that commit changed.
 */
export async function compareVersions(
  project: Project,
  kind: DocKind,
  file: string,
  to: string,
  from?: string,
): Promise<Comparison> {
  const commits = docCommits(await readLog(project), kind, file);
  const find = (id: string) => {
    const index = commits.findIndex((c) => c.id === id);
    if (index === -1) throw new HttpError(404, `No such commit: ${id}`);
    return index;
  };
  const toIndex = to === WORKING ? commits.length : find(to);
  const fromCommit = from === undefined ? commits[toIndex - 1] : commits[find(from)];
  const before = await readCommitState(project, fromCommit);
  const after = to === WORKING ? await readState(project, kind, file) : await readCommitState(project, commits[toIndex]);
  return { oldContent: before.content, newContent: after.content, oldNotes: before.notes, newNotes: after.notes };
}
