import 'server-only';

/**
 * Node's ICU list is the authority — the browser's can be a different V8
 * vintage, and a zone the browser does not know is still valid in Postgres.
 * So the server computes the list once and hands it to the select.
 */
let cached: string[] | undefined;

export function timeZoneList(): string[] {
  if (cached) return cached;
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  const list = supported ? supported.call(Intl, 'timeZone') : null;
  const base = Array.isArray(list) && list.length > 0 ? list : ['UTC', 'Asia/Kolkata', 'Europe/London', 'America/New_York'];
  // Postgres accepts these too and they are what a business actually picks.
  cached = [...new Set(base)].sort((a, b) => a.localeCompare(b));
  return cached;
}

export function isKnownTimeZone(value: string): boolean {
  return timeZoneList().includes(value);
}

const CURRENCIES = [
  ['INR', 'Indian rupee'],
  ['USD', 'US dollar'],
  ['EUR', 'Euro'],
  ['GBP', 'British pound'],
  ['AUD', 'Australian dollar'],
  ['CAD', 'Canadian dollar'],
  ['SGD', 'Singapore dollar'],
  ['AED', 'UAE dirham'],
  ['SAR', 'Saudi riyal'],
  ['ZAR', 'South African rand'],
  ['JPY', 'Japanese yen'],
  ['CNY', 'Chinese yuan'],
  ['CHF', 'Swiss franc'],
  ['NZD', 'New Zealand dollar'],
  ['LKR', 'Sri Lankan rupee'],
  ['BDT', 'Bangladeshi taka'],
  ['NPR', 'Nepalese rupee'],
  ['MYR', 'Malaysian ringgit'],
] as const;

export function currencyChoices(): { code: string; label: string }[] {
  return CURRENCIES.map(([code, label]) => ({ code, label }));
}

const LOCALES = [
  ['en-IN', 'English (India)'],
  ['en-US', 'English (US)'],
  ['en-GB', 'English (UK)'],
  ['en-AU', 'English (Australia)'],
  ['ta-IN', 'Tamil (India)'],
  ['hi-IN', 'Hindi (India)'],
  ['te-IN', 'Telugu (India)'],
  ['ml-IN', 'Malayalam (India)'],
  ['fr-FR', 'French (France)'],
  ['de-DE', 'German (Germany)'],
  ['es-ES', 'Spanish (Spain)'],
  ['pt-BR', 'Portuguese (Brazil)'],
  ['ja-JP', 'Japanese (Japan)'],
  ['zh-CN', 'Chinese (Simplified)'],
] as const;

export function localeChoices(): { code: string; label: string }[] {
  return LOCALES.map(([code, label]) => ({ code, label }));
}
