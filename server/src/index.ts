import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, removeRecent, touchRecent } from "./config.ts";
import {
  createChapter,
  deleteChapter,
  listChapters,
  readChapter,
  renameChapter,
  reorderChapters,
  writeChapter,
  writeChapterNotes,
  writeChapterStatus,
} from "./chapters.ts";
import { buildEpub, epubFilename } from "./epub.ts";
import { createNote, deleteNote, listNotes, readNote, renameNote, writeNote } from "./notes.ts";
import {
  HttpError,
  createProject,
  getProject,
  isChapterStatus,
  openProject,
  projectId,
  safePath,
  withProject,
  writeMeta,
} from "./projects.ts";

const PORT = Number(process.env.PORT ?? 4321);
const HOST = "127.0.0.1";
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, "localhost:5173", "127.0.0.1:5173"]);

const IMAGE_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "warn" }, bodyLimit: 25 * 1024 * 1024 });

app.addContentTypeParser(/^image\//, { parseAs: "buffer" }, (_req, body, done) => done(null, body));

// Only answer requests addressed to localhost (blocks DNS rebinding), and require a custom
// header on writes so other websites can't post to the API without a CORS preflight.
app.addHook("onRequest", async (req, reply) => {
  if (!ALLOWED_HOSTS.has(req.headers.host ?? "")) {
    return reply.code(403).send({ error: "Forbidden host" });
  }
  if (req.method !== "GET" && req.method !== "HEAD" && req.headers["x-flow"] !== "1") {
    return reply.code(403).send({ error: "Missing X-Flow header" });
  }
});

app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, _req, reply) => {
  if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
  if (err.code === "ENOENT") return reply.code(404).send({ error: "File not found" });
  if (err.code === "EACCES" || err.code === "EPERM") return reply.code(403).send({ error: "Permission denied" });
  if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
  app.log.error(err);
  return reply.code(500).send({ error: err.message || "Internal error" });
});

type IdParams = { Params: { id: string } };
type FileParams = { Params: { id: string; file: string } };

function body<T>(req: FastifyRequest): Partial<T> {
  return (req.body && typeof req.body === "object" ? req.body : {}) as Partial<T>;
}

function expandHome(p: string): string {
  return p === "~" || p.startsWith("~/") ? path.join(homedir(), p.slice(1)) : p;
}

// ---- projects ----

app.get("/api/projects", async () => {
  const { recent } = await loadConfig();
  return recent.map((r) => ({ ...r, id: projectId(r.path), missing: !existsSync(r.path) }));
});

app.post("/api/projects", async (req) => {
  const b = body<{ path: string; parent: string; name: string; title: string; author: string }>(req);
  if (b.parent !== undefined) {
    const project = await createProject(path.resolve(expandHome(b.parent)), (b.name ?? "").trim(), (b.title ?? "").trim(), (b.author ?? "").trim());
    return { id: project.id, root: project.root, meta: project.meta };
  }
  if (!b.path) throw new HttpError(400, "path is required");
  const project = await openProject(expandHome(b.path));
  return { id: project.id, root: project.root, meta: project.meta };
});

app.delete<IdParams>("/api/projects/:id", async (req) => {
  const { recent } = await loadConfig();
  const entry = recent.find((r) => projectId(r.path) === req.params.id);
  if (entry) await removeRecent(entry.path);
  return { ok: true };
});

app.get<IdParams>("/api/projects/:id", async (req) => {
  const project = await getProject(req.params.id);
  return { id: project.id, root: project.root, meta: project.meta };
});

app.put<IdParams>("/api/projects/:id/meta", async (req) => {
  const b = body<{ title: string; author: string; language: string }>(req);
  return withProject(req.params.id, async (project) => {
    if (typeof b.title === "string" && b.title.trim()) project.meta.title = b.title.trim();
    if (typeof b.author === "string") project.meta.author = b.author.trim();
    if (typeof b.language === "string" && b.language.trim()) project.meta.language = b.language.trim();
    await writeMeta(project.root, project.meta);
    await touchRecent(project.root, project.meta.title);
    return project.meta;
  });
});

app.put<IdParams>("/api/projects/:id/cover", async (req) => {
  const type = String(req.headers["content-type"] ?? "").split(";")[0];
  const ext = Object.entries(IMAGE_TYPES).find(([e, t]) => t === type && e !== ".jpeg" && e !== ".svg")?.[0];
  if (!ext || !Buffer.isBuffer(req.body)) throw new HttpError(415, "Cover must be a JPEG, PNG, GIF or WebP image");
  const data = req.body;
  return withProject(req.params.id, async (project) => {
    if (project.meta.cover) await rm(safePath(project.root, project.meta.cover), { force: true });
    await mkdir(path.join(project.root, "assets"), { recursive: true });
    const rel = `assets/cover${ext}`;
    await writeFile(safePath(project.root, rel), data);
    project.meta.cover = rel;
    await writeMeta(project.root, project.meta);
    return project.meta;
  });
});

app.delete<IdParams>("/api/projects/:id/cover", async (req) => {
  return withProject(req.params.id, async (project) => {
    if (project.meta.cover) await rm(safePath(project.root, project.meta.cover), { force: true });
    delete project.meta.cover;
    await writeMeta(project.root, project.meta);
    return project.meta;
  });
});

async function sendImage(reply: FastifyReply, file: string) {
  const type = IMAGE_TYPES[path.extname(file).toLowerCase()];
  if (!type) throw new HttpError(415, "Not an image");
  reply.header("cache-control", "no-cache");
  return reply.type(type).send(await readFile(file));
}

app.get<IdParams>("/api/projects/:id/cover", async (req, reply) => {
  const project = await getProject(req.params.id);
  if (!project.meta.cover) throw new HttpError(404, "No cover");
  return sendImage(reply, safePath(project.root, project.meta.cover));
});

app.get<IdParams & { Querystring: { path?: string } }>("/api/projects/:id/asset", async (req, reply) => {
  const project = await getProject(req.params.id);
  if (!req.query.path) throw new HttpError(400, "path is required");
  return sendImage(reply, safePath(project.root, req.query.path));
});

app.get<IdParams>("/api/projects/:id/export.epub", async (req, reply) => {
  const project = await getProject(req.params.id);
  const data = await buildEpub(project);
  return reply
    .type("application/epub+zip")
    .header("content-disposition", `attachment; filename="${epubFilename(project.meta.title)}"`)
    .send(data);
});

// ---- chapters ----

app.get<IdParams>("/api/projects/:id/chapters", async (req) => {
  return listChapters(await getProject(req.params.id));
});

app.post<IdParams>("/api/projects/:id/chapters", async (req) => {
  const title = body<{ title: string }>(req).title ?? "";
  return withProject(req.params.id, async (project) => ({ file: await createChapter(project, title) }));
});

app.post<IdParams>("/api/projects/:id/order", async (req) => {
  const order = body<{ order: string[] }>(req).order;
  if (!Array.isArray(order)) throw new HttpError(400, "order must be an array");
  await withProject(req.params.id, (project) => reorderChapters(project, order));
  return { ok: true };
});

app.get<FileParams>("/api/projects/:id/chapters/:file", async (req) => {
  const project = await getProject(req.params.id);
  return {
    file: req.params.file,
    content: await readChapter(project, req.params.file),
    notes: project.meta.chapterNotes[req.params.file] ?? "",
  };
});

app.put<FileParams>("/api/projects/:id/chapters/:file/notes", async (req) => {
  const notes = body<{ notes: string }>(req).notes;
  if (typeof notes !== "string") throw new HttpError(400, "notes must be a string");
  await withProject(req.params.id, (project) => writeChapterNotes(project, req.params.file, notes));
  return { ok: true };
});

app.put<FileParams>("/api/projects/:id/chapters/:file/status", async (req) => {
  const status = body<{ status: string }>(req).status;
  if (!isChapterStatus(status)) throw new HttpError(400, "status must be one of todo, started, good, done");
  await withProject(req.params.id, (project) => writeChapterStatus(project, req.params.file, status));
  return { ok: true };
});

app.put<FileParams>("/api/projects/:id/chapters/:file", async (req) => {
  const content = body<{ content: string }>(req).content;
  if (typeof content !== "string") throw new HttpError(400, "content must be a string");
  await writeChapter(await getProject(req.params.id), req.params.file, content);
  return { ok: true };
});

app.patch<FileParams>("/api/projects/:id/chapters/:file", async (req) => {
  const title = body<{ title: string }>(req).title ?? "";
  return withProject(req.params.id, async (project) => ({
    file: await renameChapter(project, req.params.file, title),
  }));
});

app.delete<FileParams>("/api/projects/:id/chapters/:file", async (req) => {
  await withProject(req.params.id, (project) => deleteChapter(project, req.params.file));
  return { ok: true };
});

// ---- notes (never exported) ----

app.get<IdParams>("/api/projects/:id/notes", async (req) => {
  return listNotes(await getProject(req.params.id));
});

app.post<IdParams>("/api/projects/:id/notes", async (req) => {
  const project = await getProject(req.params.id);
  return { file: await createNote(project, body<{ title: string }>(req).title ?? "") };
});

app.get<FileParams>("/api/projects/:id/notes/:file", async (req) => {
  const project = await getProject(req.params.id);
  return { file: req.params.file, content: await readNote(project, req.params.file) };
});

app.put<FileParams>("/api/projects/:id/notes/:file", async (req) => {
  const content = body<{ content: string }>(req).content;
  if (typeof content !== "string") throw new HttpError(400, "content must be a string");
  await writeNote(await getProject(req.params.id), req.params.file, content);
  return { ok: true };
});

app.patch<FileParams>("/api/projects/:id/notes/:file", async (req) => {
  const project = await getProject(req.params.id);
  return { file: await renameNote(project, req.params.file, body<{ title: string }>(req).title ?? "") };
});

app.delete<FileParams>("/api/projects/:id/notes/:file", async (req) => {
  await deleteNote(await getProject(req.params.id), req.params.file);
  return { ok: true };
});

// ---- folder browser ----

app.get<{ Querystring: { path?: string } }>("/api/fs/browse", async (req) => {
  const dir = path.resolve(expandHome(req.query.path || homedir()));
  const s = await stat(dir).catch(() => null);
  if (!s?.isDirectory()) throw new HttpError(404, `Not a folder: ${dir}`);
  const entries = await readdir(dir, { withFileTypes: true });
  const dirs = await Promise.all(
    entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(async (e) => ({
        name: e.name,
        isProject: existsSync(path.join(dir, e.name, "flow.json")),
      })),
  );
  const parent = path.dirname(dir);
  return {
    path: dir,
    parent: parent === dir ? null : parent,
    home: homedir(),
    isProject: existsSync(path.join(dir, "flow.json")),
    dirs,
  };
});

// ---- web UI (production build) ----

const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
}

await app.listen({ port: PORT, host: HOST });
console.log(`flow running at http://localhost:${PORT}`);
