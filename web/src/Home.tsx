import { useEffect, useState } from "react";
import { api, type ProjectInfo, type RecentProject } from "./api";
import { FolderPicker } from "./FolderPicker";

function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function Home({ onOpen }: { onOpen: (p: ProjectInfo) => void }) {
  const [recent, setRecent] = useState<RecentProject[] | null>(null);
  const [error, setError] = useState("");
  const [picker, setPicker] = useState<"open" | "parent" | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: "", author: "", name: "", parent: "" });
  const [nameTouched, setNameTouched] = useState(false);

  const refresh = () => api.recent().then(setRecent, (e) => setError(e.message));
  useEffect(() => {
    refresh();
  }, []);

  const open = async (path: string) => {
    setPicker(null);
    try {
      onOpen(await api.open(path));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const forget = async (id: string) => {
    await api.forget(id).catch(() => {});
    refresh();
  };

  const startCreate = async () => {
    const home = (await api.browse().catch(() => null))?.home ?? "";
    setForm({ title: "", author: "", name: "", parent: localStorage.getItem("flow.lastParent") ?? home });
    setNameTouched(false);
    setCreating(true);
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const project = await api.create(form.parent, form.name, form.title, form.author);
      localStorage.setItem("flow.lastParent", form.parent);
      setCreating(false);
      onOpen(project);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="home">
      <header className="home-header">
        <h1>flow</h1>
        <p className="muted">Write books in Markdown. Export to EPUB.</p>
        <div className="home-actions">
          <button className="primary" onClick={startCreate}>
            New project
          </button>
          <button onClick={() => setPicker("open")}>Open folder…</button>
        </div>
      </header>

      {error && (
        <div className="error" onClick={() => setError("")}>
          {error}
        </div>
      )}

      {creating && (
        <form className="card new-project" onSubmit={create}>
          <h2>New project</h2>
          <label>
            Title
            <input
              autoFocus
              required
              value={form.title}
              onChange={(e) =>
                setForm((f) => ({ ...f, title: e.target.value, name: nameTouched ? f.name : slugify(e.target.value) }))
              }
            />
          </label>
          <label>
            Author
            <input value={form.author} onChange={(e) => setForm((f) => ({ ...f, author: e.target.value }))} />
          </label>
          <label>
            Folder name
            <input
              required
              value={form.name}
              onChange={(e) => {
                setNameTouched(true);
                setForm((f) => ({ ...f, name: e.target.value }));
              }}
            />
          </label>
          <label>
            Location
            <div className="row">
              <input className="grow" required value={form.parent} onChange={(e) => setForm((f) => ({ ...f, parent: e.target.value }))} />
              <button type="button" onClick={() => setPicker("parent")}>
                Browse…
              </button>
            </div>
          </label>
          <p className="muted small-text">
            Will create <code>{form.parent.replace(/\/$/, "")}/{form.name || "…"}</code>
          </p>
          <div className="modal-actions">
            <button type="button" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button className="primary" type="submit">
              Create
            </button>
          </div>
        </form>
      )}

      <section className="recent">
        <h2>Recent projects</h2>
        {recent?.length === 0 && <p className="muted">No projects yet. Create one or open a folder.</p>}
        <ul>
          {recent?.map((r) => (
            <li key={r.id} className={r.missing ? "missing" : ""}>
              <button className="recent-open" disabled={r.missing} onClick={() => open(r.path)}>
                <span className="recent-title">{r.title}</span>
                <span className="recent-path">
                  {r.path}
                  {r.missing && " (folder not found)"}
                </span>
              </button>
              <button className="small ghost" title="Remove from list" onClick={() => forget(r.id)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      </section>

      {picker === "open" && (
        <FolderPicker title="Open project folder" confirmLabel="Open this folder" mode="open" onConfirm={open} onCancel={() => setPicker(null)} />
      )}
      {picker === "parent" && (
        <FolderPicker
          title="Choose where to create the project"
          confirmLabel="Choose this folder"
          mode="choose"
          onConfirm={(path) => {
            setForm((f) => ({ ...f, parent: path }));
            setPicker(null);
          }}
          onCancel={() => setPicker(null)}
        />
      )}
    </div>
  );
}
