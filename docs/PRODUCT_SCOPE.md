# Ürün kapsamı ve veri kaynakları

Kullanıcı yönlendirmesi: 2026-10-24.

## Ürün

OctopIQ, farklı A/B adaylarını hedef kitle senaryolarına göre değerlendiren bir hackathon MVP'sidir. Story ve reklam başlığı örnek kullanım senaryolarıdır. Kapsam; web sayfası, mobil uygulama ekranı, kayıt/ödeme akışı, HTML, görsel, teklif ve metin gibi karşılaştırılabilir deneyimleri içerir.

Temel test girdileri: kullanıcının yapmak istediği görev, değerlendirme hedefi, kitle bağlamı, A materyali, B materyali ve değişen öğeler. Birden fazla öğe değişirse sonuç bütün konseptin tercihini anlatır; tek öğenin etkisini izole ettiği iddia edilmez.

Öncelikli MVP akışı kullanıcının A ve B'yi sağlamasıdır. Alternatif üretme ayrı ve isteğe bağlı bir yardımcı yetenektir. Mevcut `A'dan B türet` uygulaması metin üretir; görsel düzenleme veya genel web/mobil arayüz üretimi yaptığı söylenmemelidir.

Gerçek ekran görüntüsü aktarımı henüz Luna değerlendirme yoluna bağlı değildir. HTML kodu metin olarak iletilebilir; render edilmiş görünümün değerlendirilmesi ayrı ekran görüntüsü girdisi gerektirir. Mevcut reklam rubriğinin görev ve materyale göre uyarlanması da planlanan iştir.

## Facebook / Meta kod incelemesi

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

[Grok promptu](GROK_AUDIENCE_PROMPT_TR.md) kullanıcıya verilebilecek somut bir başlangıçtır. Bu turda otomatik Grok rapor içe aktarıcısı, yeni Instagram bağlantısı veya görsel aktarım özelliği uygulanmadı.
