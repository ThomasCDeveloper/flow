import assert from "node:assert/strict";
import { test } from "node:test";
import { rewriteLinks } from "../src/migrate.ts";

const migration = {
  chapters: { "02-the-storm.md": "b82e5d14.md", "cast.md": "aaaa0000.md" },
  notes: { "cast.md": "11112222.md", "my notes.md": "33334444.md" },
};
const rewrite = (md: string) => rewriteLinks(md, migration, "notes");

test("links to renamed chapters point at the new file, keeping fragments and titles", () => {
  assert.equal(rewrite("See [next](02-the-storm.md)."), "See [next](b82e5d14.md).");
  assert.equal(rewrite("[x](02-the-storm.md#flood)"), "[x](b82e5d14.md#flood)");
  assert.equal(rewrite('[x](02-the-storm.md "The storm")'), '[x](b82e5d14.md "The storm")');
});

test("links into the notes folder use the notes mapping", () => {
  assert.equal(rewrite("[cast](../notes/cast.md)"), "[cast](../notes/11112222.md)");
  assert.equal(rewrite("[cast](cast.md)"), "[cast](aaaa0000.md)");
});

test("URL-encoded names are matched", () => {
  assert.equal(rewrite("[n](../notes/my%20notes.md)"), "[n](../notes/33334444.md)");
});

test("unrelated, external and image links are left alone", () => {
  assert.equal(rewrite("[a](other.md) [b](https://x.org/02-the-storm.md)"), "[a](other.md) [b](https://x.org/02-the-storm.md)");
  assert.equal(rewrite("![map](../assets/map.png)"), "![map](../assets/map.png)");
});
