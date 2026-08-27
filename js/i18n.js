export const SUPPORTED_LOCALES = Object.freeze(['en', 'tr']);

const MESSAGES = Object.freeze({
  en: Object.freeze({
    'skip.content': 'Skip to content',
    'shell.menu': 'Menu',
    'shell.language': 'Language',
    'shell.phase': 'Phase 2',
    'shell.title': 'Seeded Checks and RNG Contract',
    'nav.campaign': 'Campaign',
    'nav.save': 'Save',
    'core.eyebrow': 'Core rule',
    'core.title': 'Advise. The character decides.',
    'core.rule': 'Player advises → AI Character decides → Simulation validates → World reacts.',
    'campaign.eyebrow': 'Authoritative simulation state',
    'campaign.title': 'Current campaign',
    'campaign.help': 'The visible state below is authoritative only after deterministic simulation validation.',
    'campaign.id': 'Campaign',
    'campaign.seed': 'Seed',
    'campaign.turn': 'Turn',
    'campaign.character': 'Character',
    'campaign.rank': 'Rank',
    'campaign.gold': 'Gold',
    'save.eyebrow': 'Versioned JSON',
    'save.title': 'Save, export, and import',
    'save.help': 'Export produces the supported campaign schema only. Import is parsed and validated before state replacement.',
    'save.label': 'Campaign JSON',
    'save.fieldHelp': 'Export fills this field. You can also paste compatible campaign JSON here before importing.',
    'save.export': 'Export JSON',
    'save.import': 'Import JSON',
    'save.reset': 'Reset demo state',
    'footer.note': 'Early development build · Static client · No mandatory backend or external AI provider',
    'status.starting': 'Starting…',
    'status.ready': 'Ready',
    'status.exported': 'Exported versioned campaign JSON.',
    'status.imported': 'Campaign imported after simulation validation.',
    'status.importPrompt': 'Paste campaign JSON before importing.',
    'status.importFailed': 'Campaign import failed.',
    'status.reset': 'Campaign reset to the Phase 1 demo state.'
  }),
  tr: Object.freeze({
    'skip.content': 'İçeriğe geç',
    'shell.menu': 'Menü',
    'shell.language': 'Dil',
    'shell.phase': 'Aşama 2',
    'shell.title': 'Tohumlu Kontroller ve RNG Sözleşmesi',
    'nav.campaign': 'Kampanya',
    'nav.save': 'Kayıt',
    'core.eyebrow': 'Temel kural',
    'core.title': 'Tavsiye ver. Kararı karakter verir.',
    'core.rule': 'Oyuncu tavsiye verir → Yapay zekâ karakter karar verir → Simülasyon doğrular → Dünya tepki verir.',
    'campaign.eyebrow': 'Yetkili simülasyon durumu',
    'campaign.title': 'Mevcut kampanya',
    'campaign.help': 'Aşağıdaki görünür durum yalnızca deterministik simülasyon doğrulamasından sonra yetkilidir.',
    'campaign.id': 'Kampanya',
    'campaign.seed': 'Tohum',
    'campaign.turn': 'Tur',
    'campaign.character': 'Karakter',
    'campaign.rank': 'Rütbe',
    'campaign.gold': 'Altın',
    'save.eyebrow': 'Sürümlü JSON',
    'save.title': 'Kaydet, dışa aktar ve içe aktar',
    'save.help': 'Dışa aktarma yalnızca desteklenen kampanya şemasını üretir. İçe aktarma, durum değiştirilmeden önce ayrıştırılır ve doğrulanır.',
    'save.label': 'Kampanya JSON',
    'save.fieldHelp': 'Dışa aktarma bu alanı doldurur. İçe aktarmadan önce uyumlu kampanya JSON verisini buraya da yapıştırabilirsiniz.',
    'save.export': 'JSON dışa aktar',
    'save.import': 'JSON içe aktar',
    'save.reset': 'Demo durumunu sıfırla',
    'footer.note': 'Erken geliştirme sürümü · Statik istemci · Zorunlu arka uç veya harici yapay zekâ sağlayıcısı yok',
    'status.starting': 'Başlatılıyor…',
    'status.ready': 'Hazır',
    'status.exported': 'Sürümlü kampanya JSON verisi dışa aktarıldı.',
    'status.imported': 'Kampanya simülasyon doğrulamasından sonra içe aktarıldı.',
    'status.importPrompt': 'İçe aktarmadan önce kampanya JSON verisini yapıştırın.',
    'status.importFailed': 'Kampanya içe aktarılamadı.',
    'status.reset': 'Kampanya Aşama 1 demo durumuna sıfırlandı.'
  })
});

export function normalizeLocale(locale) {
  const candidate = String(locale ?? 'en').toLowerCase().split('-')[0];
  return SUPPORTED_LOCALES.includes(candidate) ? candidate : 'en';
}

export function translate(locale, key) {
  const normalized = normalizeLocale(locale);
  return MESSAGES[normalized][key] ?? MESSAGES.en[key] ?? key;
}

export function applyTranslations(documentRef, locale) {
  const normalized = normalizeLocale(locale);
  if (!documentRef) return normalized;

  if (documentRef.documentElement) documentRef.documentElement.lang = normalized;
  if (typeof documentRef.querySelectorAll === 'function') {
    for (const element of documentRef.querySelectorAll('[data-i18n]')) {
      element.textContent = translate(normalized, element.dataset.i18n);
    }
    for (const element of documentRef.querySelectorAll('[data-i18n-status]')) {
      element.textContent = translate(normalized, element.dataset.i18nStatus);
    }
  }

  const selector = documentRef.getElementById?.('language-select');
  if (selector) selector.value = normalized;
  return normalized;
}

export function bindLocalization(documentRef, initialLocale = 'en') {
  let locale = applyTranslations(documentRef, initialLocale);
  const selector = documentRef?.getElementById?.('language-select');

  const setLocale = (nextLocale) => {
    locale = applyTranslations(documentRef, nextLocale);
    return locale;
  };

  selector?.addEventListener?.('change', (event) => setLocale(event?.target?.value));

  return {
    getLocale: () => locale,
    setLocale,
    t: (key) => translate(locale, key)
  };
}
