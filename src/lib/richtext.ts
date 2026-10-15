/**
 * The tiny markup the `text` block understands: **bold**, *italic*,
 * [label](url), `code`, line breaks and paragraphs.
 *
 * There is deliberately no raw-HTML escape hatch. Everything is escaped first
 * and only then re-wrapped in the tags above, so a paragraph written in the
 * builder can never carry a script into a published page.
 */

const SAFE_HREF = /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i;

function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inline(text: string): string {
  let out = text;

  out = out.replace(/`([^`\n]+)`/g, (_m, code: string) => `<code>${code}</code>`);

  out = out.replace(/\[([^\]\n]*)\]\(([^)\s]+)\)/g, (_m, label: string, href: string) => {
    // The href arrives already escaped, so a quote character cannot break out
    // of the attribute even if the scheme check passes.
    if (!SAFE_HREF.test(href)) return label;
    return `<a href="${href}">${label}</a>`;
  });

  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

  return out.replace(/\n/g, '<br>');
}

export function richTextToHtml(source: unknown): string {
  const raw = typeof source === 'string' ? source : '';
  if (raw.trim() === '') return '';

  return raw
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) => `<p>${inline(escape(block.trim()))}</p>`)
    .join('');
}

/** For canvas labels and meta text, where markup should read as words. */
export function richTextToPlain(source: unknown): string {
  const raw = typeof source === 'string' ? source : '';
  return raw
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
