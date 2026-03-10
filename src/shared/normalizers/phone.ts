import { parsePhoneNumberFromString, type PhoneNumber } from 'libphonenumber-js';

/**
 * Normalize a raw phone string to E.164 format.
 * Returns null if input is empty, invalid, or unparseable.
 * Assumes US numbers by default (country code 'US').
 */
export function normalizePhone(raw: string | undefined | null): string | null {
  if (!raw || typeof raw !== 'string') return null;

  // Clean up common noise
  let cleaned = raw.trim();
  if (!cleaned) return null;

  // Remove parentheses but preserve + sign
  // Handle formats like "(+877) 449-5079" → "+877 449-5079"
  cleaned = cleaned.replace(/\(\+/g, '+').replace(/[()]/g, '');

  let phone: PhoneNumber | undefined;

  // Try parsing as-is first (handles numbers with country code)
  phone = parsePhoneNumberFromString(cleaned);
  if (phone && phone.isValid()) {
    return phone.format('E.164');
  }

  // Try with explicit US country code
  phone = parsePhoneNumberFromString(cleaned, 'US');
  if (phone && phone.isValid()) {
    return phone.format('E.164');
  }

  // Strip everything except digits and +
  const digitsOnly = cleaned.replace(/[^\d+]/g, '');
  if (digitsOnly.length < 7) return null;

  // Try digits-only with US default
  phone = parsePhoneNumberFromString(digitsOnly, 'US');
  if (phone && phone.isValid()) {
    return phone.format('E.164');
  }

  // Try prepending +1 for US numbers that might have a + but no country code
  // e.g., "+877 449-5079" → the + isn't the country code, 877 is an area code
  const rawDigits = digitsOnly.replace(/\+/g, '');
  if (rawDigits.length === 10) {
    phone = parsePhoneNumberFromString('+1' + rawDigits);
    if (phone && phone.isValid()) {
      return phone.format('E.164');
    }
  }

  // Try with +
  phone = parsePhoneNumberFromString('+' + rawDigits, 'US');
  if (phone && phone.isValid()) {
    return phone.format('E.164');
  }

  return null;
}
