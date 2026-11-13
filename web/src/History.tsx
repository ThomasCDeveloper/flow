import { useCallback, useEffect, useMemo, useState } from "react";
import { diffDocuments, diffStats, type Block } from "../../shared/diff.ts";
import { api, type CommitSummary, type Comparison, type DocKind } from "./api";

const WORKING = "working";
/** Unchanged paragraphs shown around each change; longer unchanged runs collapse. */
const CONTEXT = 1;

type Compare = "previous" | "current";

interface Props {
  projectId: string;
  doc: { kind: DocKind; file: string; title: string } | null;
  /** Save pending edits so the file on disk is up to date. */
  flush: () => Promise<boolean>;
  /** Changes whenever a commit is made elsewhere (Ctrl+S), so the list reloads. */
  revision: number;
  onCommitted: () => void;
}

const formatDate = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function History({ projectId, doc, flush, revision, onCommitted }: Props) {
  const [commits, setCommits] = useState<CommitSummary[] | null>(null);
  const [selected, setSelected] = useState(WORKING);
  const [compare, setCompare] = useState<Compare>("previous");
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [message, setMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState("");
  const kind = doc?.kind;
  const file = doc?.file;

  useEffect(() => {
    setSelected(WORKING);
    setCompare("previous");
  }, [kind, file]);

  useEffect(() => {
    if (!kind || !file) return;
    setCommits(null);
    api.history(projectId, kind, file).then(setCommits, (e) => setError((e as Error).message));
  }, [projectId, kind, file, revision]);

  const loadComparison = useCallback(async () => {
    if (!kind || !file) return;
    setComparison(null);
    try {
      await flush();
      const result =
        selected === WORKING
          ? await api.compare(projectId, kind, file, WORKING)
          : compare === "current"
            ? await api.compare(projectId, kind, file, WORKING, selected)
            : await api.compare(projectId, kind, file, selected);
      setComparison(result);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [projectId, kind, file, selected, compare, flush]);

  useEffect(() => {
    loadComparison();
  }, [loadComparison, revision]);

  const blocks = useMemo(
    () => (comparison ? diffDocuments(comparison.oldContent, comparison.newContent) : null),
    [comparison],
  );
  const notesBlocks = useMemo(
    () => (comparison ? diffDocuments(comparison.oldNotes, comparison.newNotes) : null),
    [comparison],
  );
  const stats = useMemo(() => (blocks ? diffStats(blocks) : null), [blocks]);
  const textChanged = comparison !== null && comparison.oldContent !== comparison.newContent;
  const notesChanged = comparison !== null && comparison.oldNotes !== comparison.newNotes;
  const unchanged = comparison !== null && !textChanged && !notesChanged;

  if (!kind || !file || !doc) {
    return <div className="history empty muted">Open a chapter or note to see its history.</div>;
  }

  const commit = async () => {
    setCommitting(true);
    setError("");
    try {
      await flush();
      await api.commit(projectId, kind, file, message);
      setMessage("");
      setSelected(WORKING);
      onCommitted();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCommitting(false);
    }
  };

  const index = commits?.findIndex((c) => c.id === selected) ?? -1;
  const previous = selected === WORKING ? commits?.[0] : commits?.[index + 1];
  const heading =
    selected === WORKING
      ? previous
        ? `Changes since ${formatDate(previous.createdAt)}`
        : "Never committed"
      : compare === "current"
        ? "From this version to the current text"
        : previous
          ? `Changes in this version since ${formatDate(previous.createdAt)}`
          : "First version";

  return (
    <div className="history">
      <aside className="history-list">
        <form
          className="commit-form"
          onSubmit={(e) => {
            e.preventDefault();
            commit();
          }}
        >
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="What changed? (optional)"
            aria-label="Commit message"
          />
          <button
            className="primary"
            type="submit"
            disabled={committing || (selected === WORKING && unchanged)}
            title={`Save a version of "${doc.title}" as it is now (Ctrl+S)`}
          >
            {committing ? "Committing…" : `Commit ${kind}`}
          </button>
        </form>
        <ol className="versions">
          <li>
            <button className={`version ${selected === WORKING ? "active" : ""}`} onClick={() => setSelected(WORKING)}>
              <strong>Current text</strong>
              <span className="muted small-text">Uncommitted changes</span>
            </button>
          </li>
          {commits?.map((c) => (
            <li key={c.id}>
              <button
                className={`version ${selected === c.id ? "active" : ""}`}
                onClick={() => {
                  setSelected(c.id);
                  setCompare("previous");
                }}
              >
                <strong>{c.message || formatDate(c.createdAt)}</strong>
                <span className="muted small-text">
                  {c.message ? `${formatDate(c.createdAt)} · ` : ""}
                  {c.words.toLocaleString()} words
                </span>
              </button>
            </li>
          ))}
        </ol>
      </aside>

      <section className="history-main">
        <div className="history-head">
          <div className="grow">
            <h2>{doc.title}</h2>
            <span className="muted small-text">{heading}</span>
          </div>
          {stats && (stats.wordsAdded > 0 || stats.wordsRemoved > 0) && (
            <span className="diff-count">
              {stats.wordsAdded > 0 && <span className="added">+{stats.wordsAdded.toLocaleString()}</span>}
              {stats.wordsRemoved > 0 && <span className="removed">−{stats.wordsRemoved.toLocaleString()}</span>}
              <span className="muted"> words</span>
            </span>
          )}
          {selected !== WORKING && (
            <label className="toggle">
              <input
                type="checkbox"
                checked={compare === "current"}
                onChange={(e) => setCompare(e.target.checked ? "current" : "previous")}
              />
              Compare with current text
            </label>
          )}
        </div>
        {error && (
          <div className="error" onClick={() => setError("")} title="Click to dismiss">
            {error}
          </div>
        )}
        {blocks === null ? (
          <p className="muted">Loading…</p>
        ) : unchanged ? (
          <p className="muted">{selected === WORKING ? "No changes since the last commit." : "No differences."}</p>
        ) : (
          <>
            {textChanged && <DiffBody key={`${file}:${selected}:${compare}`} blocks={blocks} />}
            {notesChanged && notesBlocks && (
              <>
                <h3 className="diff-section">
                  Chapter notes <span className="muted">not exported</span>
                </h3>
                <DiffBody key={`notes:${file}:${selected}:${compare}`} blocks={notesBlocks} />
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}

type Row = { type: "block"; block: Block } | { type: "gap"; blocks: Block[] };

/** Keep changed blocks and CONTEXT unchanged ones around them; fold the rest into gaps. */
function withGaps(blocks: Block[]): Row[] {
  const near = blocks.map((_, i) =>
    blocks.slice(Math.max(0, i - CONTEXT), i + CONTEXT + 1).some((b) => b.kind !== "equal"),
  );
  const rows: Row[] = [];
  blocks.forEach((block, i) => {
    if (near[i]) return rows.push({ type: "block", block });
    const last = rows[rows.length - 1];
    if (last?.type === "gap") last.blocks.push(block);
    else rows.push({ type: "gap", blocks: [block] });
  });
  return rows;
}

function DiffBody({ blocks }: { blocks: Block[] }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const rows = useMemo(() => withGaps(blocks), [blocks]);

  return (
    <div className="diff-body">
      {rows.map((row, i) =>
        row.type === "block" ? (
          <DiffBlock key={i} block={row.block} />
        ) : expanded.has(i) ? (
          row.blocks.map((block, j) => <DiffBlock key={`${i}.${j}`} block={block} />)
        ) : (
          <button key={i} className="diff-gap" onClick={() => setExpanded(new Set(expanded).add(i))}>
            {row.blocks.length} unchanged paragraph{row.blocks.length === 1 ? "" : "s"}
          </button>
        ),
      )}
    </div>
  );
}

function DiffBlock({ block }: { block: Block }) {
  return (
    <p className={`diff-block ${block.kind}`}>
      {block.segments.map((s, i) =>
        s.op === "insert" ? <ins key={i}>{s.text}</ins> : s.op === "delete" ? <del key={i}>{s.text}</del> : s.text,
      )}
    </p>
  );
}
