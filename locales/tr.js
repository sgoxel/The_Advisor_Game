/* ROAD_PATCH_V2: diagonal connectivity + color fix */
window.Game = window.Game || {};
window.Game.Locales = window.Game.Locales || {};
window.Game.Locales.tr = {
  "common": {
    "apply": "Uygula",
    "cancel": "İptal",
    "yes": "Var",
    "no": "Yok",
    "none": "Yok",
    "unknown": "Bilinmiyor",
    "error": "Hata",
    "info": "Bilgi",
    "promiseError": "Promise Hatası"
  },
  "header": {
    "mainMenu": "Ana Menü",
    "settings": "Ayarlar",
    "log": "Log",
    "language": "Dil"
  },
  "menu": {
    "githubPage": "Github Sayfası",
    "save": "Harita JS Dışa Aktar",
    "load": "Haritayı Yükle",
    "exportMapData": "Harita Verisini Dışa Aktar",
    "exportMasks": "Döşeme Maskelerini Dışa Aktar"
  },
  "stats": {
    "gold": "Altın",
    "health": "Sağlık",
    "stamina": "Stamina",
    "mana": "Mana"
  },
  "overlay": {
    "instructionsHtml": "Sol tık: tile seç<br />Sürükle: kamera gezintisi<br />Ok tuşları / WASD: haritada hareket"
  },
  "character": {
    "title": "Karakter",
    "name": "Arin Valen",
    "metaHtml": "Seviye 7 Korucu<br />Bölge: Sisli Vadi<br />Durum: Göreve hazır"
  },
  "dialog": {
    "title": "Diyalog",
    "defaultText": "SEED tabanlı dünya üretimi aktif. Ayarlar menüsünden üretilen topoloji ve altyapı parametrelerini inceleyebilirsin.",
    "choices": {
      "north": "Kuzeye ilerle.",
      "east": "Doğu bölgesine git.",
      "south": "Güney hattını incele.",
      "wait": "Bekle ve gözlem yap."
    },
    "choiceResults": {
      "north": "Kuzeye ilerlemeyi seçtin. Tepe yapısı ve geçiş koridorları gözlemleniyor.",
      "east": "Doğu bölgesine yöneldin. Yol ve açık arazi yapısı daha belirgin görünüyor.",
      "south": "Güney hattını inceledin. Su yapıları ve çevresel geçişler burada yoğunlaşmış olabilir.",
      "wait": "Bulunduğun yerde kalıp topoloji parametrelerini değerlendirmeye devam ediyorsun."
    },
    "worldSummary": "Yeni dünya üretildi. SEED: {{seed}} | Boyut: {{cols}} x {{rows}} | Tepe: {{hills}} | Dere: {{streams}} | Yol: {{roads}}"
  },
  "minimap": {
    "title": "Mini Harita"
  },
  "settings": {
    "title": "Ayarlar ve SEED Parametreleri",
    "seedCode": "SEED Kodu",
    "mapWidth": "Harita Genişliği",
    "mapHeight": "Harita Yüksekliği",
    "cameraPitch": "Kamera Eğim Açısı",
    "depthStrength": "Derinlik Etkisi",
    "streamCount": "Dere Sayısı",
    "lake": "Göl",
    "hillCount": "Tepe Sayısı",
    "hillArea": "Tepelik Alan Oranı",
    "roadCount": "Yol Sayısı",
    "forest": "Orman",
    "forestArea": "Orman Alan Oranı",
    "settlement": "Yerleşim Alanı",
    "grassArea": "Çim Alan Oranı",
    "dirtArea": "Toprak Alan Oranı",
    "waterArea": "Su Alan Oranı",
    "stoneArea": "Taşlık Alan Oranı",
    "reliefEnabled": "Kabartı Gölgelendirmesini Etkinleştir",
    "sunAzimuth": "Güneş Yönü (Azimut)",
    "sunElevation": "Güneş Yüksekliği",
    "shadowStrength": "Gölge Şiddeti",
    "highlightStrength": "Aydınlık Kenar Şiddeti",
    "shadowLength": "Gölge Uzunluğu",
    "note": "Bu alanlar yalnızca SEED ve harita boyutundan türetilir. Manuel düzenleme kapalıdır. Aynı SEED ve aynı boyutlar girildiğinde uygulama aynı topoloji ve arazi dağılımını tekrar üretir.",
    "groups": {
      "topology": "Topoloji",
      "infrastructure": "Altyapı ve Arazi Kullanımı",
      "distribution": "Arazi Dağılımı"
    }
  },
  "logs": {
    "title": "Uygulama Logları",
    "closeAria": "Log penceresini kapat",
    "settingsOpened": "Ayarlar penceresi açıldı.",
    "settingsClosed": "Ayarlar penceresi kapatıldı.",
    "logOpened": "Log penceresi açıldı.",
    "logClosed": "Log penceresi kapatıldı.",
    "dialogChoice": "Diyalog seçimi yapıldı: {{choice}}",
    "worldRebuilt": "Dünya yeniden oluşturuldu. SEED={{seed}}, boyut={{cols}}x{{rows}}",
    "settingsApplied": "Ayarlar uygulandı. Yeni SEED={{seed}}, yeni boyut={{cols}}x{{rows}}",
    "fileModeWarning": "BİLGİ: Uygulama file:// üzerinden açıldı. JS harita paketleri görseli veri olarak içerdiği için file-origin doku yükleme sorunlarını azaltır.",
    "appStarted": "Uygulama başlatıldı.",
    "windowResized": "Pencere yeniden boyutlandırıldı.",
    "runtimeError": "HATA: Çalışma zamanı hatası yakalandı.",
    "globalError": "HATA: Global error event yakalandı.",
    "staticResourceFailed": "HATA: Statik kaynak yüklenemedi.",
    "promiseRejection": "PROMISE HATASI: Yakalanmamış promise rejection.",
    "message": "Mesaj",
    "file": "Dosya",
    "line": "Satır",
    "column": "Sütun",
    "extraInfo": "Ek Bilgi",
    "errorType": "Hata Tipi",
    "stack": "Stack",
    "unknownSource": "(kaynak bilgisi yok)",
    "unknown": "Bilinmeyen hata",
    "noStack": "Stack bilgisi yok.",
    "resourceLoadError": "Kaynak yükleme hatası",
    "exportCompleted": "Dışa aktarma tamamlandı. Dosya indirildi: {{filename}}",
    "exportFailed": "Dışa aktarma başarısız oldu. Dosya oluşturulamadı.",
    "tag": "Etiket"
  },
  "paramValues": {
    "exists": "Var",
    "notExists": "Yok",
    "percent": "%{{value}}"
  },
  "webgl": {
    "notSupported": "WebGL başlatılamadı. Tarayıcı veya GPU bu özelliği desteklemiyor olabilir."
  }
};
