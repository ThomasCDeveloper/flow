import type { MarkedExtension, Tokens } from "marked";

const DASH = "\u2014";
const NBSP = "\u00a0";

/**
 * Book-style dialogue:
 * - a "- " list becomes one paragraph per line, each starting with an em dash
 *   (bullet lists can still be written with "*" or "+");
 * - lines already starting with an em/en dash become their own paragraphs instead of
 *   being joined to the previous line.
 */
export const dialogue: MarkedExtension = {
  hooks: {
    preprocess(markdown: string) {
      return markdown.replace(/([^\n])\n(?=[\u2014\u2013] )/g, "$1\n\n");
    },
  },
  renderer: {
    list(token: Tokens.List) {
      if (token.ordered || !token.items.every((item) => item.raw.trimStart().startsWith("-"))) return false;
      const paragraphs: string[] = [];
      for (const item of token.items) {
        const inner = this.parser
          .parse(item.tokens, false)
          .trim()
          .replace(/^<p>([\s\S]*)<\/p>$/, "$1");
        if (/<(p|ul|ol|blockquote|pre|h[1-6])[\s>]/.test(inner)) return false;
        paragraphs.push(`<p class="dialogue">${DASH}${NBSP}${inner}</p>\n`);
      }
      return paragraphs.join("");
    },
    paragraph(token: Tokens.Paragraph) {
      if (!/^[\u2014\u2013] /.test(token.text)) return false;
      const inner = this.parser.parseInline(token.tokens).replace(/^([\u2014\u2013]) /, `$1${NBSP}`);
      return `<p class="dialogue">${inner}</p>\n`;
    },
  },
};
