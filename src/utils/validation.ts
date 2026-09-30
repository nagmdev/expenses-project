import React from 'react';

/**
 * Input sanitization and validation utility for "مصروفي"
 * Enforces strict data types: numbers-only, phone, decimal amounts, alphanumeric codes, IBAN, and email.
 */

// 1. Enforce ONLY digits (0-9). Strip any letters, symbols, and whitespace.
export const sanitizeDigitsOnly = (val: string, maxLength?: number): string => {
  if (!val) return '';
  const cleaned = val.replace(/\D/g, '');
  return maxLength ? cleaned.slice(0, maxLength) : cleaned;
};

// 2. Enforce Phone Number: optional leading '+', followed strictly by digits only
export const sanitizePhone = (val: string, maxLength = 16): string => {
  if (!val) return '';
  const trimmed = val.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  const combined = hasPlus ? `+${digits}` : digits;
  return combined.slice(0, maxLength);
};

// 3. Enforce Financial Amount: positive number with at most one decimal point and 2 decimal places
export const sanitizeAmount = (val: string, maxDecimals = 2): string => {
  if (!val) return '';
  // Strip anything that is not a digit or dot
  const cleaned = val.replace(/[^0-9.]/g, '');
  
  // Ensure at most one decimal point and max decimals
  const firstDotIndex = cleaned.indexOf('.');
  if (firstDotIndex !== -1) {
    const integerPart = cleaned.slice(0, firstDotIndex);
    const decimalPart = cleaned.slice(firstDotIndex + 1).replace(/\./g, '').slice(0, maxDecimals);
    return `${integerPart}.${decimalPart}`;
  }
  
  return cleaned;
};

// 4. Enforce uppercase alphanumeric code (e.g. Org Code: OFQ, Service Code: SRV1)
export const sanitizeCode = (val: string, maxLength = 8): string => {
  if (!val) return '';
  return val.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, maxLength);
};

// 5. Enforce IBAN: letters and digits only, uppercase (e.g. SA038000..., EG380002...)
export const sanitizeIBAN = (val: string, maxLength = 34): string => {
  if (!val) return '';
  return val.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, maxLength);
};

// 6. Enforce Tax Number / Commercial Registration (digits only)
export const sanitizeTaxOrCR = (val: string, maxLength = 15): string => {
  if (!val) return '';
  return val.replace(/\D/g, '').slice(0, maxLength);
};

// 7. Enforce Digital Wallet Phone (11 digits for Egyptian mobile networks 010, 011, 012, 015)
export const sanitizeDigitalWallet = (val: string): string => {
  return sanitizeDigitsOnly(val, 15);
};

// 8. Enforce InstaPay address: either mobile number (digits only) or IPA handle (user@instapay)
export const sanitizeInstaPay = (val: string): string => {
  if (!val) return '';
  // If it contains '@', allow alphanumeric, dots, hyphens, and '@'
  if (val.includes('@')) {
    return val.replace(/[^a-zA-Z0-9.@_-]/g, '').toLowerCase().slice(0, 50);
  }
  // Otherwise if numeric, allow digits only
  return val.replace(/[^a-zA-Z0-9.@_-]/g, '').slice(0, 50);
};

// 9. KeyDown blocker: prevent invalid characters like 'e', 'E', '+', '-', etc. in numeric inputs
export const handleNumericKeyDown = (
  e: React.KeyboardEvent<HTMLInputElement>, 
  allowDecimal = false
) => {
  // Disallow exponential, signs
  if (['e', 'E', '+', '-'].includes(e.key)) {
    e.preventDefault();
  }
  // Disallow decimal point if integer-only
  if (!allowDecimal && (e.key === '.' || e.key === ',')) {
    e.preventDefault();
  }
};

// 10. Email validation helper
export const isValidEmail = (email: string): boolean => {
  const re = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return re.test(email.trim());
};

// 11. IBAN (ISO 13616): country code + 2 check digits + account part; the whole number
// must pass the mod-97 check. Lengths of the countries the companies deal with most.
const IBAN_LENGTHS: Record<string, number> = {
  EG: 29, SA: 24, AE: 23, KW: 30, QA: 29, BH: 22, OM: 23, JO: 30, LB: 28, IQ: 23, PS: 29,
  TR: 26, LY: 25, TN: 24, DZ: 26, MA: 28, SD: 18,
  GB: 22, DE: 22, FR: 27, IT: 27, ES: 24, NL: 18, BE: 16, CH: 21, AT: 20, IE: 22, PT: 25, SE: 24,
};

const compactIBAN = (val: string) => (val || '').replace(/[\s-]/g, '').toUpperCase();

const ibanChecksumOk = (iban: string): boolean => {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    const digits = code >= 65 && code <= 90 ? String(code - 55) : ch;
    for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
};

/** Arabic error for an invalid IBAN, or null when it is valid. */
export const ibanError = (val: string): string | null => {
  const iban = compactIBAN(val);
  if (!iban) return '⚠️ يرجى إدخال رقم الحساب البنكي / الآيبان للمستفيد';
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) {
    return '⚠️ رقم الآيبان غير صحيح: يبدأ برمز الدولة ثم رقمين (مثل EG38...) ويتكون من حروف إنجليزية وأرقام فقط.';
  }
  const expected = IBAN_LENGTHS[iban.slice(0, 2)];
  if (expected && iban.length !== expected) {
    return `⚠️ رقم الآيبان لحسابات (${iban.slice(0, 2)}) يتكون من ${expected} حرفاً ورقماً، والرقم المُدخل ${iban.length}. يرجى مراجعته.`;
  }
  if (!ibanChecksumOk(iban)) {
    return '⚠️ رقم الآيبان غير صحيح (رقما التحقق لا يطابقان باقي الرقم). انسخه كما هو من كشف الحساب أو تطبيق البنك.';
  }
  return null;
};

export const isValidIBAN = (val: string): boolean => ibanError(val) === null;

// 12. E-wallet number: an Egyptian wallet is an 11-digit mobile number (010/011/012/015);
// other countries' wallet numbers are 8-15 digits.
export const walletNumberError = (val: string): string | null => {
  const digits = (val || '').replace(/\D/g, '');
  if (!digits) return '⚠️ يرجى إدخال رقم المحفظة الإلكترونية للمستفيد';
  if (digits.startsWith('01')) {
    return /^01[0125]\d{8}$/.test(digits)
      ? null
      : '⚠️ رقم المحفظة غير صحيح: رقم المحفظة المصرية 11 رقماً ويبدأ بـ 010 أو 011 أو 012 أو 015.';
  }
  return digits.length >= 8 && digits.length <= 15 ? null : '⚠️ رقم المحفظة غير صحيح: يرجى إدخال رقم الهاتف المسجل عليه المحفظة كاملاً.';
};

// 13. Beneficiary name (the name registered on the receiving InstaPay / bank account):
// at least a first and a family name, letters only (no numbers or symbols).
export const beneficiaryNameError = (val: string): string | null => {
  const name = (val || '').trim().replace(/\s+/g, ' ');
  if (!name) return '⚠️ يرجى إدخال اسم المستفيد الرباعي كما هو مسجل في حسابه (مطلوب لمطابقة التحويل)';
  if (/[0-9٠-٩@#$%^&*_=+<>{}[\]\\|/~`!?؟"]/.test(name) || name.replace(/[\s.'-]/g, '').length < 3) {
    return '⚠️ اسم المستفيد غير صحيح: اكتب الاسم بالحروف فقط كما هو مسجل في حساب المستفيد';
  }
  if (name.split(' ').length < 2) {
    return '⚠️ يرجى كتابة اسم المستفيد كاملاً (الاسم الأول واسم العائلة على الأقل، ويفضل الرباعي) كما هو مسجل في حسابه';
  }
  return null;
};

// 14. InstaPay address: an IPA handle (name@instapay) or the mobile number linked to it.
export const instapayAddressError = (val: string): string | null => {
  const v = (val || '').trim().toLowerCase();
  if (!v) return '⚠️ يرجى إدخال عنوان إنستاباي أو رقم الهاتف للمستفيد';
  if (v.includes('@')) {
    return /^[a-z0-9][a-z0-9._-]*@instapay$/.test(v)
      ? null
      : '⚠️ عنوان إنستاباي غير صحيح: يكون بالشكل name@instapay (حروف إنجليزية وأرقام فقط قبل @instapay).';
  }
  const digits = v.replace(/[\s-]/g, '');
  if (!/^\+?\d+$/.test(digits)) {
    return '⚠️ عنوان إنستاباي غير صحيح: اكتب العنوان بالشكل name@instapay أو رقم الهاتف المرتبط به.';
  }
  const local = digits.replace(/^\+?20/, '0');
  if (local.startsWith('01')) {
    return /^01[0125]\d{8}$/.test(local)
      ? null
      : '⚠️ رقم الهاتف غير صحيح: رقم الموبايل المصري 11 رقماً ويبدأ بـ 010 أو 011 أو 012 أو 015.';
  }
  return digits.replace('+', '').length >= 8 && digits.replace('+', '').length <= 15
    ? null
    : '⚠️ رقم الهاتف غير صحيح: يرجى إدخال رقم الهاتف المرتبط بحساب إنستاباي كاملاً.';
};
