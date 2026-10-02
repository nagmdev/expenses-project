/**
 * Visa documents and custody invoices are stored in Firestore (src/lib/attachments.ts) via
 * src/utils/recordAttachments.ts: only PDF / PNG / JPG, images compressed first (the smaller
 * copy is kept), the record's company as owner, and every failure explained in Arabic.
 * Firestore and the browser canvas are replaced by fakes here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const saveAttachment = vi.fn();
const deleteAttachment = vi.fn();
const compressImage = vi.fn();

vi.mock('../src/lib/attachments', async () => {
  const core = await import('../src/lib/attachmentsCore');
  return { ...core, saveAttachment, deleteAttachment };
});

vi.mock('../src/utils/fileUpload', async () => {
  const core = await import('../src/lib/attachmentsCore');
  return {
    compressImage,
    dataUrlToBlob: (dataUrl: string) => {
      const { bytes, mimeType } = core.dataUrlToBytes(dataUrl);
      return new Blob([bytes], { type: mimeType || 'image/jpeg' });
    },
  };
});

const {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_LIMIT_LABEL,
  UNSUPPORTED_ATTACHMENT_MESSAGE,
  acceptedAttachmentMime,
  arabicErrorMessage,
  discardStoredAttachment,
  storeRecordAttachment,
} = await import('../src/utils/recordAttachments');
const { AttachmentError } = await import('../src/lib/attachmentsCore');

const fileOf = (size: number, name: string, type: string) => new File([new Uint8Array(size).fill(7)], name, { type });
const jpegDataUrl = (size: number) => `data:image/jpeg;base64,${Buffer.from(new Uint8Array(size).fill(9)).toString('base64')}`;
const stored = (over: Record<string, unknown> = {}) => ({
  attachmentId: 'a1',
  url: 'fsattach://a1',
  name: 'doc.pdf',
  size: 10,
  mimeType: 'application/pdf',
  ...over,
});

beforeEach(() => {
  saveAttachment.mockReset();
  deleteAttachment.mockReset();
  compressImage.mockReset();
});

describe('accepted types and labels', () => {
  it('accepts PDF, PNG and JPG/JPEG only (by type, or by name when the browser gives none)', () => {
    expect(acceptedAttachmentMime(fileOf(1, 'a.pdf', 'application/pdf'))).toBe('application/pdf');
    expect(acceptedAttachmentMime(fileOf(1, 'a.png', 'image/png'))).toBe('image/png');
    expect(acceptedAttachmentMime(fileOf(1, 'a.jpg', 'image/jpg'))).toBe('image/jpeg');
    expect(acceptedAttachmentMime(fileOf(1, 'scan.PDF', ''))).toBe('application/pdf');
    expect(acceptedAttachmentMime(fileOf(1, 'scan.pdf', 'application/octet-stream'))).toBe('application/pdf');
    expect(acceptedAttachmentMime(fileOf(1, 'photo.heic', 'image/heic'))).toBe('');
    expect(acceptedAttachmentMime(fileOf(1, 'page.html', 'text/html'))).toBe('');
    expect(acceptedAttachmentMime(fileOf(1, 'notes', ''))).toBe('');
  });

  it('shows the real 10 MB limit and offers only the accepted extensions', () => {
    expect(ATTACHMENT_LIMIT_LABEL).toBe('10 ميجابايت');
    expect(ATTACHMENT_ACCEPT).toBe('.pdf,.png,.jpg,.jpeg');
  });

  it('keeps only Arabic error messages', () => {
    expect(arabicErrorMessage(new Error('المرفق غير موجود'))).toBe('المرفق غير موجود');
    expect(arabicErrorMessage(new Error('Missing or insufficient permissions.'))).toBe('');
    expect(arabicErrorMessage(undefined)).toBe('');
  });
});

describe('storeRecordAttachment', () => {
  it('refuses an unsupported file before touching Firestore', async () => {
    await expect(storeRecordAttachment(fileOf(10, 'x.gif', 'image/gif'), 'org-a')).rejects.toThrow(UNSUPPORTED_ATTACHMENT_MESSAGE);
    expect(saveAttachment).not.toHaveBeenCalled();
    expect(compressImage).not.toHaveBeenCalled();
  });

  it('stores a PDF as is, under the record company, with its real type even when the browser gave none', async () => {
    saveAttachment.mockResolvedValue(stored());
    const result = await storeRecordAttachment(fileOf(2048, 'visa.pdf', ''), 'org-a');
    expect(result.url).toBe('fsattach://a1');
    expect(compressImage).not.toHaveBeenCalled();
    const [blob, opts] = saveAttachment.mock.calls[0];
    expect(opts).toEqual({ orgId: 'org-a', name: 'visa.pdf' });
    expect((blob as Blob).type).toBe('application/pdf');
    expect((blob as Blob).size).toBe(2048);
  });

  it('stores the compressed copy of an image when it is smaller', async () => {
    saveAttachment.mockResolvedValue(stored({ mimeType: 'image/jpeg' }));
    compressImage.mockResolvedValue({ dataUrl: jpegDataUrl(300), sizeString: '', byteSize: 300 });
    await storeRecordAttachment(fileOf(50_000, 'receipt.png', 'image/png'), 'org-b');
    const [blob, opts] = saveAttachment.mock.calls[0];
    expect((blob as Blob).size).toBe(300);
    expect((blob as Blob).type).toBe('image/jpeg');
    expect(opts).toEqual({ orgId: 'org-b', name: 'receipt.png' });
  });

  it('keeps the original image when compression makes it bigger or fails', async () => {
    saveAttachment.mockResolvedValue(stored({ mimeType: 'image/png' }));
    compressImage.mockResolvedValueOnce({ dataUrl: jpegDataUrl(900), sizeString: '', byteSize: 900 });
    await storeRecordAttachment(fileOf(500, 'small.png', 'image/png'), 'org-b');
    expect((saveAttachment.mock.calls[0][0] as Blob).size).toBe(500);
    expect((saveAttachment.mock.calls[0][0] as Blob).type).toBe('image/png');

    compressImage.mockRejectedValueOnce(new Error('canvas unavailable'));
    await storeRecordAttachment(fileOf(700, 'photo.jpg', 'image/jpeg'), 'org-b');
    expect((saveAttachment.mock.calls[1][0] as Blob).size).toBe(700);
  });

  it('passes the Arabic reason of a refused upload through (e.g. too large) and explains any other failure in Arabic', async () => {
    const tooLarge = new AttachmentError('too_large', 'حجم الملف (12.0 MB) أكبر من الحد المسموح به (10 MB).');
    saveAttachment.mockRejectedValueOnce(tooLarge);
    await expect(storeRecordAttachment(fileOf(10, 'big.pdf', 'application/pdf'), 'org-a')).rejects.toThrow(tooLarge.message);

    saveAttachment.mockRejectedValueOnce(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }));
    const failure = await storeRecordAttachment(fileOf(10, 'x.pdf', 'application/pdf'), 'org-a').catch(err => err as Error);
    expect(failure).toBeInstanceOf(Error);
    expect(arabicErrorMessage(failure)).not.toBe('');
  });
});

describe('discardStoredAttachment', () => {
  it('deletes the unused copy and never throws (a failed delete only leaves an unused copy)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    deleteAttachment.mockRejectedValueOnce(new Error('offline'));
    expect(() => discardStoredAttachment('fsattach://a1')).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(deleteAttachment).toHaveBeenCalledWith('fsattach://a1');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does nothing without a url', () => {
    discardStoredAttachment('');
    discardStoredAttachment(undefined);
    expect(deleteAttachment).not.toHaveBeenCalled();
  });
});
