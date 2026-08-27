/* ROAD_PATCH_V2: diagonal connectivity + color fix */
window.Game = window.Game || {};

(function () {
  const State = window.Game.State;

  function getNested(obj, path) {
    return String(path || "")
      .split(".")
      .reduce((acc, key) => (acc && Object.prototype.hasOwnProperty.call(acc, key) ? acc[key] : undefined), obj);
  }

  function interpolate(text, vars) {
    return String(text).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
      return vars && vars[key] !== undefined ? String(vars[key]) : "";
    });
  }

  function getLocaleData(lang) {
    const normalized = lang === "tr" ? "tr" : "en";
    const locales = window.Game.Locales || {};
    return locales[normalized] || locales.en || null;
  }

  async function loadLanguage(lang) {
    const normalized = lang === "tr" ? "tr" : "en";
    const localeData = getLocaleData(normalized);

    if (!localeData) {
      throw new Error(`Locale data is not available for language: ${normalized}`);
    }

    State.i18n.current = normalized;
    State.i18n.messages = localeData;
    document.documentElement.lang = normalized;

    try {
      window.localStorage.setItem("appLanguage", normalized);
    } catch (error) {
      // Ignore localStorage access errors.
    }

    if (State.dom && State.dom.languageSelect) {
      State.dom.languageSelect.value = normalized;
    }

    applyTranslations();
    return normalized;
  }

  function getPreferredLanguage() {
    try {
      const saved = window.localStorage.getItem("appLanguage");
      if (saved === "tr" || saved === "en") return saved;
    } catch (error) {
      // Ignore localStorage access errors.
    }
    return "en";
  }

  function t(key, vars) {
    const value = getNested(State.i18n.messages, key);
    if (value === undefined) return key;
    return typeof value === "string" ? interpolate(value, vars) : value;
  }

  function applyTranslations(root) {
    const scope = root || document;

    scope.querySelectorAll("[data-i18n]").forEach((node) => {
      const key = node.getAttribute("data-i18n");
      const value = t(key);
      if (node.getAttribute("data-i18n-html") === "true") {
        node.innerHTML = value;
      } else {
        node.textContent = value;
      }
    });

    scope.querySelectorAll("[data-i18n-attr]").forEach((node) => {
      const pairs = node.getAttribute("data-i18n-attr").split(";");
      pairs.forEach((pair) => {
        const trimmed = pair.trim();
        if (!trimmed) return;
        const [attrName, key] = trimmed.split(":");
        if (!attrName || !key) return;
        node.setAttribute(attrName.trim(), t(key.trim()));
      });
    });
  }

  window.Game.I18n = {
    loadLanguage,
    getPreferredLanguage,
    t,
    applyTranslations
  };
})();
