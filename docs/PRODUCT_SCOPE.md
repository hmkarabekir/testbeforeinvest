# Ürün kapsamı ve veri kaynakları

Kullanıcı yönlendirmesi: 2026-10-24.

Güncel backend bağlantısı: [UI API sözleşmesi](UI_API_CONTRACT.md). UI ayrı ajan tarafından geliştirilir; mevcut XGBoost modeli, kartlar ve skorlar korunur.

## Ürün

OctopIQ, farklı A/B adaylarını hedef kitle senaryolarına göre değerlendiren bir hackathon MVP'sidir. Story ve reklam başlığı örnek kullanım senaryolarıdır. Kapsam; web sayfası, mobil uygulama ekranı, kayıt/ödeme akışı, HTML, görsel, teklif ve metin gibi karşılaştırılabilir deneyimleri içerir.

Temel test girdileri: kullanıcının yapmak istediği görev, değerlendirme hedefi, kitle bağlamı, A materyali, B materyali ve değişen öğeler. Birden fazla öğe değişirse sonuç bütün konseptin tercihini anlatır; tek öğenin etkisini izole ettiği iddia edilmez.

Öncelikli MVP akışı kullanıcının A ve B'yi sağlamasıdır. Alternatif üretme ayrı ve isteğe bağlı bir yardımcı yetenektir. Mevcut `A'dan B türet` uygulaması metin ve düzenlenebilir HTML alternatifi üretir; görsel düzenleme veya çalışır bir uygulama üretimi yaptığı söylenmemelidir.

PNG/JPEG/WebP ekran görüntüleri Luna CLI yoluna bağlandı; taşıma ve sıra eşleme testleri taklit CLI süreçleriyle geçti. Bu son değişiklikler için canlı Luna çağrısı yapılmadı. HTML kaynak olarak değerlendirilir; render edilmiş görünüm için ekran görüntüsü gerekir. Görev, yüzey, hedef ve değişen öğe altı kriterli değerlendirmeye aktarılır. Analiz; segmentler, kriter farkları, sorular, dayanaklar ve sonraki düzenlemeleri ek model çağrısı olmadan üretir.

## Facebook / Meta ilk inceleme kaydı

Aşağıdaki tablo düzeltmelerden **önceki** uygulamanın tarihsel incelemesidir. Güncel uygulama; eksik demografiyi boş bırakır, OAuth/Graph hatasında sentetik başarıya dönmez, Facebook Page ve bağlı profesyonel Instagram hesabını ayırır. Bu yollar kontrollü HTTP/Graph fixture'larıyla sınandı; canlı Meta hesabı doğrulaması yapılmadı. XGBoost'un mevcut demo varsayılanları ise kullanıcı isteğiyle korunur ve `featureReport` içinde işaretlenir; bunlar sosyal kaynak özeti değildir.

İncelenen yol: `src/core/social-ingestion.ts` içindeki `fetchLiveMetaGraph` ve `buildSummary`. Bu inceleme canlı hesaptan alınan bir Meta yanıtını doğrulamaz.

| Gösterilen bilgi | İncelenen uygulamadaki kaynak |
| --- | --- |
| Toplam kitle: 18.400 | Sabit sayı. API'den okunmuyor. |
| Şehir dağılımı: İstanbul %44, Ankara %19, İzmir %12, diğer %25 | Sabit liste. |
| Baskın yaş grubu: 25-34 | Sabit değer. |
| Yaş/cinsiyet yüzdeleri | Observation varsa ondan okunuyor; yoksa sabit varsayılanlar kullanılıyor. Meta yolunda observations boş bırakıldığı için varsayılanlar gösteriliyor. |
| Yakın gönderiler ve etkileşim sayıları | Başarılı API yanıtındaki gönderilerden gelebiliyor. |
| Insights demografi yanıtı | İstenip okunuyor; observations içine aktarılmıyor. |

Yerel kontrollü kanıt: `fetch` yalnız deneme alt sürecinde taklit edildi; gerçek token veya ağ çağrısı kullanılmadı. API fixture'ında farklı demografi verilmesine rağmen özet %60 erkek / %40 kadın, 18.400 toplam kitle ve sabit şehirleri döndürdü. HTTP 400 OAuth hata fixture'ı da `synthetic:false` ve boş observations ile sonuçlandı. Dolayısıyla bu bayrak tek başına canlı veri kanıtı değildir. Tokensız yol ise açıkça sentetik paket üretir.

OAuth akışındaki v25 ile veri çekme yolundaki v19 farklıdır. Facebook Page verisi aynı fonksiyonda Instagram olarak etiketlenmektedir. Mevcut bağlantı, bağımsız olarak doğrulanmış Instagram Insights entegrasyonu sayılmaz.

## Kaynak kararları

- **Meta/Facebook:** OAuth bağlantısı ile gerçekten alınan alanlar ayrı doğrulanmalı. Eksik alanlar `bilinmiyor` kalmalı; demo sayıları canlı demografi diye doldurulmamalı.
- **Instagram:** Kullanıcının yetkili profesyonel hesabı için ayrı Insights yolu eklenebilir. Güncel izinler, hesap seçimi ve dönen metrikler entegrasyon sırasında doğrulanmalı. Kullanıcı adı girilmesinden demografi üretmek bu entegrasyonun karşılığı değildir.
- **X:** Doğrudan API bağlantısını yeniden eklemek yerine kopyalanabilir Grok araştırma promptu ve kullanıcının geri getirdiği rapor planlanır. Kaynaklı açık içerik gözlemleri, kitle hipotezleri ve bilinmeyen demografi ayrı tutulur.
- **Pixel:** Mekanizma kalabilir. Hackathon demosunda sentetik davranış olayları kullanılabilir ve demo olarak etiketlenir. Bu olaylar gerçek kullanıcı davranışı veya tahmin başarısı kanıtı sayılmaz.

[Grok promptu](GROK_AUDIENCE_PROMPT_TR.md) ve rapor içe aktarıcısı mevcuttur. Güncel uygulamanın payload ve çıktı alanları için [UI sözleşmesini](UI_API_CONTRACT.md) kullanın.
