# UI ajanı için backend sözleşmesi

24 Ekim 2026. Mevcut kartlar, XGBoost modeli ve skor alanları korunur. UI ayrı ajan tarafından geliştirilir. Bu sözleşmedeki yeni alanlar mevcut yanıtlara eklenmiştir; eski alanlar kullanılmaya devam edilebilir.

## Son eklenen sentetik veri butonlarının backend'i

Bu butonların UI'ı diğer ajanda. Hepsi hazır API'lere bağlanabilir; hiçbiri Luna çağırmaz.

| Buton / seçim | İstek |
| --- | --- |
| Senaryo ve boyut seçenekleri | `GET /api/demo/catalog` |
| Kitle JSON örneği yükle | `POST /api/audience/synthetic/load` |
| Tüm kaynaklarla demo yükle | `POST /api/demo/load` |
| JSON olarak indir | `GET /api/demo/export?scenarioId=coffee-routine&seed=42&size=large` |
| Facebook / Instagram örneği | `POST /api/social/synthetic/load`, `platform: facebook/instagram` |
| Grok araştırma örneği ekle | `POST /api/grok/synthetic/load` |
| Pixel örneği topla | `POST /api/pixel/synthetic/load` |

İlk üç yükleme rotasının ortak gövdesi:

```json
{ "scenarioId": "coffee-routine", "size": "medium", "seed": "42", "mode": "replace" }
```

12 senaryo yazılım, kahve, mobilya ve içerik kitlesinde farklı ihtiyaçları ele alır. `seed` verilmezse her tıklamada yeni örnek oluşturulur; sabit seed tekrar üretim içindir. Boyutlar: small = kaynak başına 12 gönderi / 60 pixel olayı / 3 araştırma; medium = 36 / 300 / 9; large = 90 / 1200 / 18. Karışık JSON paketinde iki sosyal kaynak olduğu için gönderi sayısı iki katıdır.

Yanıt: `{ dataset, summary, panel, demo, reportText, sampleExperiment, datasetHash }`. `sampleExperiment` ürünle uyumlu örnek A/B ve bağlam içerir. Gerçek analizi çalıştırmak ayrı kullanıcı eylemidir; veri yüklerken otomatik inference başlatma.

Grok örneğini mevcut kitleye eklemek için `dataset: activeDataset` gönder; ürün, gerçekleri ve brief korunur. `mode: replace` veya dataset olmaması yeni paket oluşturur. Grok örneğindeki `reportText` metin alanına önizleme olarak konabilir; yükleme endpoint'i zaten eklediği için tekrar import çağrısı yapma. Gerçek rapor için mevcut `/api/grok/import` artık `{ reportText, dataset: activeDataset }` kabul eder ve ürün bilgisini korur.

Pixel isteği: `{ "count": 500, "scenario": "high-intent", "seed": "42", "dataset": activeDataset }`. `scenario`: `explore`, `compare`, `high-intent`; count 1–1000. Dataset olmasa da geçerli paket ve panel döner. Yanıt buffer sayıları ile eklenen paketi ayırır: `addedCount`, `totalEvents`, `dataset`, `summary`, `panel`. Buffer'daki örnekleri birleşik kitleye katmak için `/api/social/multi-fetch` artık yalnız `{ includePixel: true }` ile de çalışır; sosyal bağlantı gerekmez.

**Sabit demografi metinlerini kaldıracak UI bağlantısı:** Sayıları sadece `summary.totalAudience`, `summary.demographics`, `summary.metrics` içinden oku. Backend sabit 18.400 / 60–40 / İstanbul 44 değerlerini kaynak özeti olarak döndürmez. Gerçek veri eksikse null; sentetik örnekte seed'e göre değişen sayılar döner. İçerik/olay/araştırma sayıları için `summary.metrics.contentCount`, `eventCount`, `researchCount` kullan. `demo.counts` yalnız yeni üretilen parçayı, `summary.metrics` birleşmiş paketi anlatır.

## Instagram ve Facebook bağlantıları

- Facebook düğmesi: `GET /api/auth/meta/config` → Facebook OAuth.
- Instagram düğmesi: `GET /api/auth/instagram/config` → **Instagram OAuth**. Eski `?platform=instagram` da bu yolu seçer; Facebook'a düşmez.
- Hesap türü ve sayfa adı alanları bu yollar için zorunlu değildir. Instagram hesabı token'dan `graph.instagram.com/me` ile bulunur. Facebook'ta birden fazla yetkili sayfa dönerse eski hesap seçimi hatası korunur; Instagram sayfa adı istemez.
- Instagram callback: `/api/auth/instagram/callback`. App ayarları: `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, isteğe bağlı `INSTAGRAM_OAUTH_REDIRECT_URI`, `INSTAGRAM_OAUTH_SCOPES`. Bunlar Instagram API with Instagram Login uygulama ayarlarıdır; Facebook uygulama kimliği otomatik yerine geçirilmez.
- Ayarlar eksikse `configured:false, oauthUrl:null` döner. UI popup açmak yerine `note` gösterir. Canlı hesap bağlantısı bu çalışmada denenmedi; yetkilendirme, token exchange ve Graph ayrımı taklit sağlayıcılarla test edildi.
- Mevcut callback başarı olayı `META_AUTH_SUCCESS` korunur. Test token için ayrı `/api/auth/instagram/connect-test` ve `INSTAGRAM_TEST_ACCESS_TOKEN` vardır.

Meta'nın iki API yolu ayrımı için [resmî Instagram koleksiyonu](https://www.postman.com/meta/instagram/folder/6raa77c/instagram-api-with-instagram-login).

## Kitle analizi ve kartlar

`POST /api/compile-panel` veya `POST /api/audience-analysis`

```json
{ "dataset": "AudienceDatasetV1 nesnesi", "engine": "local", "includeMl": true }
```

`dataset` gerçek JSON nesnesidir. `engine` panel derlemede inference başlatmaz. `includeMl` isteğe bağlıdır; varsayılan false. True olduğunda mevcut yerel XGBoost çağrılır, Luna çağrılmaz.

Yanıtın mevcut `personasCount`, `identitiesCount`, `personas` alanları korunur. Ek alanlar:

- `datasetHash`: girdinin sabit özeti.
- `analysis.headline`: sunuma hazır kısa açıklama.
- `analysis.cards[]`: `personaId`, `title`, `need`, `objections`, `scenarioWeightPercent`, `evidenceProfile`, `audienceRecordCount`, `support`, `evidence[]`, `testQuestion`.
- `analysis.sources[]`: kaynak başına içerik, olay türleri, kaynak içi profil ve observation sayıları. Farklı kaynakların kişi sayılarını toplayıp tekil kişi sayısı diye gösterme.
- `analysis.coverage`: veri paketi kapsamı.
- `ml.status`: istenmişse `ready` veya `unavailable`. ML hatası kartları kaybettirmez; `unavailable` yanında hata `code` alanı bulunur.
- `ml.prediction`: hazırsa aşağıdaki mevcut ML yanıtı.

Kart ile analiz verisini liste sırasına göre değil `personaId` ile eşleştir. Pasta grafik için `scenarioWeightPercent` senaryo ağırlığıdır.

## XGBoost

Mevcut rotalar korunur:

- `GET /api/ml/status`: model makbuzu ve dosya bütünlüğü.
- `POST /api/ml/predict`: `{ "dataset": { ... } }` veya `{ "features": [16 sayı] }`. İsimli özellik nesnesi de tam 16 alan içermelidir.
- `POST /api/ml/train`: `{ "numSamples": 3500 }`; 500–20000 tam sayı. Eğitim otomatik başlatılmaz.

Eski `dominantPersona`, `dominantIndex`, `personaScores`, `featuresUsed`, `probability`, `recommendedWeight` alanları korunur. Ek alanlar:

- `model`: `artifactHash`, `engine`, `latencyMs`.
- `featureReport`: dataset gönderilmişse özelliklerin `computed/observed/assumed` dayanakları ve kaynak referansları. Demo varsayılanları korunmuştur.
- `scenarioWeights[]`: `index`, `label`, `weight`; toplamı 1 olan, grafik için normalize edilmiş senaryo önerileri. Eski `recommendedWeight` alanındaki alt sınır toplamı 1'i aşabilir; pasta grafiğinde yeni alanı kullan.
- `diagnostics`: `entropy` (0–1), `topTwoMargin` (0–1), `separation` (`close/clear`), `inputBasis`.
- `provenance`: sentetik eğitim bilgisi. Bu model Luna'nın A/B kararını veya eşit panel ağırlıklarını değiştirmez.

Hatalar `{ error, code }`: girdi 400, devam eden eğitim 409, eksik runtime/model 503, timeout 504. Süre aşımında Python işlemi durdurulur. Mevcut model bu çalışmada yeniden eğitilmedi veya kaldırılmadı.

## A/B girdileri

`POST /api/run-experiment`:

```json
{
  "dataset": {},
  "engine": "local",
  "panelMode": "demo",
  "repeats": 2,
  "concurrency": 2,
  "context": {
    "objective": "task-completion",
    "surface": "web",
    "task": "İhtiyaca uygun planı seçmek",
    "changedElement": "Plan kartındaki ana eylem"
  },
  "variantA": { "id": "a", "format": "text", "headline": "A", "body": "...", "callToAction": "İncele" },
  "variantB": { "id": "b", "format": "text", "headline": "B", "body": "...", "callToAction": "Planı seç" }
}
```

Örnekteki `dataset` yerine geçerli veri paketi gönderilir. Ürün kimliği verilmezse ilk ürün kullanılır. Amaçlar: `attention`, `consideration`, `click-intent`, `task-completion`, `clarity`, `trust`. Yüzeyler: `web`, `mobile`, `content`, `other`.

Formatlar: `text`, `screen`, `flow`, `html`, `web-page` ve mevcut `text-ad`, `story`, `image-ad`. `html` kaynak kodudur. `images[]` gerçek ekran görüntülerini taşır: `{ name, mimeType, data }`; `data` base64 içerik, data URL öneki içermez. PNG/JPEG/WebP, varyant başına en fazla 3 resim, her biri en fazla 2 MB. `referenceUrl` otomatik açılmaz. Yerel kurallar resim okumaz; gerçek görsel değerlendirmesi için kullanıcının açıkça seçtiği `engine: "codex"` gerekir.

Demo en fazla 6 normal dikkat kimliği seçer; 2 tekrar × 3 değerlendirmede en fazla 36 çağrı. `repeats: 1` desteklenir, fakat sıra tutarlılığı kanıtlanamadığı için kesin A/B kararı beklenmemelidir. Full ayarı 18 kimlik × 2 × 3 = 108 değerlendirmeyi korur.

## A/B sonucu: sunuma hazır analiz

Eski `summary`, `aggregate`, `criterionComparison`, `segmentBreakdown`, `timing`, `creativeIssues` alanları korunur. `analysis` yeni sunum katmanıdır; **ek inference çağrısı yapmaz**.

| Alan | UI kullanımı |
| --- | --- |
| `analysis.headline` | Ana sonuç başlığı |
| `analysis.decision`, `recommendedVariantId` | Orijinal aggregate kararı; sonuçsuz kararları A/B'ye dönüştürme |
| `analysis.preferenceGapPoints` | B eksi A tercih puanı; dönüşüm artışı değildir |
| `analysis.criteria[]` | Altı eksenli radar/bar: `criterion`, `label`, `a`, `b` 0–4, `delta` B eksi A |
| `analysis.drivers[]` | En belirgin kriter farkları; `advantage: a/b/tie` |
| `analysis.segments[]` | Müşteri kartı altında ihtiyaç, skor, oy dağılımı, gerekçe ve çelişkiler |
| `analysis.unansweredQuestions[]` | Tekilleştirilmiş sorular; tekrar sayısı ve etkilenen persona referansları |
| `analysis.nextEdits[]` | Öncelikli düzenlemeler: `title`, `instruction`, `reason`, `variantId`, `evidenceIds` |
| `analysis.design` | Gerçekte değişen alanlar, görsel sayıları ve karşılaştırma kapsamı |
| `analysis.diagnostics` | Eksik panel, sıra tutarlılığı, ayrışan segmentler |
| `evaluations[]` | Doğrulanmış ham tekil ve eşli değerlendirmeler; detay çekmecesi için |

Kriter kıyasları yalnız her iki tarafın da kullanılabilir olduğu aynı kimlik/tekrar üzerinden hesaplanır. `null` puanı sıfır yapma. `delta` kriterlerde B eksi A'dır; eski `aggregate.scores.delta` A eksi B olarak korunur.

Segmentlerde `consensus`: `unanimous`, `majority`, `divided`, `missing`. `representativeReason` çoğunluk tercihiyle eşleşir. Eşit ayrışmada null olur; `counterExamples` karşı gerekçeleri korur. `agreementRatio` tekrar uyumudur. `criteria[].evidenceA/evidenceB` içindeki alıntı, açıklama, claim ve kaynak referansları detay görünümüne hazırdır.

`aggregate.decision` değerleri: `A`, `B`, `mixed`, `tie`, `neither`, `insufficient-data`, `invalid-creative`. Oy paydasına eksik panel de dahildir; pasta/bar toplamını yalnız A/B'ye normalize etme.

## Doğrulama sınırı

Son backend değişiklikleri yerel kurallar, taklit sağlayıcılar, gerçek HTTP testleri ve mevcut yerel XGBoost ile doğrulanır. Bu çalışmada gerçek Luna çağrısı yapılmaz. Önceki canlı bağlantı kaydı `LUNA_VALIDATION.md` içindedir; yeni görsel/HTML akışının canlı testi olarak gösterilmez.
