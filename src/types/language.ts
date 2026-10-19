export const AVAILABLE_LANGUAGES = ['es', 'de', 'en', 'fr'] as const;

export type LanguageCode = (typeof AVAILABLE_LANGUAGES)[number];

export function isLanguageCode(code: string): code is LanguageCode {
  return (AVAILABLE_LANGUAGES as readonly string[]).includes(code);
}
