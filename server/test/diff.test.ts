import assert from "node:assert/strict";
import { test } from "node:test";
import { diffDocuments, diffStats, diffWords, paragraphs, similarity, type Segment } from "../../shared/diff.ts";

const show = (segments: Segment[]) =>
  segments.map((s) => (s.op === "equal" ? s.text : s.op === "insert" ? `{+${s.text}+}` : `[-${s.text}-]`)).join("");

function reassemble(segments: Segment[], side: "old" | "new"): string {
  return segments.filter((s) => s.op === "equal" || s.op === (side === "old" ? "delete" : "insert")).map((s) => s.text).join("");
}

test("a changed word inside a long line is the only change", () => {
  const a = "She walked slowly to the window and looked out at the grey sea, thinking of him.";
  const b = "She walked slowly to the window and looked out at the stormy sea, thinking of him.";
  assert.equal(show(diffWords(a, b)), "She walked slowly to the window and looked out at the [-grey-]{+stormy+} sea, thinking of him.");
});

test("adjacent changed words are grouped into one replacement", () => {
  assert.equal(show(diffWords("the old grey cat sat", "the young black cat sat")), "the [-old grey-]{+young black+} cat sat");
});

test("a rewritten phrase reads as one replacement, not alternating fragments", () => {
  assert.equal(
    show(diffWords("The wind rose in the night.", "All night the wind howled against the shutters.")),
    "[-The wind rose in the night-]{+All night the wind howled against the shutters+}.",
  );
});

test("punctuation changes are detected on their own", () => {
  assert.equal(show(diffWords("Hello, world.", "Hello, world!")), "Hello, world[-.-]{+!+}");
});

test("word diff reproduces both sides exactly", () => {
  const a = "- Where are you going?\n- Out, she said. *Far* out.";
  const b = "- Where were you going?\n- Out, he said quietly. Far out!";
  const segments = diffWords(a, b);
  assert.equal(reassemble(segments, "old"), a);
  assert.equal(reassemble(segments, "new"), b);
});

test("paragraphs are split on blank lines", () => {
  assert.deepEqual(paragraphs("# Title\n\nOne.\nStill one.\n\n\nTwo.\n"), ["# Title", "One.\nStill one.", "Two."]);
  assert.deepEqual(paragraphs("  \n"), []);
});

test("unchanged paragraphs stay equal and the edited one is modified", () => {
  const a = "# One\n\nFirst paragraph here.\n\nSecond paragraph here.";
  const b = "# One\n\nFirst paragraph there.\n\nSecond paragraph here.";
  const blocks = diffDocuments(a, b);
  assert.deepEqual(
    blocks.map((x) => x.kind),
    ["equal", "modified", "equal"],
  );
  assert.equal(show(blocks[1].segments), "First paragraph [-here-]{+there+}.");
});

test("an inserted paragraph does not disturb its neighbours", () => {
  const blocks = diffDocuments("A cat.\n\nA dog.", "A cat.\n\nA bird flew past.\n\nA dog.");
  assert.deepEqual(
    blocks.map((x) => x.kind),
    ["equal", "insert", "equal"],
  );
});

test("an unrelated rewrite is shown as removed and added", () => {
  const blocks = diffDocuments("The sun rose over the hills.", "Nobody answered the door.");
  assert.deepEqual(
    blocks.map((x) => x.kind),
    ["delete", "insert"],
  );
});

test("stats count words added and removed", () => {
  const stats = diffStats(diffDocuments("one two three", "one four five three\n\nsix"));
  assert.deepEqual(stats, { wordsAdded: 3, wordsRemoved: 1 });
});

test("similarity is 1 for identical text and 0 for disjoint text", () => {
  assert.equal(similarity("a b c", "c b a"), 1);
  assert.equal(similarity("a b", "c d"), 0);
});

test("large unrelated documents fall back without blowing up", () => {
  const words = (seed: string, n: number) => Array.from({ length: n }, (_, i) => `${seed}${i}`).join(" ");
  const a = words("x", 6000);
  const b = words("y", 6000);
  const segments = diffWords(a, b);
  assert.equal(reassemble(segments, "old"), a);
  assert.equal(reassemble(segments, "new"), b);
});
