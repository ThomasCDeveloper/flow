/**
 * Prose-oriented diff: paragraphs are aligned first, then changed paragraphs are compared
 * word by word, so an edit inside a long Markdown line shows only the words that changed.
 */

export type Op = "equal" | "insert" | "delete";

export interface Segment {
  op: Op;
  text: string;
}

export interface Block {
  /** "equal": unchanged paragraph; "modified": edited in place; "insert"/"delete": whole paragraph. */
  kind: "equal" | "modified" | "insert" | "delete";
  segments: Segment[];
}

export interface DiffStats {
  wordsAdded: number;
  wordsRemoved: number;
}

/** Below this word overlap, an edited paragraph is shown as removed + added rather than modified. */
const PAIR_SIMILARITY = 0.4;

export function tokenize(text: string): string[] {
  return text.match(/\s+|[\p{L}\p{N}_'’]+|[^\s\p{L}\p{N}_'’]/gu) ?? [];
}

export function paragraphs(text: string): string[] {
  const trimmed = text.replace(/\s+$/, "");
  return trimmed ? trimmed.split(/\n[ \t]*\n(?:[ \t]*\n)*/) : [];
}

function wordSet(text: string): Set<string> {
  return new Set(tokenize(text.toLowerCase()).filter((t) => /[\p{L}\p{N}]/u.test(t)));
}

/** Dice coefficient over distinct words, from 0 (nothing shared) to 1. */
export function similarity(a: string, b: string): number {
  const wa = wordSet(a);
  const wb = wordSet(b);
  if (wa.size === 0 && wb.size === 0) return 1;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return (2 * shared) / (wa.size + wb.size);
}

type EditOp = { op: Op; index: number };

/** Past this many edits the texts are unrelated anyway; bail out instead of using O(D²) memory. */
const MAX_EDIT_DISTANCE = 4000;

function replaceAll(n: number, m: number): EditOp[] {
  return [
    ...Array.from({ length: n }, (_, i): EditOp => ({ op: "delete", index: i })),
    ...Array.from({ length: m }, (_, i): EditOp => ({ op: "insert", index: i })),
  ];
}

/**
 * Myers' O(ND) shortest edit script. Returns ops referencing `a` indices for equal/delete
 * and `b` indices for insert, in order.
 */
function myers(a: number[], b: number[]): EditOp[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  // trace[d] keeps diagonals -d..d of v as it was before step d (enough to backtrack).
  const trace: Int32Array[] = [];

  let done = false;
  for (let d = 0; d <= max && !done; d++) {
    if (d > MAX_EDIT_DISTANCE) return replaceAll(n, m);
    trace.push(v.slice(offset - d, offset + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        done = true;
        break;
      }
    }
  }

  const ops: EditOp[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    let prevX = 0;
    let prevY = 0;
    if (d > 0) {
      const prev = trace[d];
      const k = x - y;
      const prevK = k === -d || (k !== d && prev[k - 1 + d] < prev[k + 1 + d]) ? k + 1 : k - 1;
      prevX = prev[prevK + d];
      prevY = prevX - prevK;
    }
    while (x > prevX && y > prevY) {
      ops.push({ op: "equal", index: --x });
      y--;
    }
    if (d === 0) break;
    if (x === prevX) ops.push({ op: "insert", index: --y });
    else ops.push({ op: "delete", index: --x });
  }
  return ops.reverse();
}

/** Diff two string arrays, trimming the common prefix and suffix first since most edits are local. */
function diffSequences(a: string[], b: string[]): EditOp[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const ids = new Map<string, number>();
  const id = (s: string) => {
    let n = ids.get(s);
    if (n === undefined) ids.set(s, (n = ids.size));
    return n;
  };
  const middle = myers(a.slice(start, endA).map(id), b.slice(start, endB).map(id)).map((e) => ({
    op: e.op,
    index: e.index + start,
  }));

  const head = Array.from({ length: start }, (_, i): EditOp => ({ op: "equal", index: i }));
  const tail = Array.from({ length: a.length - endA }, (_, i): EditOp => ({ op: "equal", index: endA + i }));
  return [...head, ...middle, ...tail];
}

function merge(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    if (!s.text) continue;
    const last = out[out.length - 1];
    if (last && last.op === s.op) last.text += s.text;
    else out.push({ ...s });
  }
  return out;
}

/** Each run of changes becomes one deletion followed by one insertion ("old words" -> "new words"). */
function regroup(s: Segment[]): Segment[] {
  const out: Segment[] = [];
  let del = "";
  let ins = "";
  const flush = () => {
    if (del) out.push({ op: "delete", text: del });
    if (ins) out.push({ op: "insert", text: ins });
    del = ins = "";
  };
  for (const seg of s) {
    if (seg.op === "delete") del += seg.text;
    else if (seg.op === "insert") ins += seg.text;
    else {
      flush();
      out.push(seg);
    }
  }
  flush();
  return merge(out);
}

/** Size of the change run next to segment `i` in direction `dir`: the longer of its deleted and inserted text. */
function changeSize(s: Segment[], i: number, dir: 1 | -1): number {
  let del = 0;
  let ins = 0;
  for (let j = i + dir; j >= 0 && j < s.length && s[j].op !== "equal"; j += dir) {
    if (s[j].op === "delete") del += s[j].text.length;
    else ins += s[j].text.length;
  }
  return Math.max(del, ins);
}

/**
 * Make word diffs readable: an unchanged stretch squeezed between two larger edits ("the",
 * a space) is folded into them, so a rewritten phrase reads as one replacement instead of
 * alternating fragments.
 */
function cleanup(segments: Segment[]): Segment[] {
  let s = regroup(segments);
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 1; i < s.length - 1; i++) {
      if (s[i].op !== "equal") continue;
      if (s[i].text.length <= Math.min(changeSize(s, i, -1), changeSize(s, i, 1))) {
        s[i] = { op: "delete", text: s[i].text };
        s.splice(i + 1, 0, { op: "insert", text: s[i].text });
        changed = true;
      }
    }
    if (changed) s = regroup(s);
  }
  return s;
}

/** Word-level diff of two pieces of text. */
export function diffWords(a: string, b: string): Segment[] {
  const ta = tokenize(a);
  const tb = tokenize(b);
  const segments = diffSequences(ta, tb).map((e) => ({
    op: e.op,
    text: e.op === "insert" ? tb[e.index] : ta[e.index],
  }));
  return cleanup(segments);
}

/**
 * Within a run of removed and added paragraphs, pair each removed paragraph with the next
 * added one that is similar enough (keeping order), so it is shown as an in-place edit.
 */
function pairParagraphs(removed: string[], added: string[]): Block[] {
  const blocks: Block[] = [];
  let j = 0;
  for (const old of removed) {
    let match = -1;
    for (let k = j; k < added.length; k++) {
      if (similarity(old, added[k]) >= PAIR_SIMILARITY) {
        match = k;
        break;
      }
    }
    if (match === -1) {
      blocks.push({ kind: "delete", segments: [{ op: "delete", text: old }] });
      continue;
    }
    for (; j < match; j++) blocks.push({ kind: "insert", segments: [{ op: "insert", text: added[j] }] });
    blocks.push({ kind: "modified", segments: diffWords(old, added[match]) });
    j = match + 1;
  }
  for (; j < added.length; j++) blocks.push({ kind: "insert", segments: [{ op: "insert", text: added[j] }] });
  return blocks;
}

/** Diff two Markdown documents into paragraph blocks with word-level changes inside. */
export function diffDocuments(a: string, b: string): Block[] {
  const pa = paragraphs(a);
  const pb = paragraphs(b);
  const blocks: Block[] = [];
  let removed: string[] = [];
  let added: string[] = [];
  const flush = () => {
    if (removed.length || added.length) blocks.push(...pairParagraphs(removed, added));
    removed = [];
    added = [];
  };
  for (const e of diffSequences(pa, pb)) {
    if (e.op === "delete") removed.push(pa[e.index]);
    else if (e.op === "insert") added.push(pb[e.index]);
    else {
      flush();
      blocks.push({ kind: "equal", segments: [{ op: "equal", text: pa[e.index] }] });
    }
  }
  flush();
  return blocks;
}

function countWords(text: string): number {
  return tokenize(text).filter((t) => /[\p{L}\p{N}]/u.test(t)).length;
}

export function diffStats(blocks: Block[]): DiffStats {
  const stats = { wordsAdded: 0, wordsRemoved: 0 };
  for (const block of blocks) {
    for (const s of block.segments) {
      if (s.op === "insert") stats.wordsAdded += countWords(s.text);
      else if (s.op === "delete") stats.wordsRemoved += countWords(s.text);
    }
  }
  return stats;
}
