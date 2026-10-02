/**
 * Attachments live in Firestore (the Spark plan has no Cloud Storage): a file is split into
 * base64 chunks of at most 700,000 characters, written in batches well under Firestore's
 * 10 MiB request limit, and reassembled byte for byte. These cover the pure helpers; the
 * Firestore round trip and its security rules are covered in tests-rules/rules.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_BATCH_CHARS,
  ATTACHMENT_CHUNK_BYTES,
  ATTACHMENT_CHUNK_CHARS,
  ATTACHMENT_MAX_CHUNKS,
  ATTACHMENT_URL_PREFIX,
  AttachmentError,
  MAX_ATTACHMENT_BYTES,
  attachmentKindOf,
  attachmentUrlFor,
  base64ToBytes,
  bytesToBase64,
  cleanAttachmentName,
  dataUrlToBytes,
  detectAttachmentMimeType,
  formatFileSize,
  groupChunksIntoBatches,
  isAllowedAttachmentMimeType,
  isFirestoreAttachmentUrl,
  joinChunks,
  parseAttachmentMeta,
  parseAttachmentUrl,
  splitIntoChunks,
  validateAttachmentFile,
  writeAttachment,
} from '../src/lib/attachmentsCore';
import type { Firestore } from 'firebase/firestore';

/** Deterministic pseudo-random bytes (every byte value occurs). */
function bytesOf(length: number, seed = 1): Uint8Array {
  const out = new Uint8Array(length);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}

/** A minimal PDF: text header, the binary comment line real PDFs carry, then binary data. */
function pdfBytes(bodyLength: number): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]); // "%PDF-1.7\n%âãÏÓ\n"
  const trailer = new TextEncoder().encode('\n%%EOF\n');
  const out = new Uint8Array(header.length + bodyLength + trailer.length);
  out.set(header, 0);
  out.set(bytesOf(bodyLength, 7), header.length);
  out.set(trailer, header.length + bodyLength);
  return out;
}

const asChunks = (parts: string[]) => parts.map((data, index) => ({ index, data }));
/** The error a call throws (undefined when it does not throw). */
const errorOf = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return undefined;
};
const sameBytes = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));
const MB = 1024 * 1024;

describe('attachment limits', () => {
  it('chunks stay far below the 1 MiB document limit and decode on their own', () => {
    expect(ATTACHMENT_CHUNK_CHARS).toBe(700_000);
    expect(ATTACHMENT_CHUNK_CHARS % 4).toBe(0);
    expect(ATTACHMENT_CHUNK_BYTES).toBe(525_000);
    expect(ATTACHMENT_CHUNK_CHARS + 1024).toBeLessThan(MB);
  });

  it('a batched write stays well under the 10 MiB request limit', () => {
    expect(ATTACHMENT_BATCH_CHARS).toBeLessThanOrEqual(4 * MB);
    expect(MAX_ATTACHMENT_BYTES).toBe(10 * MB);
    expect(ATTACHMENT_MAX_CHUNKS).toBe(20); // firestore.rules accepts up to 32
  });
});

describe('validateAttachmentFile', () => {
  it('accepts PDF, PNG and JPG/JPEG (by type, or by name when the browser gives no type)', () => {
    expect(validateAttachmentFile({ size: 10, type: 'application/pdf', name: 'a.pdf' })).toBe('application/pdf');
    expect(validateAttachmentFile({ size: 10, type: 'image/png', name: 'a.png' })).toBe('image/png');
    expect(validateAttachmentFile({ size: 10, type: 'image/jpeg', name: 'a.jpg' })).toBe('image/jpeg');
    expect(validateAttachmentFile({ size: 10, type: 'image/jpg', name: 'photo' })).toBe('image/jpeg');
    expect(validateAttachmentFile({ size: 10, type: '', name: 'scan.PDF' })).toBe('application/pdf');
    expect(validateAttachmentFile({ size: 10, type: 'application/octet-stream', name: 'scan.jpeg' })).toBe('image/jpeg');
    expect(validateAttachmentFile({ size: 10, type: '', name: 'فاتورة الكهرباء.png' })).toBe('image/png');
  });

  it('refuses an empty file with an Arabic message', () => {
    const err = errorOf(() => validateAttachmentFile({ size: 0, type: 'application/pdf', name: 'a.pdf' }));
    expect(err).toBeInstanceOf(AttachmentError);
    expect(err).toMatchObject({ code: 'empty' });
    expect((err as Error).message).toMatch(/فارغ/);
  });

  it('refuses other types, whatever the name says', () => {
    for (const file of [
      { size: 10, type: 'text/plain', name: 'a.txt' },
      { size: 10, type: 'text/html', name: 'invoice.pdf' },
      { size: 10, type: 'image/gif', name: 'a.gif' },
      { size: 10, type: 'image/svg+xml', name: 'a.svg' },
      { size: 10, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', name: 'a.docx' },
      { size: 10, type: '', name: 'no-extension' },
      { size: 10, type: '', name: 'archive.zip' },
    ]) {
      expect(() => validateAttachmentFile(file), file.name).toThrow(/نوع الملف غير مدعوم/);
    }
  });

  it('accepts exactly 10 MB and refuses one byte more, naming the real limit', () => {
    expect(validateAttachmentFile({ size: MAX_ATTACHMENT_BYTES, type: 'application/pdf', name: 'a.pdf' })).toBe('application/pdf');
    const error = errorOf(() => validateAttachmentFile({ size: MAX_ATTACHMENT_BYTES + 1, type: 'application/pdf', name: 'a.pdf' }));
    expect(error).toBeInstanceOf(AttachmentError);
    expect(error).toMatchObject({ code: 'too_large' });
    expect((error as Error).message).toContain('10 MB');
    expect((error as Error).message).toContain('10.0 MB'); // the file's own size
    expect(() => validateAttachmentFile({ size: 25 * MB, type: 'image/png', name: 'a.png' })).toThrow(/25\.0 MB/);
  });

  it('detectAttachmentMimeType / isAllowedAttachmentMimeType / attachmentKindOf agree', () => {
    expect(detectAttachmentMimeType('application/x-pdf', 'x')).toBe('application/pdf');
    expect(detectAttachmentMimeType('IMAGE/PNG; charset=binary', 'x')).toBe('image/png');
    expect(detectAttachmentMimeType('image/webp', 'x.png')).toBeNull();
    expect(isAllowedAttachmentMimeType('application/pdf')).toBe(true);
    expect(isAllowedAttachmentMimeType('text/html')).toBe(false);
    expect(isAllowedAttachmentMimeType('')).toBe(false);
    expect(attachmentKindOf('application/pdf')).toBe('pdf');
    expect(attachmentKindOf('image/png')).toBe('png');
    expect(attachmentKindOf('image/jpeg')).toBe('jpg');
  });
});

describe('splitIntoChunks', () => {
  it('nothing to split for an empty file', () => {
    expect(splitIntoChunks(new Uint8Array(0))).toEqual([]);
  });

  it('1 byte -> one 4-character chunk; one full chunk at exactly 525,000 bytes; a second one from the next byte', () => {
    expect(splitIntoChunks(new Uint8Array([0xff]))).toEqual(['/w==']);
    const full = splitIntoChunks(bytesOf(ATTACHMENT_CHUNK_BYTES));
    expect(full.map(c => c.length)).toEqual([ATTACHMENT_CHUNK_CHARS]);
    const overflow = splitIntoChunks(bytesOf(ATTACHMENT_CHUNK_BYTES + 1));
    expect(overflow.map(c => c.length)).toEqual([ATTACHMENT_CHUNK_CHARS, 4]);
  });

  it('a 10 MB file is 20 chunks, none above 700,000 characters, each valid base64 on its own', () => {
    const bytes = bytesOf(MAX_ATTACHMENT_BYTES, 3);
    const chunks = splitIntoChunks(bytes);
    expect(chunks).toHaveLength(ATTACHMENT_MAX_CHUNKS);
    for (const chunk of chunks.slice(0, -1)) expect(chunk.length).toBe(ATTACHMENT_CHUNK_CHARS);
    expect(chunks[chunks.length - 1].length).toBeLessThanOrEqual(ATTACHMENT_CHUNK_CHARS);
    for (const chunk of chunks) {
      expect(chunk.length % 4).toBe(0);
      expect(chunk).toMatch(/^[A-Za-z0-9+/]+=*$/);
    }
    // the concatenation is the base64 of the whole file
    expect(chunks.join('')).toBe(Buffer.from(bytes).toString('base64'));
  });

  it('only chunk sizes that are positive multiples of 4 are accepted', () => {
    expect(() => splitIntoChunks(bytesOf(10), 6)).toThrow(RangeError);
    expect(() => splitIntoChunks(bytesOf(10), 0)).toThrow(RangeError);
    // 8 characters = 6 bytes per chunk: 10 bytes -> 6 + 4 (the last one padded)
    expect(splitIntoChunks(bytesOf(10), 8).map(c => c.length)).toEqual([8, 8]);
    expect(splitIntoChunks(bytesOf(10), 8)[1].endsWith('==')).toBe(true);
  });
});

describe('joinChunks (round trip)', () => {
  it('binary data with every byte value comes back identical', () => {
    const all = new Uint8Array(256 * 4).map((_, i) => i % 256);
    expect(sameBytes(joinChunks(asChunks(splitIntoChunks(all, 12)), Math.ceil(all.length / 9), all.length), all)).toBe(true);
    for (const length of [1, 2, 3, 4, 5, 524_999, 525_000, 525_001, 1_050_000, 1_234_567]) {
      const bytes = bytesOf(length, length);
      const chunks = splitIntoChunks(bytes);
      expect(sameBytes(joinChunks(asChunks(chunks), chunks.length, length), bytes), `length ${length}`).toBe(true);
    }
  });

  it('a PDF (header, binary marker line, body, %%EOF) round-trips byte for byte through several chunks', () => {
    const pdf = pdfBytes(1_300_000);
    const chunks = splitIntoChunks(pdf);
    expect(chunks).toHaveLength(3);
    const back = joinChunks(asChunks(chunks), chunks.length, pdf.length);
    expect(sameBytes(back, pdf)).toBe(true);
    expect(new TextDecoder().decode(back.subarray(0, 8))).toBe('%PDF-1.7');
    expect(Array.from(back.subarray(10, 14))).toEqual([0xe2, 0xe3, 0xcf, 0xd3]);
  });

  it('a full 10 MB file round-trips, whatever order the chunk documents arrive in', () => {
    const bytes = bytesOf(MAX_ATTACHMENT_BYTES, 11);
    const chunks = asChunks(splitIntoChunks(bytes)).reverse();
    expect(sameBytes(joinChunks(chunks, ATTACHMENT_MAX_CHUNKS, bytes.length), bytes)).toBe(true);
  });

  it('refuses a missing, extra, duplicate or malformed chunk, and a size that does not match', () => {
    const bytes = bytesOf(1_200_000);
    const chunks = asChunks(splitIntoChunks(bytes));
    expect(chunks).toHaveLength(3);
    expect(() => joinChunks(chunks.slice(0, 2), 3, bytes.length)).toThrow(AttachmentError);
    expect(() => joinChunks(chunks.slice(0, 2), 3, bytes.length)).toThrow(/تالف/);
    expect(() => joinChunks([...chunks, { index: 3, data: 'QUJD' }], 3)).toThrow(AttachmentError);
    expect(() => joinChunks([chunks[0], chunks[0], chunks[2]], 3)).toThrow(AttachmentError);
    expect(() => joinChunks([chunks[0], { index: 1.5, data: chunks[1].data }, chunks[2]], 3)).toThrow(AttachmentError);
    expect(() => joinChunks([chunks[0], { index: '1', data: chunks[1].data }, chunks[2]], 3)).toThrow(AttachmentError);
    expect(() => joinChunks([chunks[0], { index: 1, data: '' }, chunks[2]], 3)).toThrow(AttachmentError);
    expect(() => joinChunks([chunks[0], { index: 1, data: 'not base64 !!' }, chunks[2]], 3)).toThrow(AttachmentError);
    expect(() => joinChunks(chunks, 3, bytes.length + 1)).toThrow(AttachmentError);
    expect(errorOf(() => joinChunks(chunks, 3, bytes.length - 1))).toMatchObject({ code: 'corrupt' });
    expect(errorOf(() => joinChunks(chunks.slice(1), 3))).toMatchObject({ code: 'corrupt' });
    expect(joinChunks([], 0, 0)).toHaveLength(0);
  });

  it('bytesToBase64 / base64ToBytes match Node and refuse garbage', () => {
    const bytes = bytesOf(100_003, 5);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    expect(sameBytes(base64ToBytes(Buffer.from(bytes).toString('base64')), bytes)).toBe(true);
    expect(bytesToBase64(new Uint8Array(0))).toBe('');
    expect(() => base64ToBytes('abc$')).toThrow(AttachmentError);
  });
});

describe('batched writes', () => {
  it('a 10 MB file is written in batches of at most ~2.1 MB, in order, every chunk exactly once', () => {
    const chunks = splitIntoChunks(bytesOf(MAX_ATTACHMENT_BYTES, 9));
    const batches = groupChunksIntoBatches(chunks);
    expect(batches.length).toBe(7);
    for (const batch of batches) {
      const chars = batch.reduce((sum, c) => sum + c.data.length, 0);
      expect(chars).toBeLessThanOrEqual(ATTACHMENT_BATCH_CHARS);
      expect(chars).toBeLessThan(10 * MB / 2);
    }
    expect(batches.flat().map(c => c.index)).toEqual(chunks.map((_, i) => i));
    expect(batches.flat().map(c => c.data)).toEqual(chunks);
  });

  it('small files go in one batch; a chunk above the budget still gets a batch of its own; maxWrites is honoured', () => {
    expect(groupChunksIntoBatches(['AAAA'])).toEqual([[{ index: 0, data: 'AAAA' }]]);
    expect(groupChunksIntoBatches([])).toEqual([]);
    expect(groupChunksIntoBatches(['AAAAAAAA', 'BBBB'], 4).map(b => b.map(c => c.index))).toEqual([[0], [1]]);
    expect(groupChunksIntoBatches(['AAAA', 'BBBB', 'CCCC'], 1000, 2).map(b => b.length)).toEqual([2, 1]);
  });
});

describe('attachment urls', () => {
  it('fsattach://<id> round-trips; other urls are not Firestore attachments', () => {
    const id = '0f8c2a52-6b1e-4c1e-9d55-1d2a3b4c5d6e';
    expect(attachmentUrlFor(id)).toBe(`${ATTACHMENT_URL_PREFIX}${id}`);
    expect(isFirestoreAttachmentUrl(attachmentUrlFor(id))).toBe(true);
    expect(parseAttachmentUrl(attachmentUrlFor(id))).toBe(id);
    for (const url of [undefined, null, '', 'data:image/png;base64,AAAA', 'https://firebasestorage.googleapis.com/v0/b/x/o/y', 'blob:https://app/1']) {
      expect(isFirestoreAttachmentUrl(url)).toBe(false);
      expect(parseAttachmentUrl(url)).toBeNull();
    }
  });

  it('a malformed fsattach url is routed to the loader (which refuses it), never to Firestore paths', () => {
    for (const url of ['fsattach://', 'fsattach://a/b', 'fsattach://../x', 'fsattach://a b']) {
      expect(isFirestoreAttachmentUrl(url)).toBe(true);
      expect(parseAttachmentUrl(url)).toBeNull();
    }
  });
});

describe('older records (data: URLs) keep working', () => {
  it('base64 and percent-encoded data: URLs decode with their type', () => {
    const png = bytesOf(2000, 4);
    const decoded = dataUrlToBytes(`data:image/png;base64,${Buffer.from(png).toString('base64')}`);
    expect(decoded.mimeType).toBe('image/png');
    expect(sameBytes(decoded.bytes, png)).toBe(true);
    const pdf = pdfBytes(500);
    expect(sameBytes(dataUrlToBytes(`data:application/pdf;base64,${Buffer.from(pdf).toString('base64')}`).bytes, pdf)).toBe(true);
    const text = dataUrlToBytes('data:text/plain,hello%20world');
    expect(new TextDecoder().decode(text.bytes)).toBe('hello world');
    expect(text.mimeType).toBe('text/plain');
    expect(dataUrlToBytes('data:;base64,AAAA').mimeType).toBe('');
  });

  it('a string that is not a data: URL is refused', () => {
    expect(() => dataUrlToBytes('https://example.com/a.png')).toThrow(AttachmentError);
    expect(() => dataUrlToBytes('data:image/png;base64')).toThrow(AttachmentError);
  });
});

describe('metadata and names', () => {
  it('parseAttachmentMeta reads a stored document and refuses a malformed one', () => {
    const meta = parseAttachmentMeta(
      { id: 'a1', orgId: 'org-acme', name: 'x.pdf', mimeType: 'application/pdf', size: 10, chunkCount: 1, createdBy: 'u', createdAt: 't', complete: true },
      'a1',
    );
    expect(meta).toMatchObject({ orgId: 'org-acme', size: 10, chunkCount: 1, complete: true });
    expect(parseAttachmentMeta({ orgId: 'o', mimeType: 'image/png', size: 1, chunkCount: 1, complete: 'yes' }, 'a2').complete).toBe(false);
    expect(() => parseAttachmentMeta({ orgId: 'o', mimeType: 'image/png', size: '1', chunkCount: 1 }, 'a3')).toThrow(AttachmentError);
    expect(() => parseAttachmentMeta(undefined, 'a4')).toThrow(AttachmentError);
  });

  it('cleanAttachmentName keeps Arabic names, drops control characters and shortens long names keeping the extension', () => {
    expect(cleanAttachmentName('  فاتورة سبتمبر.pdf ')).toBe('فاتورة سبتمبر.pdf');
    expect(cleanAttachmentName('a\u0000b\nc.png')).toBe('abc.png');
    expect(cleanAttachmentName('')).toBe('attachment');
    const long = cleanAttachmentName(`${'x'.repeat(500)}.pdf`);
    expect(long.length).toBe(200);
    expect(long.endsWith('.pdf')).toBe(true);
  });

  it('formatFileSize', () => {
    expect(formatFileSize(500)).toBe('500 B');
    expect(formatFileSize(2048)).toBe('2.0 KB');
    expect(formatFileSize(10 * MB)).toBe('10.0 MB');
  });
});

describe('writeAttachment refuses before writing anything', () => {
  // Any Firestore call would throw on this stand-in: the checks must come first.
  const noDb = {} as Firestore;
  const pdf = new Blob([pdfBytes(10)], { type: 'application/pdf' });

  it('no company / the placeholder company, signed out, empty, unsupported, too large', async () => {
    await expect(writeAttachment(noDb, 'uid', pdf, { orgId: '', name: 'a.pdf' })).rejects.toMatchObject({ code: 'no_company' });
    await expect(writeAttachment(noDb, 'uid', pdf, { orgId: 'org-main', name: 'a.pdf' })).rejects.toMatchObject({ code: 'no_company' });
    await expect(writeAttachment(noDb, '', pdf, { orgId: 'org-acme', name: 'a.pdf' })).rejects.toMatchObject({ code: 'not_signed_in' });
    await expect(writeAttachment(noDb, 'uid', new Blob([], { type: 'application/pdf' }), { orgId: 'org-acme', name: 'a.pdf' })).rejects.toMatchObject({ code: 'empty' });
    await expect(writeAttachment(noDb, 'uid', new Blob(['<script>'], { type: 'text/html' }), { orgId: 'org-acme', name: 'a.pdf' })).rejects.toMatchObject({ code: 'unsupported_type' });
    const big = new Blob([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)], { type: 'application/pdf' });
    await expect(writeAttachment(noDb, 'uid', big, { orgId: 'org-acme', name: 'big.pdf' })).rejects.toMatchObject({ code: 'too_large' });
  });
});
