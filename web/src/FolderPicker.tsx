import { useEffect, useRef, useState } from "react";
import { api, type BrowseResult } from "./api";

const LAST_DIR_KEY = "flow.lastDir";

interface Props {
  title: string;
  confirmLabel: string;
  /** In "open" mode, project folders get a one-click Open button. */
  mode: "open" | "choose";
  onConfirm: (path: string) => void;
  onCancel: () => void;
}

export function FolderPicker({ title, confirmLabel, mode, onConfirm, onCancel }: Props) {
  const [listing, setListing] = useState<BrowseResult | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");

  const requestSeq = useRef(0);

  const go = async (path?: string): Promise<boolean> => {
    const seq = ++requestSeq.current;
    try {
      const result = await api.browse(path);
      if (seq !== requestSeq.current) return true;
      setListing(result);
      setInput(result.path);
      setError("");
      localStorage.setItem(LAST_DIR_KEY, result.path);
      return true;
    } catch (e) {
      if (seq === requestSeq.current) setError((e as Error).message);
      return false;
    }
  };

  useEffect(() => {
    const last = localStorage.getItem(LAST_DIR_KEY);
    (last ? go(last) : Promise.resolve(false)).then((ok) => ok || go());
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const join = (name: string) => (listing!.path.endsWith("/") ? listing!.path + name : `${listing!.path}/${name}`);

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div className="modal picker" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <form
          className="picker-path"
          onSubmit={(e) => {
            e.preventDefault();
            go(input);
          }}
        >
          <button type="button" disabled={!listing?.parent} onClick={() => go(listing!.parent!)} title="Up">
            ↑
          </button>
          <button type="button" onClick={() => go(listing?.home)} title="Home">
            ~
          </button>
          <input value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} />
        </form>
        {error && <div className="error">{error}</div>}
        <ul className="picker-list">
          {listing?.dirs.length === 0 && <li className="muted">No subfolders</li>}
          {listing?.dirs.map((d) => (
            <li key={d.name} onClick={() => go(join(d.name))}>
              <span className="grow">{d.name}/</span>
              {d.isProject && <span className="badge">project</span>}
              {mode === "open" && d.isProject && (
                <button
                  className="small primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    onConfirm(join(d.name));
                  }}
                >
                  Open
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="modal-actions">
          <span className="muted grow">
            {listing?.isProject ? "This folder is a flow project." : mode === "open" ? "Any folder of .md files can be opened." : ""}
          </span>
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" disabled={!listing} onClick={() => onConfirm(listing!.path)}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
