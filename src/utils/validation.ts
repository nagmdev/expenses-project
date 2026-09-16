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
