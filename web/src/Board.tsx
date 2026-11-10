import { useState } from "react";
import type { ChapterInfo, ChapterStatus } from "./api";

const COLUMNS: { status: ChapterStatus; label: string }[] = [
  { status: "todo", label: "To write" },
  { status: "started", label: "Started" },
  { status: "good", label: "Good enough" },
  { status: "done", label: "Finished" },
];

interface Props {
  chapters: ChapterInfo[];
  activeFile: string | null;
  /** Live word count for the active chapter, which may have unsaved edits. */
  activeWords: number;
  onOpen: (file: string) => void;
  onMove: (file: string, status: ChapterStatus) => void;
}

export function Board({ chapters, activeFile, activeWords, onOpen, onMove }: Props) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<ChapterStatus | null>(null);

  const drop = (status: ChapterStatus) => {
    const card = chapters.find((c) => c.file === dragging);
    if (card && card.status !== status) onMove(card.file, status);
    setDragging(null);
    setOver(null);
  };

  return (
    <div className="board">
      {COLUMNS.map((col) => {
        const cards = chapters.map((c, i) => ({ ...c, num: i + 1 })).filter((c) => c.status === col.status);
        return (
          <section
            key={col.status}
            className={`board-column ${dragging && over === col.status ? "drag-over" : ""}`}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              if (over !== col.status) setOver(col.status);
            }}
            onDrop={(e) => {
              e.preventDefault();
              drop(col.status);
            }}
          >
            <h3>
              {col.label} <span className="muted">{cards.length}</span>
            </h3>
            <ol className="board-cards">
              {cards.map((c) => (
                <li
                  key={c.file}
                  className={`board-card ${c.file === activeFile ? "active" : ""} ${c.file === dragging ? "dragging" : ""}`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    setDragging(c.file);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                  onClick={() => onOpen(c.file)}
                >
                  <span className="doc-num">{c.num}</span>
                  <span className="board-card-title">{c.title}</span>
                  <span className="doc-words">{(c.file === activeFile ? activeWords : c.words).toLocaleString()}</span>
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
