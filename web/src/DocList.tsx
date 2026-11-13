import { useState } from "react";
import type { DocInfo } from "./api";

interface Props {
  items: DocInfo[];
  /** Files with changes not yet committed to history. */
  uncommitted?: string[];
  activeFile: string | null;
  /** Live word count for the active item, which may have unsaved edits. */
  activeWords: number;
  numbered?: boolean;
  addLabel: string;
  addPlaceholder: string;
  onSelect: (file: string) => void;
  onAdd: (title: string) => void;
  onRename: (file: string, title: string) => void;
  onDelete: (file: string) => void;
  /** Enables drag-to-reorder when provided. */
  onReorder?: (from: number, to: number) => void;
}

export function DocList(props: Props) {
  const { items, activeFile, activeWords, numbered, onSelect, onReorder } = props;
  const [renaming, setRenaming] = useState<{ file: string; title: string } | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);

  const commitRename = () => {
    if (!renaming) return;
    const { file, title } = renaming;
    setRenaming(null);
    const old = items.find((c) => c.file === file);
    if (title.trim() && title.trim() !== old?.title) props.onRename(file, title.trim());
  };

  const commitAdd = () => {
    if (adding?.trim()) props.onAdd(adding.trim());
    setAdding(null);
  };

  const drop = () => {
    if (drag && drag.from !== drag.over && onReorder) {
      onReorder(drag.from, drag.over > drag.from ? drag.over - 1 : drag.over);
    }
    setDrag(null);
  };

  return (
    <>
      <ol className="doc-list">
        {items.map((c, i) => (
          <li
            key={c.file}
            className={[
              "doc",
              c.file === activeFile ? "active" : "",
              drag && drag.over === i && drag.from !== i && drag.from !== i - 1 ? "drop-before" : "",
            ].join(" ")}
            draggable={!!onReorder && !renaming}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              setDrag({ from: i, over: i });
            }}
            onDragOver={(e) => {
              if (!drag) return;
              e.preventDefault();
              const rect = e.currentTarget.getBoundingClientRect();
              const over = e.clientY > rect.top + rect.height / 2 ? i + 1 : i;
              if (over !== drag.over) setDrag({ ...drag, over });
            }}
            onDrop={(e) => {
              e.preventDefault();
              drop();
            }}
            onDragEnd={() => setDrag(null)}
            onClick={() => onSelect(c.file)}
            onDoubleClick={() => setRenaming({ file: c.file, title: c.title })}
          >
            {renaming?.file === c.file ? (
              <input
                autoFocus
                className="inline-input"
                value={renaming.title}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setRenaming({ ...renaming, title: e.target.value })}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") setRenaming(null);
                }}
              />
            ) : (
              <>
                {numbered && <span className="doc-num">{i + 1}</span>}
                <span className="doc-title">{c.title}</span>
                {props.uncommitted?.includes(c.file) && (
                  <span className="uncommitted-dot" title="Changed since the last commit (Ctrl+S to commit)" />
                )}
                <span className="doc-words">{(c.file === activeFile ? activeWords : c.words).toLocaleString()}</span>
                <span className="doc-actions">
                  <button
                    className="icon"
                    title="Rename"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenaming({ file: c.file, title: c.title });
                    }}
                  >
                    ✎
                  </button>
                  <button
                    className="icon"
                    title="Delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onDelete(c.file);
                    }}
                  >
                    ×
                  </button>
                </span>
              </>
            )}
          </li>
        ))}
        {drag && drag.over === items.length && drag.from !== items.length - 1 && <li className="drop-end" />}
      </ol>
      {adding !== null ? (
        <input
          autoFocus
          className="inline-input add-input"
          placeholder={props.addPlaceholder}
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onBlur={commitAdd}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setAdding(null);
          }}
        />
      ) : (
        <button className="add-doc" onClick={() => setAdding("")}>
          {props.addLabel}
        </button>
      )}
    </>
  );
}
