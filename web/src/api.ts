export type ChapterStatus = "todo" | "started" | "good" | "done";

export interface ProjectMeta {
  title: string;
  author: string;
  language: string;
  identifier: string;
  chaptersDir: string;
  chapters: string[];
  notesDir: string;
  chapterNotes: Record<string, string>;
  chapterStatus: Record<string, ChapterStatus>;
  cover?: string;
}

export interface ProjectInfo {
  id: string;
  root: string;
  meta: ProjectMeta;
}

export interface RecentProject {
  id: string;
  path: string;
  title: string;
  openedAt: string;
  missing: boolean;
}

export interface DocInfo {
  file: string;
  title: string;
  words: number;
}

export interface ChapterInfo extends DocInfo {
  status: ChapterStatus;
}

export interface BrowseResult {
  path: string;
  parent: string | null;
  home: string;
  isProject: boolean;
  dirs: { name: string; isProject: boolean }[];
}

export type DocKind = "chapter" | "note";

export interface CommitSummary {
  id: string;
  kind: DocKind;
  file: string;
  message: string;
  createdAt: string;
  words: number;
}

export interface Comparison {
  oldContent: string;
  newContent: string;
  /** Chapter notes at each version (always empty for notes documents). */
  oldNotes: string;
  newNotes: string;
}

export interface FilenameMigration {
  chapters: Record<string, string>;
  notes: Record<string, string>;
}

export interface UncommittedDocs {
  chapters: string[];
  notes: string[];
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown, contentType?: string): Promise<T> {
  const headers: Record<string, string> = { "X-Flow": "1" };
  let payload: BodyInit | undefined;
  if (body instanceof Blob) {
    payload = body;
    headers["Content-Type"] = contentType ?? body.type;
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(url, { method, headers, body: payload });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `${res.status} ${res.statusText}`);
  return data as T;
}

const p = (id: string) => `/api/projects/${id}`;
const ch = (id: string, file: string) => `${p(id)}/chapters/${encodeURIComponent(file)}`;
const nt = (id: string, file: string) => `${p(id)}/notes/${encodeURIComponent(file)}`;
const hist = (id: string, kind: DocKind, file: string) => `${p(id)}/history/${kind}/${encodeURIComponent(file)}`;

export const api = {
  recent: () => request<RecentProject[]>("GET", "/api/projects"),
  open: (path: string) => request<ProjectInfo>("POST", "/api/projects", { path }),
  create: (parent: string, name: string, title: string, author: string) =>
    request<ProjectInfo>("POST", "/api/projects", { parent, name, title, author }),
  forget: (id: string) => request<{ ok: true }>("DELETE", p(id)),
  project: (id: string) => request<ProjectInfo>("GET", p(id)),
  updateMeta: (id: string, meta: Pick<ProjectMeta, "title" | "author" | "language">) =>
    request<ProjectMeta>("PUT", `${p(id)}/meta`, meta),
  setCover: (id: string, file: File) => request<ProjectMeta>("PUT", `${p(id)}/cover`, file),
  removeCover: (id: string) => request<ProjectMeta>("DELETE", `${p(id)}/cover`),
  chapters: (id: string) => request<ChapterInfo[]>("GET", `${p(id)}/chapters`),
  addChapter: (id: string, title: string) => request<{ file: string }>("POST", `${p(id)}/chapters`, { title }),
  readChapter: (id: string, file: string) => request<{ content: string; notes: string }>("GET", ch(id, file)),
  writeChapterNotes: (id: string, file: string, notes: string) =>
    request<{ ok: true }>("PUT", `${ch(id, file)}/notes`, { notes }),
  setChapterStatus: (id: string, file: string, status: ChapterStatus) =>
    request<{ ok: true }>("PUT", `${ch(id, file)}/status`, { status }),
  notes: (id: string) => request<DocInfo[]>("GET", `${p(id)}/notes`),
  addNote: (id: string, title: string) => request<{ file: string }>("POST", `${p(id)}/notes`, { title }),
  readNote: (id: string, file: string) => request<{ content: string }>("GET", nt(id, file)),
  writeNote: (id: string, file: string, content: string) => request<{ ok: true }>("PUT", nt(id, file), { content }),
  renameNote: (id: string, file: string, title: string) => request<{ file: string }>("PATCH", nt(id, file), { title }),
  deleteNote: (id: string, file: string) => request<{ ok: true }>("DELETE", nt(id, file)),
  writeChapter: (id: string, file: string, content: string) => request<{ ok: true }>("PUT", ch(id, file), { content }),
  renameChapter: (id: string, file: string, title: string) => request<{ file: string }>("PATCH", ch(id, file), { title }),
  deleteChapter: (id: string, file: string) => request<{ ok: true }>("DELETE", ch(id, file)),
  reorder: (id: string, order: string[]) => request<{ ok: true }>("POST", `${p(id)}/order`, { order }),
  history: (id: string, kind: DocKind, file: string) => request<CommitSummary[]>("GET", hist(id, kind, file)),
  commit: (id: string, kind: DocKind, file: string, message = "") =>
    request<CommitSummary>("POST", hist(id, kind, file), { message }),
  compare: (id: string, kind: DocKind, file: string, to: string, from?: string) =>
    request<Comparison>("GET", `${hist(id, kind, file)}/compare?${new URLSearchParams({ to, ...(from ? { from } : {}) })}`),
  legacyFiles: (id: string) => request<{ count: number }>("GET", `${p(id)}/legacy-files`),
  migrateFilenames: (id: string) => request<FilenameMigration>("POST", `${p(id)}/migrate-filenames`),
  uncommitted: (id: string) => request<UncommittedDocs>("GET", `${p(id)}/history/uncommitted`),
  browse: (path?: string) => request<BrowseResult>("GET", `/api/fs/browse${path ? `?path=${encodeURIComponent(path)}` : ""}`),
  coverUrl: (id: string, bust = 0) => `${p(id)}/cover?v=${bust}`,
  assetUrl: (id: string, path: string) => `${p(id)}/asset?path=${encodeURIComponent(path)}`,
  exportUrl: (id: string) => `${p(id)}/export.epub`,
};

export function countWords(markdown: string): number {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~\-|]/g, " ");
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}
