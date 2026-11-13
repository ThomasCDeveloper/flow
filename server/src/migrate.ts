import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { renameInHistory } from "./history.ts";
import { isChapterFile, isIdFilename, newDocFilename, safePath, writeMeta, type Project } from "./projects.ts";

/**
 * One-time move from descriptive filenames ("01-intro.md") to id filenames, for books
 * created before ids were introduced. Reading order, chapter notes, statuses, history and
 * links between documents all follow the new names.
 */

export interface FilenameMigration {
  chapters: Record<string, string>;
  notes: Record<string, string>;
}

async function legacyNotes(project: Project): Promise<string[]> {
  const entries = await readdir(safePath(project.root, project.meta.notesDir), { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isFile() && isChapterFile(e.name) && !isIdFilename(e.name)).map((e) => e.name);
}

export async function legacyFileCount(project: Project): Promise<number> {
  return project.meta.chapters.filter((f) => !isIdFilename(f)).length + (await legacyNotes(project)).length;
}

/** Point Markdown links like `[next](02-storm.md#scene)` or `(../notes/cast.md)` at the renamed files. */
export function rewriteLinks(markdown: string, migration: FilenameMigration, notesDir: string): string {
  return markdown.replace(/(\]\()([^)\s]*?)([^/()\s]+\.md)(#[^)\s]*)?(\s+"[^"]*")?\)/gi, (match, open, dir, name, frag = "", title = "") => {
    if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(dir)) return match;
    let decoded: string;
    try {
      decoded = decodeURIComponent(name);
    } catch {
      return match;
    }
    const inNotes = dir.split("/").includes(path.basename(notesDir));
    const renamed =
      (inNotes ? migration.notes[decoded] : migration.chapters[decoded]) ??
      migration.chapters[decoded] ??
      migration.notes[decoded];
    return renamed ? `${open}${dir}${renamed}${frag}${title})` : match;
  });
}

/**
 * Rename every non-id chapter and note. New files are written before old ones are removed,
 * so an interruption can leave duplicates but never loses text.
 */
export async function migrateFilenames(project: Project): Promise<FilenameMigration> {
  const chaptersDir = safePath(project.root, project.meta.chaptersDir);
  const notesDir = safePath(project.root, project.meta.notesDir);
  const migration: FilenameMigration = { chapters: {}, notes: {} };
  const files: { dir: string; from: string; to: string }[] = [];

  const plan = async (dir: string, names: string[], map: Record<string, string>) => {
    for (const from of names) {
      let to = await newDocFilename(dir);
      while (files.some((f) => f.dir === dir && f.to === to)) to = await newDocFilename(dir);
      map[from] = to;
      files.push({ dir, from, to });
    }
  };
  await plan(chaptersDir, project.meta.chapters.filter((f) => !isIdFilename(f)), migration.chapters);
  await plan(notesDir, await legacyNotes(project), migration.notes);
  if (files.length === 0) return migration;

  // Every document may link to a renamed one, so rewrite links everywhere, renamed or not.
  const allNotes = (await readdir(notesDir, { withFileTypes: true }).catch(() => []))
    .filter((e) => e.isFile() && isChapterFile(e.name))
    .map((e) => e.name);
  const docs = [
    ...project.meta.chapters.map((name) => ({ dir: chaptersDir, name, map: migration.chapters })),
    ...allNotes.map((name) => ({ dir: notesDir, name, map: migration.notes })),
  ];
  for (const doc of docs) {
    const content = await readFile(path.join(doc.dir, doc.name), "utf8");
    const updated = rewriteLinks(content, migration, project.meta.notesDir);
    const target = doc.map[doc.name] ?? doc.name;
    if (target !== doc.name || updated !== content) await writeFile(path.join(doc.dir, target), updated);
  }

  const rekey = <T>(record: Record<string, T>) =>
    Object.fromEntries(Object.entries(record).map(([file, value]) => [migration.chapters[file] ?? file, value]));
  project.meta.chapters = project.meta.chapters.map((f) => migration.chapters[f] ?? f);
  project.meta.chapterNotes = rekey(project.meta.chapterNotes);
  project.meta.chapterStatus = rekey(project.meta.chapterStatus);
  await writeMeta(project.root, project.meta);
  await renameInHistory(project, "chapter", migration.chapters);
  await renameInHistory(project, "note", migration.notes);

  for (const { dir, from } of files) await rm(path.join(dir, from));
  return migration;
}
