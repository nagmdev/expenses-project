import { getStorageInstance, ref, uploadBytes, getDownloadURL } from '../lib/firebase';
import { RequestAttachment } from '../types';

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
 * Handles compression for images, attempts Firebase Storage upload (free Spark plan),
 * and seamlessly falls back to ultra-lightweight DataURL.
 */
export async function processAndUploadInvoice(
  file: File,
  orgId: string = 'org-main',
  requestId?: string
): Promise<RequestAttachment> {
  const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const now = new Date();
  const dateFormatted = now.toISOString().split('T')[0];
  const isImage = file.type.startsWith('image/');
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

  let finalUrl = '';
  let finalSize = formatFileSize(file.size);
  let fileType = isPdf ? 'pdf' : (file.type.includes('png') ? 'png' : 'jpg');

  // Step 1: Compress if image
  let blobToUpload: Blob = file;
  let fallbackDataUrl = '';

  if (isImage) {
    try {
      const compressed = await compressImage(file);
      fallbackDataUrl = compressed.dataUrl;
      finalSize = compressed.sizeString;
      blobToUpload = dataUrlToBlob(compressed.dataUrl);
    } catch (compressionErr) {
      console.warn('[Invoice Upload] Compression skipped, using raw file:', compressionErr);
    }
  }

  // Step 2: Attempt Firebase Storage upload (Free Spark tier up to 5GB)
  let storageUploadSucceeded = false;
  try {
    const storage = getStorageInstance();
    if (storage) {
      const storagePath = `invoices/${orgId}/${requestId || 'new'}_${Date.now()}_${cleanName}`;
      const storageRef = ref(storage, storagePath);
      
      const snapshot = await uploadBytes(storageRef, blobToUpload, {
        contentType: blobToUpload.type || file.type,
        customMetadata: {
          originalName: file.name,
          orgId,
          uploadedAt: now.toISOString(),
        }
      });

      finalUrl = await getDownloadURL(snapshot.ref);
      storageUploadSucceeded = true;
    }
  } catch (storageErr) {
    console.warn('[Firebase Storage] Direct upload not available or rules restricted, falling back to data URL:', storageErr);
  }

  // Step 3: Fallback if Storage was not used or failed
  if (!storageUploadSucceeded || !finalUrl) {
    if (fallbackDataUrl) {
      finalUrl = fallbackDataUrl;
    } else {
      if (file.size > 800 * 1024) {
        throw new Error(`حجم ملف المستند كبير (${formatFileSize(file.size)}). لضمان حفظ الملف بشكل دائم ومؤكد، يرجى رفع ملف PDF أقل من 750 كيلوبايت أو تصوير الفاتورة كصورة عادية (حيث تُضغط الصور تلقائياً لأعلى جودة وأصغر حجم).`);
      }
      // Read raw as DataURL
      finalUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = () => reject(new Error('فشل قراءة الملف'));
        reader.readAsDataURL(file);
      });
    }
  }

  return {
    id: `att-${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    name: file.name,
    size: finalSize,
    type: fileType,
    url: finalUrl,
    uploadedAt: dateFormatted,
  };
}
