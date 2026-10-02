import { getStorageInstance, ref, uploadBytes, getDownloadURL, deleteObject, auth } from '../lib/firebase';
import { RequestAttachment } from '../types';
import { newId, uuid } from './ids';
import { localToday } from './requestUi';

/**
 * Format bytes to human readable format (KB, MB)
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Compress an image file using an offscreen HTML Canvas.
 * Reduces 3-10MB mobile phone camera pictures to ~60-120KB JPEG
 * while keeping invoice text, stamps, and numbers razor sharp.
 */
export async function compressImage(
  file: File,
  maxWidth = 1280,
  maxHeight = 1280,
  quality = 0.82
): Promise<{ dataUrl: string; sizeString: string; byteSize: number }> {
  return new Promise((resolve, reject) => {
    // If not an image, reject
    if (!file.type.startsWith('image/')) {
      reject(new Error('الملف ليس صورة صالحة للضغط'));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('فشل قراءة ملف الصورة'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('فشل معالجة محتوى الصورة'));
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        // Calculate aspect-ratio preserved dimensions
        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          // Fallback to original DataURL if canvas context fails
          const originalData = e.target?.result as string;
          resolve({
            dataUrl: originalData,
            sizeString: formatFileSize(file.size),
            byteSize: file.size,
          });
          return;
        }

        // Draw image smoothly
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        // Export as optimized JPEG
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        
        // Calculate approximate size of base64 DataURL
        const byteSize = Math.round((dataUrl.length * 3) / 4);
        resolve({
          dataUrl,
          sizeString: formatFileSize(byteSize),
          byteSize,
        });
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Convert base64 DataURL to Blob
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',');
  const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
  const bstr = atob(parts[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

/**
 * Safely open any file/attachment in a new browser window/tab.
 * If it's a base64 Data URL, converts it to an in-memory Blob URL first,
 * completely avoiding modern Chromium's "Not allowed to navigate top frame to data URL" block.
 */
export function openFileSafely(url: string, fileName = 'document'): void {
  if (!url) return;
  if (url.startsWith('data:')) {
    try {
      const blob = dataUrlToBlob(url);
      const blobUrl = URL.createObjectURL(blob);
      const newWin = window.open(blobUrl, '_blank');
      if (!newWin || newWin.closed || typeof newWin.closed === 'undefined') {
        // Fallback if popup blocked
        downloadFileSafely(url, fileName);
      }
      setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
      return;
    } catch (err) {
      console.warn('[openFileSafely] Blob URL generation failed, falling back:', err);
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Safely trigger browser download for any file/attachment.
 * Works seamlessly with both remote URLs and base64 Data URLs.
 */
export function downloadFileSafely(url: string, fileName = 'attachment'): void {
  if (!url) return;
  try {
    let downloadHref = url;
    let shouldRevoke = false;
    if (url.startsWith('data:')) {
      const blob = dataUrlToBlob(url);
      downloadHref = URL.createObjectURL(blob);
      shouldRevoke = true;
    }
    const a = document.createElement('a');
    a.href = downloadHref;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (shouldRevoke) {
      setTimeout(() => URL.revokeObjectURL(downloadHref), 45000);
    }
  } catch (err) {
    console.error('[downloadFileSafely] Download failed:', err);
    window.open(url, '_blank');
  }
}

/**
 * Upload an invoice or receipt file.
 * Handles compression for images, uploads to Firebase Storage with strict tenant pathing,
 * and records metadata.
 * Fails explicitly if storage upload cannot be completed (no silent base64 fallback).
 */
export async function processAndUploadInvoice(
  file: File,
  orgId: string,
  requestId?: string
): Promise<RequestAttachment> {
  const cleanOrgId = (orgId || '').trim();
  if (!cleanOrgId || cleanOrgId === 'org-main') {
    throw new Error('تعذر رفع الملف: يجب تحديد الشركة أولاً لضمان عزل وتأمين الملفات.');
  }

  const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const now = new Date();
  const dateFormatted = localToday(now);
  const isImage = file.type.startsWith('image/');
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

  if (!isImage && !isPdf) {
    throw new Error('نوع الملف غير مدعوم. يُسمح فقط برفع الصور (PNG, JPG) ومستندات PDF.');
  }

  let finalSize = formatFileSize(file.size);
  let fileType = isPdf ? 'pdf' : (file.type.includes('png') ? 'png' : 'jpg');

  // Step 1: Compress if image
  let blobToUpload: Blob = file;

  if (isImage) {
    try {
      const compressed = await compressImage(file);
      finalSize = compressed.sizeString;
      blobToUpload = dataUrlToBlob(compressed.dataUrl);
    } catch (compressionErr) {
      console.warn('[Invoice Upload] Compression skipped, using raw file:', compressionErr);
    }
  }

  // Step 2: Upload to Firebase Storage
  const storage = getStorageInstance();
  if (!storage) {
    throw new Error('تعذر رفع المستند: خدمة التخزين السحابية (Firebase Storage) غير متصلة أو غير مهيأة.');
  }

  const storagePath = `invoices/${cleanOrgId}/${requestId || 'new'}_${uuid()}_${cleanName}`;
  const storageRef = ref(storage, storagePath);

  let finalUrl = '';
  try {
    const snapshot = await uploadBytes(storageRef, blobToUpload, {
      contentType: blobToUpload.type || file.type || (isPdf ? 'application/pdf' : 'image/jpeg'),
      customMetadata: {
        originalName: file.name,
        orgId: cleanOrgId,
        uploadedAt: now.toISOString(),
        uploaderUid: auth?.currentUser?.uid || '',
      }
    });

    finalUrl = await getDownloadURL(snapshot.ref);
  } catch (storageErr: any) {
    console.error('[Firebase Storage] Upload failed:', storageErr);
    const reason = storageErr?.message ? ` (${storageErr.message})` : '';
    throw new Error(
      `فشل رفع المستند إلى وحدة التخزين السحابية الآمنة${reason}. يرجى التحقق من الاتصال بالإنترنت وصلاحيات حسابك وإعادة المحاولة.`
    );
  }

  return {
    id: newId('att'),
    name: file.name,
    size: finalSize,
    type: fileType,
    url: finalUrl,
    storagePath,
    uploadedAt: dateFormatted,
  };
}

/**
 * Safely delete an attachment file from Firebase Storage.
 */
export async function deleteAttachmentFile(storagePath: string): Promise<void> {
  if (!storagePath) return;
  const storage = getStorageInstance();
  if (!storage) {
    throw new Error('تعذر حذف المستند: وحدة التخزين السحابية غير متصلة.');
  }
  const storageRef = ref(storage, storagePath);
  await deleteObject(storageRef);
}
