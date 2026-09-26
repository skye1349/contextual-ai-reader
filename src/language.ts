export interface LanguageOption {
  code: string;
  label: string;
  promptName: string;
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: "auto", label: "Auto detect", promptName: "the detected source language" },
  { code: "zh-CN", label: "Simplified Chinese", promptName: "Simplified Chinese" },
  { code: "zh-TW", label: "Traditional Chinese", promptName: "Traditional Chinese" },
  { code: "en", label: "English", promptName: "English" },
  { code: "ja", label: "Japanese", promptName: "Japanese" },
  { code: "ko", label: "Korean", promptName: "Korean" },
  { code: "fr", label: "French", promptName: "French" },
  { code: "de", label: "German", promptName: "German" },
  { code: "es", label: "Spanish", promptName: "Spanish" },
  { code: "it", label: "Italian", promptName: "Italian" },
  { code: "pt", label: "Portuguese", promptName: "Portuguese" },
  { code: "ru", label: "Russian", promptName: "Russian" },
  { code: "ar", label: "Arabic", promptName: "Arabic" }
];

export function getLanguageOption(code: string): LanguageOption {
  const normalized = code.toLowerCase();
  const base = normalized.split("-")[0];
  return LANGUAGE_OPTIONS.find((option) => option.code.toLowerCase() === normalized)
    ?? LANGUAGE_OPTIONS.find((option) => option.promptName.toLowerCase() === normalized)
    ?? LANGUAGE_OPTIONS.find((option) => option.code.toLowerCase() === base)
    ?? LANGUAGE_OPTIONS[0];
}

export function getLanguagePromptName(code: string): string {
  return getLanguageOption(code).promptName;
}

export function getGoogleTranslateLanguageCode(code: string): string {
  return code === "auto" ? "auto" : getLanguageOption(code).code;
}

export function isChineseTargetLanguage(code: string): boolean {
  return code === "zh-CN" || code === "zh-TW";
}
