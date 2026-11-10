import { useEffect, useState } from "react";
import { api, type ProjectInfo, type ProjectMeta } from "./api";

interface Props {
  project: ProjectInfo;
  onClose: () => void;
  onSaved: (meta: ProjectMeta) => void;
}

export function MetaDialog({ project, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    title: project.meta.title,
    author: project.meta.author,
    language: project.meta.language,
  });
  const [cover, setCover] = useState(project.meta.cover);
  const [coverVersion, setCoverVersion] = useState(Date.now());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = async (fn: () => Promise<ProjectMeta>) => {
    setBusy(true);
    setError("");
    try {
      const meta = await fn();
      onSaved(meta);
      return meta;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const uploadCover = async (file: File | undefined) => {
    if (!file) return;
    const meta = await run(() => api.setCover(project.id, file));
    if (meta) {
      setCover(meta.cover);
      setCoverVersion(Date.now());
    }
  };

  const removeCover = async () => {
    const meta = await run(() => api.removeCover(project.id));
    if (meta) setCover(undefined);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await run(() => api.updateMeta(project.id, form))) onClose();
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="modal meta" onMouseDown={(e) => e.stopPropagation()} onSubmit={save}>
        <h2>Book details</h2>
        <div className="meta-grid">
          <div className="meta-fields">
            <label>
              Title
              <input autoFocus required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </label>
            <label>
              Author
              <input value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} />
            </label>
            <label>
              Language
              <input
                required
                value={form.language}
                placeholder="en, fr, de…"
                onChange={(e) => setForm({ ...form, language: e.target.value })}
              />
            </label>
            <p className="muted small-text">
              Folder: <code>{project.root}</code>
            </p>
          </div>
          <div className="cover-box">
            {cover ? (
              <img src={api.coverUrl(project.id, coverVersion)} alt="Cover" />
            ) : (
              <div className="cover-placeholder muted">No cover</div>
            )}
            <label className="button small">
              {cover ? "Replace cover" : "Add cover"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                hidden
                onChange={(e) => uploadCover(e.target.files?.[0])}
              />
            </label>
            {cover && (
              <button type="button" className="small ghost" onClick={removeCover}>
                Remove cover
              </button>
            )}
          </div>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={busy}>
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
