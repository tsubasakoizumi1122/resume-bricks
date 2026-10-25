// Turn an uploaded resume file into plain text, one visual line per line.
// Parsing the text into bricks happens in public/importer.js (shared with the browser).
import { getDocumentProxy } from 'unpdf';
import mammoth from 'mammoth';
import JSZip from 'jszip';

const GAP = ' | '; // marks a wide horizontal gap, e.g. a right-aligned date or location

/** PDF: rebuild lines from positioned text items so columns and right-aligned dates survive. */
export async function pdfToText(buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const { items } = await page.getTextContent();
    const rows = [];
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      const x = it.transform[4];
      const y = it.transform[5];
      const size = Math.hypot(it.transform[2], it.transform[3]) || 10;
      let row = rows.find((r) => Math.abs(r.y - y) < Math.max(2, size * 0.35));
      if (!row) rows.push((row = { y, size, parts: [] }));
      row.parts.push({ x, w: it.width, str: it.str, size });
    }
    rows.sort((a, b) => b.y - a.y);
    const lines = [];
    let prevY = null;
    for (const r of rows) {
      r.parts.sort((a, b) => a.x - b.x);
      let line = '';
      let end = null;
      for (const part of r.parts) {
        if (end !== null) {
          const gap = part.x - end;
          if (gap > part.size * 2.2) line += GAP;
          else if (gap > part.size * 0.15 && !line.endsWith(' ') && !part.str.startsWith(' ')) line += ' ';
        }
        line += part.str;
        end = part.x + part.w;
      }
      // A clearly larger vertical jump usually means a new block: keep a blank line there.
      if (prevY !== null && prevY - r.y > r.size * 2.1) lines.push('');
      lines.push(line.replace(/\s+/g, ' ').trim());
      prevY = r.y;
    }
    pages.push(lines.join('\n'));
  }
  return pages.join('\n\n');
}

/** Word (.docx): each paragraph is a line; list paragraphs get a bullet marker back. */
export async function docxToText(buffer) {
  // Node's mammoth reads a Buffer; the browser build reads an ArrayBuffer.
  const input = typeof Buffer !== 'undefined' ? { buffer: Buffer.from(buffer) } : { arrayBuffer: toArrayBuffer(buffer) };
  const { value: html } = await mammoth.convertToHtml(input);
  return html
    .replace(/<li>/g, '\n• ')
    .replace(/<\/(p|h\d|li|tr)>/g, '\n')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<td>/g, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').replace(/^\s*\|\s*/, '').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const xmlText = (xml) =>
  [...xml.matchAll(/<a:t>([^<]*)<\/a:t>|<a:br\/>|<\/a:p>/g)]
    .map((m) => (m[1] !== undefined ? m[1] : '\n'))
    .join('')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();

/** PowerPoint (.pptx): slide text in order, with speaker notes. */
export async function pptxToText(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const num = (n) => Number(n.match(/(\d+)\.xml$/)[1]);
  const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b));
  const out = [];
  for (const name of slides) {
    const n = num(name);
    const body = xmlText(await zip.file(name).async('string'));
    const notesFile = zip.file(`ppt/notesSlides/notesSlide${n}.xml`);
    const notes = notesFile ? xmlText(await notesFile.async('string')).replace(/^\d+$/m, '').trim() : '';
    out.push(`--- Slide ${n} ---\n${body}${notes ? `\n[Speaker notes] ${notes}` : ''}`);
  }
  return out.join('\n\n');
}

const toArrayBuffer = (b) =>
  b instanceof ArrayBuffer ? b : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

export async function fileToText(buffer, filename = '', contentType = '') {
  const name = filename.toLowerCase();
  const head = String.fromCharCode(...new Uint8Array(toArrayBuffer(buffer)).slice(0, 5));
  if (head.startsWith('%PDF') || name.endsWith('.pdf') || contentType.includes('pdf')) return pdfToText(buffer);
  if (name.endsWith('.pptx') || contentType.includes('presentationml')) return pptxToText(buffer);
  if (head.startsWith('PK') || name.endsWith('.docx')) return docxToText(buffer);
  if (name.endsWith('.ppt')) {
    throw Object.assign(new Error('Old .ppt files are not supported. Save it as .pptx or PDF and try again.'), { status: 415 });
  }
  if (name.endsWith('.doc')) {
    throw Object.assign(new Error('Old .doc files are not supported. Save it as .docx or PDF and try again.'), { status: 415 });
  }
  return new TextDecoder('utf-8').decode(new Uint8Array(toArrayBuffer(buffer)));
}
