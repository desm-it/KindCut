import { describe, expect, it } from "vitest";
import { DEFAULT_LANGUAGE, createTranslator, loadLanguagePreference, saveLanguagePreference, translateValidationMessage } from "./i18n";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));

  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("i18n", () => {
  it("defaults the UI to Dutch", () => {
    expect(DEFAULT_LANGUAGE).toBe("nl");
    expect(createTranslator().language).toBe("nl");
    expect(createTranslator().t("welcome.eyebrow")).toBe("Lokale knutselhulp");
  });

  it("keeps English available through the same keys", () => {
    const t = createTranslator("en").t;

    expect(t("welcome.eyebrow")).toBe("Local craft helper");
    expect(t("buttons.preparePreview")).toBe("Prepare preview");
  });

  it("round-trips the saved language through renderer localStorage", () => {
    const storage = memoryStorage();

    expect(loadLanguagePreference(storage)).toBe("nl");
    saveLanguagePreference(storage, "en");
    expect(loadLanguagePreference(storage)).toBe("en");
    saveLanguagePreference(storage, "nl");
    expect(loadLanguagePreference(storage)).toBe("nl");
  });

  it("falls back to Dutch for unsupported saved values", () => {
    expect(loadLanguagePreference(memoryStorage({ kindcutLanguage: "fr" }))).toBe("nl");
  });

  it("translates known project validation messages", () => {
    expect(translateValidationMessage("Project recipe is internally consistent.", "nl")).toBe(
      "Het projectrecept klopt intern.",
    );
    expect(translateValidationMessage("Project recipe is internally consistent.", "en")).toBe(
      "Project recipe is internally consistent.",
    );
  });
});
