import { readFile } from "node:fs/promises";
import path from "node:path";
import render from "dom-serializer";
import { Text, type ChildNode, type Element } from "domhandler";
import { parseDocument } from "htmlparser2";
import JSZip from "jszip";
import { Marked } from "marked";
import { dialogue } from "../../shared/markdown.ts";
import { chapterTitle } from "./chapters.ts";
import { safePath, type Project } from "./projects.ts";

const IMAGE_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

const STYLESHEET = `body { font-family: "Libron", serif; line-height: 1.5; margin: 0 5%; }
h1, h2, h3 { line-height: 1.2; }
h1 { margin-top: 3em; margin-bottom: 1.5em; text-align: center; }
p { margin: 0; text-indent: 1.5em; text-align: justify; -webkit-hyphens: auto; -epub-hyphens: auto; hyphens: auto; }
h1 + p, h2 + p, h3 + p, hr + p, blockquote p { text-indent: 0; }
blockquote { margin: 1em 2em; font-style: italic; }
hr { border: none; text-align: center; margin: 1.5em 0; }
hr::after { content: "* * *"; }
img { max-width: 100%; }
pre, code { font-family: monospace; font-size: 0.9em; }
.cover { text-align: center; margin: 0; padding: 0; }
.cover img { max-height: 100%; }
`;

const marked = new Marked({ gfm: true }, dialogue);

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function epubFilename(title: string): string {
  const base = title.replace(/[^\p{L}\p{N} _.-]+/gu, "").trim() || "book";
  return encodeURIComponent(base).replace(/%20/g, " ") + ".epub";
}

function xhtmlPage(title: string, lang: string, bodyHtml: string, bodyClass?: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${esc(lang)}" lang="${esc(lang)}">
<head>
  <meta charset="UTF-8"/>
  <title>${esc(title)}</title>
  <link rel="stylesheet" type="text/css" href="../style.css"/>
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ""}>
${bodyHtml}
</body>
</html>
`;
}

function isExternal(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//");
}

interface ImageEntry {
  id: string;
  href: string;
  type: string;
  data: Buffer;
}

interface Context {
  project: Project;
  images: Map<string, ImageEntry>;
  chapterHrefs: Map<string, string>;
}

async function addImage(ctx: Context, absPath: string): Promise<ImageEntry | null> {
  const existing = ctx.images.get(absPath);
  if (existing) return existing;
  const ext = path.extname(absPath).toLowerCase();
  const type = IMAGE_TYPES[ext];
  if (!type) return null;
  const data = await readFile(absPath).catch(() => null);
  if (!data) return null;
  const n = ctx.images.size + 1;
  const entry = { id: `img${n}`, href: `images/img${n}${ext === ".jpeg" ? ".jpg" : ext}`, type, data };
  ctx.images.set(absPath, entry);
  return entry;
}

/** Fix up links and images so every reference resolves inside the EPUB. */
async function rewriteNodes(ctx: Context, nodes: ChildNode[], chapterDir: string): Promise<void> {
  for (const node of nodes) {
    if (node.type !== "tag" && node.type !== "script" && node.type !== "style") continue;
    const el = node as Element;
    if (el.name === "script") {
      el.children = [];
      continue;
    }
    if (el.name === "img") {
      const src = el.attribs.src ?? "";
      let entry: ImageEntry | null = null;
      if (src && !isExternal(src)) {
        try {
          entry = await addImage(ctx, safePath(ctx.project.root, chapterDir, decodeURIComponent(src)));
        } catch {
          entry = null;
        }
      }
      if (entry) {
        el.attribs.src = `../${entry.href}`;
        el.attribs.alt ??= "";
      } else {
        // Remote or missing images can't be packaged; keep the alt text instead.
        const alt = el.attribs.alt;
        el.name = "span";
        el.attribs = { class: "missing-image" };
        el.children = alt ? [new Text(alt)] : [];
      }
    } else if (el.name === "a" && el.attribs.href !== undefined) {
      const href = el.attribs.href;
      if (!isExternal(href) && !href.startsWith("#")) {
        const [file, frag] = href.split("#");
        const target = ctx.chapterHrefs.get(path.basename(decodeURIComponent(file)));
        if (target) el.attribs.href = target + (frag ? `#${frag}` : "");
        else delete el.attribs.href;
      }
    }
    await rewriteNodes(ctx, el.children, chapterDir);
  }
}

async function chapterXhtml(ctx: Context, markdown: string, title: string): Promise<string> {
  const html = await marked.parse(markdown);
  const doc = parseDocument(html, { decodeEntities: true });
  await rewriteNodes(ctx, doc.children, ctx.project.meta.chaptersDir);
  const body = render(doc, { xmlMode: true, encodeEntities: "utf8" });
  return xhtmlPage(title, ctx.project.meta.language, body);
}

export async function buildEpub(project: Project): Promise<Buffer> {
  const { meta } = project;
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`,
  );
  zip.file("OEBPS/style.css", STYLESHEET);

  const ctx: Context = { project, images: new Map(), chapterHrefs: new Map() };
  meta.chapters.forEach((file, i) => ctx.chapterHrefs.set(file, `ch${String(i + 1).padStart(3, "0")}.xhtml`));

  const chapters: { id: string; href: string; title: string }[] = [];
  for (const [i, file] of meta.chapters.entries()) {
    const markdown = await readFile(safePath(project.root, meta.chaptersDir, file), "utf8");
    const title = chapterTitle(file, markdown);
    const href = `text/${ctx.chapterHrefs.get(file)}`;
    zip.file(`OEBPS/${href}`, await chapterXhtml(ctx, markdown, title));
    chapters.push({ id: `ch${i + 1}`, href, title });
  }

  let cover: ImageEntry | null = null;
  if (meta.cover) {
    try {
      cover = await addImage(ctx, safePath(project.root, meta.cover));
    } catch {
      cover = null;
    }
    if (cover) {
      zip.file(
        "OEBPS/text/cover.xhtml",
        xhtmlPage("Cover", meta.language, `<div><img src="../${cover.href}" alt="${esc(meta.title)}"/></div>`, "cover"),
      );
    }
  }

  for (const img of ctx.images.values()) zip.file(`OEBPS/${img.href}`, img.data);

  const toc = chapters.map((c) => `      <li><a href="${c.href}">${esc(c.title)}</a></li>`).join("\n");
  zip.file(
    "OEBPS/nav.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${esc(meta.language)}" lang="${esc(meta.language)}">
<head>
  <meta charset="UTF-8"/>
  <title>${esc(meta.title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Contents</h1>
    <ol>
${toc}
    </ol>
  </nav>
</body>
</html>
`,
  );

  const navPoints = chapters
    .map(
      (c, i) => `    <navPoint id="np${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${esc(c.title)}</text></navLabel>
      <content src="${c.href}"/>
    </navPoint>`,
    )
    .join("\n");
  zip.file(
    "OEBPS/toc.ncx",
    `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${esc(meta.identifier)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${esc(meta.title)}</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>
`,
  );

  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const manifest = [
    `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    `    <item id="css" href="style.css" media-type="text/css"/>`,
    ...(cover ? [`    <item id="cover-page" href="text/cover.xhtml" media-type="application/xhtml+xml"/>`] : []),
    ...chapters.map((c) => `    <item id="${c.id}" href="${c.href}" media-type="application/xhtml+xml"/>`),
    ...[...ctx.images.values()].map(
      (img) =>
        `    <item id="${img.id}" href="${img.href}" media-type="${img.type}"${img === cover ? ' properties="cover-image"' : ""}/>`,
    ),
  ].join("\n");
  const spine = [
    ...(cover ? [`    <itemref idref="cover-page"/>`] : []),
    ...chapters.map((c) => `    <itemref idref="${c.id}"/>`),
  ].join("\n");

  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${esc(meta.language)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${esc(meta.identifier)}</dc:identifier>
    <dc:title>${esc(meta.title)}</dc:title>
    <dc:language>${esc(meta.language)}</dc:language>
${meta.author ? `    <dc:creator id="author">${esc(meta.author)}</dc:creator>\n` : ""}    <meta property="dcterms:modified">${modified}</meta>
${cover ? `    <meta name="cover" content="${cover.id}"/>\n` : ""}  </metadata>
  <manifest>
${manifest}
  </manifest>
  <spine toc="ncx">
${spine}
  </spine>
</package>
`,
  );

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", mimeType: "application/epub+zip" });
}
