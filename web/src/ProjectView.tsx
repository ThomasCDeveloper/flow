import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import CodeMirror from "@uiw/react-codemirror";
import { Marked } from "marked";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dialogue } from "../../shared/markdown.ts";
import { api, countWords, type ChapterInfo, type ChapterStatus, type DocInfo, type ProjectInfo } from "./api";
import { Board } from "./Board";
import { DocList } from "./DocList";
import { MetaDialog } from "./MetaDialog";

type Kind = "chapter" | "note";
interface Doc {
  kind: Kind;
  file: string;
}

const AUTOSAVE_MS = 800;
export const FOCUS_SHORTCUT = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘⇧F" : "Ctrl+Shift+F";

export function isFocusShortcut(e: KeyboardEvent): boolean {
  return (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "f";
}
const proseHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontWeight: "700", fontSize: "1.4em" },
  { tag: [tags.heading2, tags.heading3, tags.heading4], fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: [tags.link, tags.url], color: "#b5532d" },
  { tag: [tags.processingInstruction, tags.contentSeparator, tags.quote], color: "#8a8478" },
  { tag: tags.monospace, fontFamily: "ui-monospace, monospace", fontSize: "0.85em" },
]);
const editorExtensions = [markdown(), EditorView.lineWrapping, syntaxHighlighting(proseHighlight)];

const docs = {
  chapter: {
    read: api.readChapter,
    write: api.writeChapter,
    add: api.addChapter,
    rename: api.renameChapter,
    remove: api.deleteChapter,
  },
  note: {
    read: async (id: string, file: string) => ({ ...(await api.readNote(id, file)), notes: "" }),
    write: api.writeNote,
    add: api.addNote,
    rename: api.renameNote,
    remove: api.deleteNote,
  },
};

function sameDoc(a: Doc | null, b: Doc | null): boolean {
  return a?.kind === b?.kind && a?.file === b?.file;
}

function headingTitle(content: string): string | null {
  return content.match(/^#\s+(.+?)\s*#*\s*$/m)?.[1] ?? null;
}

interface Props {
  projectId: string;
  onTitle: (id: string, title: string) => void;
  /** Show only the Markdown editor. */
  focus: boolean;
  onToggleFocus: () => void;
}

export function ProjectView({ projectId, onTitle, focus, onToggleFocus }: Props) {
  const [info, setInfo] = useState<ProjectInfo | null>(null);
  const [chapters, setChapters] = useState<ChapterInfo[]>([]);
  const [notesList, setNotesList] = useState<DocInfo[]>([]);
  const [current, setCurrent] = useState<Doc | null>(null);
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState("");
  const [chapterNotes, setChapterNotes] = useState("");
  const [chapterNotesSaved, setChapterNotesSaved] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(() => localStorage.getItem("flow.preview") === "1");
  const [notesOpen, setNotesOpen] = useState(() => localStorage.getItem("flow.chapterNotesOpen") === "1");
  const [showMeta, setShowMeta] = useState(false);
  const [view, setView] = useState<"editor" | "board">(() =>
    localStorage.getItem("flow.view") === "board" ? "board" : "editor",
  );

  // Latest values for async callbacks (autosave, unmount, beforeunload).
  const live = useRef({ current, content, saved, chapterNotes, chapterNotesSaved });
  live.current = { current, content, saved, chapterNotes, chapterNotesSaved };
  const saveChain = useRef<Promise<boolean>>(Promise.resolve(true));

  const dirty = content !== saved || chapterNotes !== chapterNotesSaved;
  const fail = (e: unknown) => setError((e as Error).message);

  /** Save the open document (and its chapter notes) if changed. Resolves to false on failure. */
  const flush = useCallback((): Promise<boolean> => {
    saveChain.current = saveChain.current.then(async () => {
      const { current: doc, content: text, saved: last, chapterNotes: notes, chapterNotesSaved: notesLast } = live.current;
      if (!doc || (text === last && notes === notesLast)) return true;
      setSaving(true);
      try {
        if (text !== last) await docs[doc.kind].write(projectId, doc.file, text);
        if (doc.kind === "chapter" && notes !== notesLast) await api.writeChapterNotes(projectId, doc.file, notes);
        if (sameDoc(live.current.current, doc)) {
          live.current.saved = text;
          live.current.chapterNotesSaved = notes;
          setSaved(text);
          setChapterNotesSaved(notes);
        }
        const update = <T extends DocInfo>(list: T[]) =>
          list.map((c) => (c.file === doc.file ? { ...c, words: countWords(text), title: headingTitle(text) ?? c.title } : c));
        if (doc.kind === "chapter") setChapters(update);
        else setNotesList(update);
        setSaveFailed(false);
        return true;
      } catch (e) {
        setSaveFailed(true);
        fail(e);
        return false;
      } finally {
        setSaving(false);
      }
    });
    return saveChain.current;
  }, [projectId]);

  const loadDoc = useCallback(
    async (doc: Doc | null) => {
      const { content: text, notes } = doc ? await docs[doc.kind].read(projectId, doc.file) : { content: "", notes: "" };
      live.current = { current: doc, content: text, saved: text, chapterNotes: notes, chapterNotesSaved: notes };
      setCurrent(doc);
      setContent(text);
      setSaved(text);
      setChapterNotes(notes);
      setChapterNotesSaved(notes);
      setSaveFailed(false);
    },
    [projectId],
  );

  const reloadChapters = useCallback(async () => {
    const list = await api.chapters(projectId);
    setChapters(list);
    return list;
  }, [projectId]);

  const reloadNotes = useCallback(async () => {
    const list = await api.notes(projectId);
    setNotesList(list);
    return list;
  }, [projectId]);

  useEffect(() => {
    (async () => {
      try {
        const p = await api.project(projectId);
        setInfo(p);
        onTitle(projectId, p.meta.title);
        const [list] = await Promise.all([reloadChapters(), reloadNotes()]);
        await loadDoc(list[0] ? { kind: "chapter", file: list[0].file } : null);
      } catch (e) {
        fail(e);
      }
    })();
  }, [projectId, onTitle, reloadChapters, reloadNotes, loadDoc]);

  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(flush, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [content, chapterNotes, dirty, flush]);

  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      const l = live.current;
      if (l.content !== l.saved || l.chapterNotes !== l.chapterNotesSaved) {
        flush();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      flush();
    };
  }, [flush]);

  const listOf = (kind: Kind) => (kind === "chapter" ? chapters : notesList);
  const reloadOf = (kind: Kind) => (kind === "chapter" ? reloadChapters : reloadNotes);

  const showView = (next: "editor" | "board") => {
    setView(next);
    localStorage.setItem("flow.view", next);
  };

  const select = async (doc: Doc) => {
    showView("editor");
    if (sameDoc(doc, current)) return;
    const ok = await flush();
    if (!ok && !confirm("The current document could not be saved. Switch anyway and lose the changes?")) return;
    loadDoc(doc).catch(fail);
  };

  const add = async (kind: Kind, title: string) => {
    try {
      await flush();
      const { file } = await docs[kind].add(projectId, title);
      await reloadOf(kind)();
      await loadDoc({ kind, file });
    } catch (e) {
      fail(e);
    }
  };

  const rename = async (kind: Kind, file: string, title: string) => {
    try {
      await flush();
      const { file: next } = await docs[kind].rename(projectId, file, title);
      await reloadOf(kind)();
      if (sameDoc(current, { kind, file })) await loadDoc({ kind, file: next });
    } catch (e) {
      fail(e);
    }
  };

  const remove = async (kind: Kind, file: string) => {
    const list = listOf(kind);
    const item = list.find((x) => x.file === file);
    if (!confirm(`Delete "${item?.title ?? file}"? The file will be removed from disk.`)) return;
    const isCurrent = sameDoc(current, { kind, file });
    try {
      if (isCurrent) {
        // Discard pending edits so autosave doesn't write to the deleted file.
        const l = live.current;
        l.saved = l.content;
        l.chapterNotesSaved = l.chapterNotes;
        setSaved(l.content);
        setChapterNotesSaved(l.chapterNotes);
      } else {
        await flush();
      }
      await docs[kind].remove(projectId, file);
      const next = await reloadOf(kind)();
      if (isCurrent) {
        const idx = list.findIndex((x) => x.file === file);
        const neighbour = next[Math.min(idx, next.length - 1)];
        await loadDoc(neighbour ? { kind, file: neighbour.file } : null);
      }
    } catch (e) {
      fail(e);
    }
  };

  const reorder = async (from: number, to: number) => {
    const next = [...chapters];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setChapters(next);
    try {
      await api.reorder(projectId, next.map((c) => c.file));
    } catch (e) {
      fail(e);
      reloadChapters();
    }
  };

  const moveChapter = async (file: string, status: ChapterStatus) => {
    setChapters((list) => list.map((c) => (c.file === file ? { ...c, status } : c)));
    try {
      await api.setChapterStatus(projectId, file, status);
    } catch (e) {
      fail(e);
      reloadChapters();
    }
  };

  const exportEpub = async () => {
    await flush();
    const a = document.createElement("a");
    a.href = api.exportUrl(projectId);
    a.download = "";
    a.click();
  };

  const toggleNotes = () => {
    setNotesOpen((open) => {
      localStorage.setItem("flow.chapterNotesOpen", open ? "0" : "1");
      return !open;
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      flush();
    }
  };

  const onPreviewClick = (e: React.MouseEvent) => {
    const link = (e.target as HTMLElement).closest("a");
    const href = link?.getAttribute("href");
    if (!href || href.startsWith("#")) return;
    e.preventDefault();
    if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(href)) {
      window.open(href, "_blank", "noopener");
      return;
    }
    const target = decodeURIComponent(href.split("#")[0]).split("/").pop();
    if (!target) return;
    if (chapters.some((c) => c.file === target)) select({ kind: "chapter", file: target });
    else if (notesList.some((c) => c.file === target)) select({ kind: "note", file: target });
  };

  const baseDir = current?.kind === "note" ? info?.meta.notesDir : info?.meta.chaptersDir;
  const previewHtml = useMemo(() => {
    if (!preview || focus || !baseDir) return "";
    const md = new Marked(
      {
        gfm: true,
        walkTokens(token) {
          if (token.type === "image" && !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(token.href)) {
            token.href = api.assetUrl(projectId, `${baseDir}/${decodeURIComponent(token.href)}`);
          }
        },
      },
      dialogue,
    );
    return md.parse(content, { async: false }) as string;
  }, [preview, focus, content, baseDir, projectId]);

  const docWords = useMemo(() => countWords(content), [content]);
  const bookWords = chapters.reduce(
    (sum, c) => sum + (current?.kind === "chapter" && c.file === current.file ? docWords : c.words),
    0,
  );

  if (!info) {
    return <div className="project-loading">{error ? <div className="error">{error}</div> : "Loading…"}</div>;
  }

  const status = saveFailed ? "error" : saving ? "saving" : dirty ? "unsaved" : "saved";
  const dir = current?.kind === "note" ? info.meta.notesDir : info.meta.chaptersDir;
  const shown = focus ? "editor" : view;
  const split = preview && !focus;

  return (
    <div className={`project ${focus ? "focus" : ""}`} onKeyDown={onKeyDown}>
      <aside className="sidebar">
        <div className="sidebar-head">
          <button className="book-title" title={info.root} onClick={() => setShowMeta(true)}>
            <strong>{info.meta.title}</strong>
            <span className="muted">{info.meta.author || "Edit book details"}</span>
          </button>
        </div>
        <div className="sidebar-scroll">
          <section className="sidebar-section">
            <h3>Chapters</h3>
            <DocList
              items={chapters}
              activeFile={current?.kind === "chapter" ? current.file : null}
              activeWords={docWords}
              numbered
              addLabel="+ New chapter"
              addPlaceholder="Chapter title"
              onSelect={(file) => select({ kind: "chapter", file })}
              onAdd={(title) => add("chapter", title)}
              onRename={(file, title) => rename("chapter", file, title)}
              onDelete={(file) => remove("chapter", file)}
              onReorder={reorder}
            />
          </section>
          <section className="sidebar-section notes-section">
            <h3>
              Notes <span className="muted">not exported</span>
            </h3>
            <DocList
              items={notesList}
              activeFile={current?.kind === "note" ? current.file : null}
              activeWords={docWords}
              addLabel="+ New note"
              addPlaceholder="Note title"
              onSelect={(file) => select({ kind: "note", file })}
              onAdd={(title) => add("note", title)}
              onRename={(file, title) => rename("note", file, title)}
              onDelete={(file) => remove("note", file)}
            />
          </section>
        </div>
        <div className="sidebar-foot">
          <button className="primary wide" onClick={exportEpub} disabled={chapters.length === 0}>
            Export EPUB
          </button>
        </div>
      </aside>

      <section className="editor-pane">
        <div className="toolbar">
          {view === "board" ? (
            <span className="muted file-name">Chapter board</span>
          ) : (
            <>
              {current?.kind === "note" && <span className="badge">note</span>}
              <span className="muted file-name">{current ? `${dir}/${current.file}` : "Nothing open"}</span>
            </>
          )}
          <button
            className={`small ${view === "board" ? "primary" : ""}`}
            title={view === "board" ? "Back to the editor" : "Show chapters by writing status"}
            onClick={() => showView(view === "board" ? "editor" : "board")}
          >
            Board
          </button>
          <label className="toggle" hidden={view === "board"}>
            <input
              type="checkbox"
              checked={preview}
              onChange={(e) => {
                setPreview(e.target.checked);
                localStorage.setItem("flow.preview", e.target.checked ? "1" : "0");
              }}
            />
            Preview
          </label>
          <button className="small" title={`Hide everything but the editor (${FOCUS_SHORTCUT})`} onClick={onToggleFocus}>
            Focus
          </button>
        </div>
        {error && (
          <div className="error" onClick={() => setError("")} title="Click to dismiss">
            {error}
          </div>
        )}
        {shown === "board" && (
          <Board
            chapters={chapters}
            activeFile={current?.kind === "chapter" ? current.file : null}
            activeWords={docWords}
            onOpen={(file) => select({ kind: "chapter", file })}
            onMove={moveChapter}
          />
        )}
        {shown === "editor" && !focus && current?.kind === "chapter" && (
          <div className={`chapter-notes ${notesOpen ? "open" : ""}`}>
            <button className="chapter-notes-toggle" onClick={toggleNotes}>
              <span className="chevron">{notesOpen ? "▾" : "▸"}</span>
              Chapter notes
              {!notesOpen && chapterNotes.trim() && <span className="notes-dot" title="This chapter has notes" />}
              <span className="muted">not exported</span>
            </button>
            {notesOpen && (
              <textarea
                className="chapter-notes-text"
                placeholder="Plot points, reminders, things to fix in this chapter…"
                value={chapterNotes}
                onChange={(e) => setChapterNotes(e.target.value)}
                rows={4}
              />
            )}
          </div>
        )}
        <div className={`editor-body ${split ? "split" : ""}`} hidden={shown === "board"}>
          {current ? (
            <>
              <div className="editor">
                <CodeMirror
                  key={`${current.kind}:${current.file}`}
                  value={content}
                  onChange={setContent}
                  extensions={editorExtensions}
                  basicSetup={{
                    lineNumbers: false,
                    foldGutter: false,
                    highlightActiveLine: false,
                    highlightActiveLineGutter: false,
                    syntaxHighlighting: false,
                  }}
                  autoFocus
                  height="100%"
                />
              </div>
              {split && (
                <article
                  className="preview prose"
                  lang={info.meta.language}
                  onClick={onPreviewClick}
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              )}
            </>
          ) : (
            <div className="empty muted">
              {chapters.length === 0 ? "No chapters yet. Add one from the sidebar." : "Select a chapter or note."}
            </div>
          )}
        </div>
        <footer className="status-bar">
          <span>
            {docWords.toLocaleString()} words in {current?.kind === "note" ? "note" : "chapter"}
          </span>
          <span>{bookWords.toLocaleString()} words in book</span>
          <span className="grow" />
          <span className={`save-status ${status}`}>
            {{ saved: "Saved", unsaved: "Unsaved changes", saving: "Saving…", error: "Save failed" }[status]}
          </span>
        </footer>
      </section>

      {showMeta && (
        <MetaDialog
          project={info}
          onClose={() => setShowMeta(false)}
          onSaved={(meta) => {
            setInfo({ ...info, meta });
            onTitle(projectId, meta.title);
          }}
        />
      )}
    </div>
  );
}
