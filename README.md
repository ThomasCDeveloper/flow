# flow

A browser-based tool for writing books. Each book is a folder on disk, each chapter is a Markdown file, and the whole book can be exported to EPUB.

## Quick start

Requires Node.js 20 or newer.

```sh
make install
make start
```

Then open http://localhost:4321.

To work on flow itself, run `make dev` and open http://localhost:5173. The web UI reloads on change and the server restarts on change.

| Command          | What it does                                     |
| ---------------- | ------------------------------------------------ |
| `make install`   | Install dependencies                             |
| `make dev`       | Server and web UI with hot reload (port 5173)    |
| `make build`     | Build the web UI into `web/dist`                 |
| `make start`     | Build and serve the app (port 4321)              |
| `make typecheck` | Type-check server and web UI                     |
| `make test`      | Run the tests                                    |
| `make clean`     | Remove build output and `node_modules`           |

Use a different port with `make start PORT=8080`.

## Using flow

- **Home**: recent projects, **New project** (title, author, folder location) and **Open folder…**, which browses your disk. Any folder of `.md` files can be opened.
- **Tabs**: several projects can be open at once, one per tab.
- **Chapters**: the sidebar lists chapters in reading order. Drag to reorder. Double-click or use the pencil icon to rename, which updates the chapter's `# Heading`. Use **+ New chapter** to add one.
- **Notes**: a separate sidebar section for ideas, research, characters, anything that isn't part of the book. Notes are Markdown files too, edited in the same editor.
- **Chapter notes**: the collapsible "Chapter notes" panel above the editor holds notes for the open chapter (when collapsed, it shows the first line of the notes).
- **Board**: the **Board** button in the toolbar shows the chapters as cards in four columns: To write, Started, Good enough and Finished. Drag a card to another column to change its status. Cards stay in reading order, and clicking one opens the chapter in the editor.
- **Editor**: Markdown editor with an optional side-by-side **Preview**. Changes save automatically after a short pause; `Ctrl+S` saves immediately and commits a version (see History). The status bar shows word counts for the chapter and the whole book.
- **Focus mode**: `Ctrl+Shift+F` (`⌘⇧F` on Mac), or the **Focus** button in the toolbar, hides everything but the Markdown editor: tabs, sidebar, toolbar, chapter notes, preview and status bar. Press the shortcut again or `Esc` to bring them back.
- **History**: each chapter and note has its own version history. `Ctrl+S` (`⌘S` on Mac) commits the open document as it is now, together with its chapter notes; the **History** button in the toolbar shows the history of the open document, where you can also commit with a message. A dot in the sidebar marks documents changed since their last commit. Select **Current text** to review what changed since the last commit, or a past commit to see what it changed (tick **Compare with current text** to compare it with today's text instead). Changes are shown paragraph by paragraph, with the exact words added and removed highlighted inside each paragraph, so an edit in the middle of a long line shows only the words that changed. Unchanged paragraphs are folded away.
- **Book details**: click the book title at the top of the sidebar to edit title, author, language and cover image.
- **Export EPUB**: downloads an EPUB 3 file of the whole book.

## Project format

```
my-book/
  flow.json          # metadata and chapter order
  chapters/
    3f9a1c07.md
    b82e5d14.md
  notes/             # free-form notes, never exported
    characters.md
  assets/            # images, cover
  .flow/history/     # committed versions (see History)
```

`flow.json`:

```json
{
  "title": "My Book",
  "author": "Jane Doe",
  "language": "en",
  "identifier": "urn:uuid:...",
  "chaptersDir": "chapters",
  "chapters": ["3f9a1c07.md", "b82e5d14.md"],
  "notesDir": "notes",
  "chapterNotes": { "b82e5d14.md": "Foreshadow the flood here." },
  "chapterStatus": { "3f9a1c07.md": "done", "b82e5d14.md": "started" },
  "cover": "assets/cover.jpg"
}
```

- Notes (`notes/`) and chapter notes (`chapterNotes`) are never included in the EPUB. Chapter notes are removed when their chapter is deleted.
- `chapterStatus` holds each chapter's board column: `started`, `good` (good enough) or `done` (finished). Chapters not listed are "to write". It is never exported, and it is removed with its chapter the same way chapter notes are.

- New chapters and notes are named by a random id (`3f9a1c07.md`) that never changes, so reordering or retitling never renames files; the order lives in `flow.json`. A document's title is its first `# Heading`. Files with other names (added by hand, or from older versions of flow) keep their names until you click **Rename files to ids** in **Book details**, which renames them once and carries over reading order, chapter notes, status, history and links between chapters and notes.
- Notes are listed alphabetically by title.
- Opening a folder without `flow.json` creates one. If the folder has loose `.md` files and no `chapters/` folder, they are used in place (`"chaptersDir": "."`) rather than moved.
- Files added or removed outside flow are picked up the next time the project loads: new files are appended to the order, missing ones are dropped.
- `.flow/history/log.json` lists commits, one document per commit; `.flow/history/objects/` holds each distinct version of a file once, named by its SHA-256. A chapter's commits include its chapter notes; status and book details are not part of history. Deleting a chapter leaves its past commits in the log.
- Images are referenced relative to the chapter file, for example `![Map](../assets/map.png)`.

The list of recent projects is stored in `~/.config/flow/config.json`. Set `FLOW_CONFIG_DIR` to use another location.

## EPUB export

The export produces a valid EPUB 3 file with an EPUB 2 table of contents for older readers. It includes:

- one page per chapter, in sidebar order
- a table of contents built from chapter titles
- a cover page, if a cover is set
- local images used in chapters
- links between chapters (`[next](b82e5d14.md)`), rewritten to point inside the book

Remote images and links to files that aren't chapters can't be packaged, so they are replaced by their alt text or plain text.

To validate an export with [EPUBCheck](https://github.com/w3c/epubcheck):

```sh
java -jar epubcheck.jar "My Book.epub"
```

## Architecture

```
server/   Fastify API (TypeScript, run with tsx)
  src/index.ts     routes, static file serving
  src/projects.ts  project open/create, flow.json, path safety
  src/chapters.ts  chapter read/write/create/retitle/delete/reorder, chapter notes
  src/notes.ts     free-form notes
shared/   Markdown rendering shared by preview and export (dialogue dashes)
  src/epub.ts      EPUB builder (marked + jszip)
  src/config.ts    recent projects
web/      React + Vite UI, CodeMirror 6 editor
```

The server listens on `127.0.0.1` only. It rejects requests whose `Host` header isn't localhost, and every write request must send an `X-Flow: 1` header, so other websites open in your browser can't modify your files. All file paths are checked to stay inside the project folder.
