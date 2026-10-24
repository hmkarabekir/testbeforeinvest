import {
  invalidLabInput,
  labText,
  type AudienceDatasetV1,
  type PersonaClaim,
  type SimulationPersonaV1,
  type AgentIdentityV1,
} from './dataset-contract.js';
import { normalizeAudienceDataset, hashCanonical } from './dataset-normalizer.js';
import { compileAgentIdentities } from './agent-identity.js';

export const PERSONA_COMPILER_VERSION = 'audience-lab-persona-2';
type Theme = {
  key: string;
  title: string;
  terms: string[];
  need: string;
  objection: string;
};
const THEMES: Record<AudienceDatasetV1['brand']['category'], Theme[]> = {
  furniture: [
    {
      key: 'dimensions',
      title: 'Küçük Alan Mimarı',
      terms: ['ölçü', 'sığ', 'küçük alan', 'boyut', 'dimensions'],
      need: 'Ürünün kullanım alanına uygun ölçülerini açıkça görmek',
      objection: 'Ölçüler ve yerleşim açıklanmadan uygunluğuna karar veremem.',
    },
    {
      key: 'material',
      title: 'Masif Ahşap Tutkunu',
      terms: ['malzeme', 'ahşap', 'kumaş', 'dayan', 'material'],
      need: 'Malzeme ve bakım bilgisini somut ürün özellikleriyle karşılaştırmak',
      objection: 'Genel kalite sözü yerine malzeme ve bakım ayrıntısı isterim.',
    },
    {
      key: 'delivery',
      title: 'Hızlı Teslimatçı',
      terms: ['teslim', 'kurulum', 'kargo', 'delivery'],
      need: 'Teslimat ve kurulum koşullarının açıklığını değerlendirmek',
      objection: 'Teslimat koşulu belirsizse önce soru sorarım.',
    },
    {
      key: 'design',
      title: 'Tasarım Tutkunu',
      terms: ['tasarım', 'renk', 'uyum', 'dekor', 'design'],
      need: 'Ürünün mekânda ve diğer eşyalarla nasıl kullanılacağını görmek',
      objection: 'Güzel görünmesi kullanım alanıma uyduğunu göstermiyor.',
    },
    {
      key: 'value',
      title: 'Maliyet Odaklı',
      terms: ['fiyat', 'bedel', 'maliyet', 'ödeme', 'value'],
      need: 'Ürün ve sunulan hizmetin bedelini açıkça karşılaştırmak',
      objection: 'Ek kalemleri bilmeden ucuz veya avantajlı diyemem.',
    },
    {
      key: 'care',
      title: 'Pratik Kullanıcı',
      terms: ['bakım', 'temiz', 'sil', 'care'],
      need: 'Gündelik kullanım ve bakım gereksinimini anlamak',
      objection: 'Bakım yöntemi açıklanmadan kolay kullanım vaadine güvenmem.',
    },
    {
      key: 'modular',
      title: 'Modüler Yaşam Mimarı',
      terms: ['modüler', 'katlan', 'esnek', 'modular'],
      need: 'Yerleşim ve kullanım seçeneklerini görmek',
      objection:
        'Farklı kullanım biçimleri somut gösterilmediyse esneklik iddiası yetmez.',
    },
    {
      key: 'business',
      title: 'Ofis Tasarımcısı',
      terms: ['ofis', 'iş yeri', 'proje', 'business'],
      need: 'Birden çok kullanım ve proje koşullarına uygun bilgi görmek',
      objection:
        'Bireysel kullanım örneği iş yerindeki gereksinimi tek başına açıklamıyor.',
    },
  ],
  coffee: [
    {
      key: 'grind',
      title: 'Demleme Meraklısı',
      terms: ['öğüt', 'ekipman', 'filtre', 'grind'],
      need: 'Kullanılan hazırlama yöntemine uygun öğütümü seçmek',
      objection: 'Hangi ekipmana uygun olduğu açıklanmadan seçemem.',
    },
    {
      key: 'taste',
      title: 'Tat Kaşifi',
      terms: ['tat', 'aroma', 'nota', 'çikolata', 'taste'],
      need: 'Tat profilini anlaşılır bir kullanım örneğiyle görmek',
      objection:
        'Sadece premium denmesi nasıl bir tat bekleyeceğimi anlatmıyor.',
    },
    {
      key: 'origin',
      title: 'Gurme Kahveci',
      terms: ['köken', 'bölge', 'çekirdek', 'çiftlik', 'origin'],
      need: 'Çekirdek kökeni ve ürünün somut hikâyesini anlamak',
      objection: 'Kaynağı belli olmayan özel üretim iddiasını kontrol ederim.',
    },
    {
      key: 'brewing',
      title: 'Pratik Kahveci',
      terms: ['hazırla', 'demle', 'tarif', 'pratik', 'brewing'],
      need: 'Hazırlama adımlarını ve gereken ekipmanı açıkça görmek',
      objection: 'Kolay deniyor ama nasıl hazırlanacağı açıklanmıyor.',
    },
    {
      key: 'freshness',
      title: 'Tazelik Takipçisi',
      terms: ['taze', 'kavur', 'sakla', 'freshness'],
      need: 'Kavurma ve saklama bilgilerinin açıklığını değerlendirmek',
      objection: 'Tazelik sözü ölçülebilir ürün bilgisi olmadan yeterli değil.',
    },
    {
      key: 'subscription',
      title: 'Abonelik Alıcısı',
      terms: ['abon', 'düzenli', 'yenile', 'subscription'],
      need: 'Düzenli sipariş koşullarını ve değiştirme seçeneklerini anlamak',
      objection: 'Aboneliğin sıklığı ve koşulları belirsizse önce incelerim.',
    },
    {
      key: 'value',
      title: 'Fiyat Karşılaştıran',
      terms: ['fiyat', 'paket', 'gram', 'bedel', 'value'],
      need: 'Paket içeriğini ve bedelini somut karşılaştırmak',
      objection:
        'Paket miktarı belirtilmeden ekonomik olduğu sonucuna varamam.',
    },
    {
      key: 'gift',
      title: 'Hediye Alıcısı',
      terms: ['hediye', 'seçki', 'kutusu', 'gift'],
      need: 'İçerik ve kullanım uygunluğunu hediye bağlamında görmek',
      objection:
        'Kutu görünümü ürünün karşı tarafa uygunluğunu tek başına açıklamıyor.',
    },
  ],
  software: [
    {
      key: 'integration',
      title: 'Kıdemli Entegratör',
      terms: ['entegrasyon', 'api', 'webhook', 'integration'],
      need: 'Mevcut iş akışına bağlantıyı somut örnekle görmek',
      objection:
        'Desteklenen bağlantılar ve yöntem açıklanmadan uyumlu diyemem.',
    },
    {
      key: 'setup',
      title: 'Hızlı Kurulumcu',
      terms: ['kurulum', 'başlangıç', 'yükle', 'setup'],
      need: 'Kurulumun gerektirdiği adımları ve sorumlulukları anlamak',
      objection: 'Anında hazır vaadi yerine açık kurulum adımları isterim.',
    },
    {
      key: 'team',
      title: 'Ekip Yöneticisi',
      terms: ['ekip', 'rol', 'yetki', 'team'],
      need: 'Ekip üyeleri ve erişim rollerinin nasıl çalıştığını görmek',
      objection:
        'Birlikte kullanım anlatılıyor ama rol ve sınırlar açıklanmıyor.',
    },
    {
      key: 'pricing',
      title: 'Plan ve Fiyat Alıcısı',
      terms: ['fiyat', 'plan', 'kota', 'ücret', 'pricing'],
      need: 'Planın bedeli ve kapsam sınırlarını karşılaştırmak',
      objection: 'Hangi özelliğin plana dahil olduğu belirsizse karar veremem.',
    },
    {
      key: 'workflow',
      title: 'Verimlilik Lideri',
      terms: ['iş akış', 'otomasyon', 'zaman', 'workflow'],
      need: 'Ürünün somut bir iş adımını nasıl değiştirdiğini anlamak',
      objection: 'Ölçüm olmadan kesin zaman veya verim artışı kabul etmem.',
    },
    {
      key: 'trial',
      title: 'Titiz Alıcı',
      terms: ['deneme', 'demo', 'sandbox', 'trial'],
      need: 'Denemede hangi işlevleri inceleyebileceğini görmek',
      objection: 'Deneme kapsamı belirtilmeden kaydolmak istemem.',
    },
    {
      key: 'security',
      title: 'Güvenlik Uzmanı',
      terms: ['veri', 'güven', 'erişim', 'security'],
      need: 'Veriye erişim ve kullanım sınırlarını anlamak',
      objection:
        'Güvenli sözü erişim sınırlarının açıklamasının yerine geçmez.',
    },
    {
      key: 'support',
      title: 'Operasyon Lideri',
      terms: ['destek', 'rehber', 'doküman', 'support'],
      need: 'Sorun olduğunda başvurulacak kaynakları görmek',
      objection: 'Destek kapsamı ve iletişim yolu belirsizse önce sorarım.',
    },
  ],
  other: [
    {
      key: 'features',
      title: 'Ürün Kaşifi',
      terms: ['özellik', 'ürün', 'feature'],
      need: 'Ürünün somut özelliklerini anlamak',
      objection: 'Somut özellik olmadan genel övgü yeterli değil.',
    },
    {
      key: 'usage',
      title: 'Kullanım Analisti',
      terms: ['kullan', 'uygun', 'usage'],
      need: 'Ürünün hangi kullanım için uygun olduğunu görmek',
      objection: 'Kendi kullanım senaryoma uygunluk açıklanmıyor.',
    },
    {
      key: 'value',
      title: 'Fiyat Analisti',
      terms: ['fiyat', 'bedel', 'plan', 'value'],
      need: 'Bedeli ve dahil olanları açıkça karşılaştırmak',
      objection: 'Kapsam belirsizken avantajlı olduğunu kabul edemem.',
    },
    {
      key: 'support',
      title: 'Hizmet Denetçisi',
      terms: ['destek', 'teslim', 'hizmet', 'support'],
      need: 'Hizmet ve destek koşullarını anlamak',
      objection: 'Koşullar açıklanmadan hizmet vaadini değerlendiremem.',
    },
    {
      key: 'evidence',
      title: 'Kanıt Arayan',
      terms: ['kanıt', 'örnek', 'ayrıntı', 'evidence'],
      need: 'İddiaları somut ürün bilgisiyle kontrol etmek',
      objection: 'Kaynağı olmayan kesin iddiayı sorgularım.',
    },
    {
      key: 'choice',
      title: 'Seçenek Karşılaştırıcı',
      terms: ['seçenek', 'karşılaştır', 'çeşit', 'choice'],
      need: 'Seçenekler arasındaki farkı görmek',
      objection: 'Alternatifler arasındaki fark açıklanmıyor.',
    },
  ],
  'personal-brand': [
    {
      key: 'technical-depth',
      title: 'Teknik Mimar',
      terms: [
        'kod',
        'mimari',
        'api',
        'teknik',
        'benchmark',
        'github',
        'stack',
        'performans',
        'open source',
        'developer',
        'yazılım',
        'model',
      ],
      need: 'Teknik altyapıyı, kodu ve mimari kararları somut örneklerle görmek',
      objection:
        'Pazarlama vaadi yerine somut kod, mimari veya benchmark kanıtı isterim.',
    },
    {
      key: 'builder-journey',
      title: 'Solo Girişimci',
      terms: [
        'hikâye',
        'öğrendim',
        'deneyim',
        'yolculuk',
        'hata',
        'fail',
        'serüven',
        'buildinpublic',
        'kurucu',
        'founder',
        'denedim',
      ],
      need: 'Kurucunun samimi deneyimini ve gerçek öğrenimlerini görmek',
      objection:
        'Steril ve kurumsal pazarlama dili yerine samimi tecrübe paylaşımı ararım.',
    },
    {
      key: 'actionable-framework',
      title: 'Taktik Arayan',
      terms: [
        'şablon',
        'rehber',
        'adım adım',
        'taktik',
        'nasıl yapılır',
        'framework',
        'ipucu',
        'template',
        'prompt',
        'liste',
      ],
      need: 'Hemen bugün uygulanabilecek somut bir çerçeve ve şablon bulmak',
      objection:
        'Çok genel ve soyut anlatılmış, bugün hemen uygulayabileceğim taktik yok.',
    },
    {
      key: 'contrarian-insight',
      title: 'Analitik Eleştirmen',
      terms: [
        'ezber bozan',
        'farklı',
        'karşıt',
        'yanlış bilinen',
        'mit',
        'analiz',
        'veri',
        'neden',
        'gerçekte',
        'kritik',
      ],
      need: 'Sektör klişelerine meydan okuyan özgün ve analitik bir bakış açısı görmek',
      objection:
        'Herkesin söylediği yüzeysel klişeleri tekrarlayan içerikleri elerim.',
    },
    {
      key: 'fast-roi',
      title: 'Hızlı İcraatçı',
      terms: [
        'hızlı',
        'pratik',
        'zaman',
        'otomasyon',
        'kısa yol',
        'verim',
        'kolay',
        'hemen',
        'productivity',
        'tasarruf',
      ],
      need: 'Hızlıca sonuca ulaştıran pratik araç ve otomasyonları keşfetmek',
      objection: 'Öğrenme eğrisi çok yüksek mi, harcadığım zamana değecek mi?',
    },
    {
      key: 'critical-skeptic',
      title: 'Şüpheci Gözlemci',
      terms: [
        'kanıt',
        'abartı',
        'gerçekçi',
        'şüphe',
        'tarafsız',
        'şeffaf',
        'clickbait',
        'hype',
        'iddia',
        'doğruluk',
      ],
      need: 'Abartısız, dürüst sınırları ve gerçekçi sonuçları incelemek',
      objection:
        'Clickbait ve abartılı başarılara şüpheyle yaklaşırım; dürüst trade-off görmek isterim.',
    },
    {
      key: 'community-dialogue',
      title: 'Topluluğa ve tartışmaya katılmak isteyen',
      terms: [
        'tartışma',
        'sizce',
        'yorum',
        'topluluk',
        'fikir',
        'soru',
        'deneyiminiz',
        'community',
        'birlikte',
      ],
      need: 'Fikir alışverişi yapabileceği iki yönlü bir tartışma ortamı bulmak',
      objection: 'Tek taraflı monolog gibi; tartışmaya ve soruya alan açmıyor.',
    },
    {
      key: 'beginner-curiosity',
      title: 'Adım adım öğrenmek isteyen meraklı',
      terms: [
        'başlangıç',
        'temel',
        'öğren',
        'kolay',
        'anlaşılır',
        'sıfırdan',
        'basit',
        'yeni başlayan',
        'rehber',
      ],
      need: 'Karmaşık terimlerden arındırılmış, net ve anlaşılır bir anlatım görmek',
      objection:
        'Aşırı teknik jargon var; ne anlama geldiği ve bana faydası net açıklanmıyor.',
    },
  ],
  creator: [
    {
      key: 'technical-depth',
      title: 'Teknik ve içerik derinliği arayan',
      terms: [
        'kod',
        'araç',
        'teknik',
        'sistem',
        'üretim',
        'yöntem',
        'stack',
        'format',
      ],
      need: 'İçerik ve proje üretiminin arkasındaki somut sistemi anlamak',
      objection:
        'Genel motivasyon sözleri yerine arkadaki çalışma sistemini görmek isterim.',
    },
    {
      key: 'builder-journey',
      title: 'Yaratıcı serüveni takip eden',
      terms: [
        'hikâye',
        'yolculuk',
        'deneyim',
        'şeffaf',
        'süreç',
        'üretici',
        'creator',
      ],
      need: 'Üreticinin gerçek süreç ve aşamalarını görmek',
      objection:
        'Yalnız başarı hikâyesi yerine sürecin zorluklarını da anlatan paylaşımlar isterim.',
    },
    {
      key: 'actionable-framework',
      title: 'Pratik üretim şablonu arayan',
      terms: [
        'şablon',
        'rehber',
        'taktik',
        'ipucu',
        'template',
        'akış',
        'hazır',
      ],
      need: 'Kendi içerik ve projelerine uyarlayabileceği hazır şablonlar bulmak',
      objection:
        'Hemen uygulayabileceğim bir format veya şablon verilmemişse ilgi göstermem.',
    },
    {
      key: 'contrarian-insight',
      title: 'Özgün ve farklı kanca arayan',
      terms: ['ezber bozan', 'özgün', 'farklı', 'kanca', 'bakış', 'dikkat'],
      need: 'Klişelerden uzak, taze ve dikkat çeken bir bakış açısı görmek',
      objection:
        'Her gün görülen viral formatların aynısıysa dikkatimi çekmez.',
    },
    {
      key: 'fast-roi',
      title: 'Hızlı üretim ve zaman tasarrufu isteyen',
      terms: ['hızlı', 'pratik', 'zaman', 'otomasyon', 'verim', 'kolay'],
      need: 'İçerik ve ürün hazırlığını hızlandıran araçları incelemek',
      objection: 'Kullanımı karmaşıksa ve vakit kaybettirirse tercih etmem.',
    },
    {
      key: 'community-dialogue',
      title: 'Etkileşim ve topluluk arayan',
      terms: ['tartışma', 'topluluk', 'yorum', 'birlikte', 'paylaşım'],
      need: 'Toplulukla etkileşime geçebileceği samimi bir diyalog bulmak',
      objection: 'Etkileşime kapalı, tek yönlü duyurulara cevap vermem.',
    },
  ],
};
const lower = (s: string) => s.normalize('NFKC').toLocaleLowerCase('tr-TR');
const matches = (s: string, theme: Theme) =>
  theme.terms.some((term) => lower(s).includes(lower(term)));

const CREATOR_STOP_WORDS = new Set([
  'için',
  'gibi',
  'olan',
  'olarak',
  'nasıl',
  'neden',
  'daha',
  'sonra',
  'önce',
  'birlikte',
  'hakkında',
  'beyan',
  'içerik',
  'metni',
  'paylaşılan',
  'örnek',
  'bunu',
  'bunun',
  'kendi',
  'üzerine',
  'with',
  'that',
  'this',
  'your',
]);

/** Creator topics come from the supplied material, not a fixed builder audience. */
function creatorThemes(
  dataset: AudienceDatasetV1,
  content: AudienceDatasetV1['content'],
): Theme[] {
  const materials = [
    ...content.map((row) => row.text),
    ...dataset.research
      .filter((row) => row.theme !== 'creator-audience')
      .map((row) => row.statement),
  ];
  const topics = new Map<string, { subject: string; terms: string[] }>();
  for (const material of materials) {
    const clean = material
      .replace(
        /^(?:Paylaşılan içerik metni|İçerik örneği|Paylaşım)\s*:\s*/i,
        '',
      )
      .replace(/\s+Örnek içerik\s+\d+.*$/i, '')
      .trim();
    const words = clean.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
    const terms = [
      ...new Set(
        words
          .map(lower)
          .filter((word) => word.length >= 4 && !CREATOR_STOP_WORDS.has(word)),
      ),
    ].slice(0, 8);
    if (!terms.length) continue;
    const key = terms.slice(0, 5).join('-');
    if (!topics.has(key))
      topics.set(key, { subject: words.slice(0, 9).join(' ').slice(0, 120), terms });
  }
  if (topics.size) {
    return [...topics.values()].slice(0, 12).map(({ subject, terms }) => {
      const lowerTerms = terms.map(t => t.toLowerCase()).join(' ');
      let title = 'İçerik Kaşifi';
      if (lowerTerms.includes('otomasyon') || lowerTerms.includes('verim') || lowerTerms.includes('hızlı')) {
        title = 'Hızlı İcraatçı';
      } else if (lowerTerms.includes('kurucu') || lowerTerms.includes('yolculuk') || lowerTerms.includes('buildinpublic')) {
        title = 'Solo Girişimci';
      } else if (lowerTerms.includes('kod') || lowerTerms.includes('mimari') || lowerTerms.includes('api') || lowerTerms.includes('teknik')) {
        title = 'Teknik Mimar';
      } else if (lowerTerms.includes('şablon') || lowerTerms.includes('rehber') || lowerTerms.includes('taktik')) {
        title = 'Taktik Arayan';
      } else if (lowerTerms.includes('analiz') || lowerTerms.includes('karşıt') || lowerTerms.includes('veri')) {
        title = 'Analitik Eleştirmen';
      } else if (lowerTerms.includes('hata') || lowerTerms.includes('öğrenim') || lowerTerms.includes('deneyim')) {
        title = 'Deneyim Kaşifi';
      } else if (terms.length >= 2) {
        title = `${terms[0].charAt(0).toUpperCase() + terms[0].slice(1)} ${terms[1].charAt(0).toUpperCase() + terms[1].slice(1)}`;
      } else if (terms.length === 1) {
        title = `${terms[0].charAt(0).toUpperCase() + terms[0].slice(1)} Kaşifi`;
      }
      return {
        key: `creator-topic-${hashCanonical(terms).slice(0, 12)}`,
        title,
        terms,
        need: `${subject} bağlamında kendi kullanımına uyarlayabileceği somut bir örnek ve açıklık görmek`,
        objection: `${subject} hakkında yalnız genel bir vaat varsa önce ayrıntı ve kaynak sorarım.`,
      };
    });
  }
  const subject = dataset.brand.description
    .split(/[.!?\n]/)[0]
    .trim()
    .slice(0, 100);
  return [
    {
      key: 'creator-brief-example',
      title: 'Somut Örnekçi',
      terms: ['örnek', 'uygulama', 'deneyim'],
      need: `${subject}: konuyu somut örnekle anlamak`,
      objection: 'Örnek görmeden bu içeriğin kendime uygunluğunu bilemem.',
    },
    {
      key: 'creator-brief-depth',
      title: 'Kaynak Denetçisi',
      terms: ['ayrıntı', 'kaynak', 'kanıt'],
      need: `${subject}: açıklamanın dayanağını ve sınırlarını görmek`,
      objection:
        'Verilen bilginin kaynağı ve sınırı açıklanmıyorsa soru sorarım.',
    },
    {
      key: 'creator-brief-start',
      title: 'İlk Adımcı',
      terms: ['başlangıç', 'ilk adım', 'rehber'],
      need: `${subject}: nasıl başlanacağını anlamak`,
      objection:
        'Konu ilgimi çekse de ilk adım belirsizse hemen harekete geçmem.',
    },
  ];
}

export type CompiledPersonaPanel = {
  schemaVersion: 1;
  datasetHash: string;
  seed: string;
  personas: SimulationPersonaV1[];
  agents: AgentIdentityV1[];
};

export function compilePersonaPanel(
  input: AudienceDatasetV1,
  options: { seed: string; primarySourceId?: string },
): CompiledPersonaPanel {
  const normalized = normalizeAudienceDataset(input),
    dataset = normalized.dataset;
  const seed = labText(options.seed, 'seed', 128);
  const primary = options.primarySourceId
    ? dataset.sources.find((s) => s.id === options.primarySourceId)
    : (dataset.sources.find((s) => s.population === 'engaged-audience') ??
      dataset.sources.find((s) => s.population === 'followers') ??
      dataset.sources.find((s) => s.population !== 'declared-research') ??
      dataset.sources[0]);
  if (!primary) return invalidLabInput('primarySourceId', 'SOURCE_INVALID');
  const content = dataset.content.filter((c) => c.sourceRef === primary.id);
  const events = dataset.events.filter((e) => e.sourceRef === primary.id);
  const observations = dataset.observations.filter(
    (o) => o.sourceRef === primary.id,
  );
  const isCreator = ['personal-brand', 'creator'].includes(
    dataset.brand.category,
  );
  const themes = isCreator
    ? creatorThemes(dataset, content)
    : THEMES[dataset.brand.category];
  const candidates = themes
    .map((theme) => {
      const posts = content.filter((c) =>
        matches(`${c.text} ${c.themeTags.join(' ')}`, theme),
      );
      const research = dataset.research.filter((r) =>
        matches(`${r.theme} ${r.statement}`, theme),
      );
      const products = dataset.products.filter((p) =>
        matches(
          `${p.name} ${p.category} ${p.facts.map((f) => f.text).join(' ')}`,
          theme,
        ),
      );
      const relevantEvents = events.filter((e) =>
        products.some((p) => p.id === e.productRef),
      );
      return {
        theme,
        posts,
        research,
        products,
        relevantEvents,
        score:
          posts.length * 3 +
          research.length * 2 +
          products.length +
          (relevantEvents.length ? 1 : 0),
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score || a.theme.key.localeCompare(b.theme.key, 'en'),
    );
  const enoughContext =
    content.length >= 2 || events.length >= 2 || dataset.research.length >= 2;
  const selected = enoughContext
    ? candidates.filter((c) => c.score > 0).slice(0, 6)
    : candidates.slice(0, 3);
  if (!isCreator && enoughContext && selected.length < 6)
    for (const candidate of candidates) {
      if (!selected.includes(candidate)) selected.push(candidate);
      if (selected.length === 6) break;
    }
  const personas: SimulationPersonaV1[] = selected.map((candidate) => {
    const { theme, posts, research, products, relevantEvents } = candidate;
    const idHash = hashCanonical({
      datasetHash: normalized.datasetHash,
      primarySourceId: primary.id,
      compilerVersion: PERSONA_COMPILER_VERSION,
      seed,
      theme: theme.key,
    });
    const id = `persona-${idHash.slice(0, 24)}`;
    const observedFacts: PersonaClaim[] = [];
    const derivedSignals: PersonaClaim[] = [];
    const claim = (
      suffix: string,
      text: string,
      kind: PersonaClaim['kind'],
      evidenceRefs: string[],
    ): PersonaClaim => ({ id: `${id}:${suffix}`, text, kind, evidenceRefs });
    if (isCreator)
      observedFacts.push(
        claim(
          'creator-context',
          `Kişisel marka beyanı: ${dataset.brand.description}`,
          'declared',
          ['brand:description'],
        ),
      );
    for (const p of products.slice(0, 2)) {
      const fact = p.facts.find((f) => matches(f.text, theme)) ?? p.facts[0];
      if (fact)
        observedFacts.push(
          claim(`product-${p.id}`, `${p.name}: ${fact.text}`, 'declared', [
            `product:${p.id}`,
            `fact:${fact.id}`,
          ]),
        );
    }
    if (!observedFacts.length) {
      const p = dataset.products[0],
        fact = p.facts[0];
      observedFacts.push(
        claim(
          'product-context',
          `${p.name}${fact ? `: ${fact.text}` : ''}`,
          'declared',
          [
            `product:${p.id}`,
            ...(fact ? [`fact:${fact.id}`] : ['brand:description']),
          ],
        ),
      );
    }
    for (const r of research.slice(0, 2))
      observedFacts.push(
        claim(
          `research-${r.id}`,
          `Araştırma beyanı: ${r.statement}`,
          'declared',
          [`research:${r.id}`],
        ),
      );
    if (isCreator)
      for (const row of dataset.research
        .filter((item) => item.theme === 'creator-audience')
        .slice(0, 2))
        observedFacts.push(
          claim(
            `audience-${row.id}`,
            `Kitle hakkında kullanıcı beyanı: ${row.statement}`,
            'declared',
            [`research:${row.id}`],
          ),
        );
    if (posts.length)
      derivedSignals.push(
        claim(
          'content-theme',
          `Seçilen ${primary.platform} içerik örneğinde ${posts.length}/${content.length} kayıtta ${theme.key} temasıyla ilişkili metin veya beyan etiketi var. Bu kişi tercihi veya erişim oranı değildir.`,
          'computed',
          posts.slice(0, 8).map((p) => `content:${p.id}`),
        ),
      );
    if (relevantEvents.length)
      derivedSignals.push(
        claim(
          'provided-events',
          `Seçilen kaynakta ilgili ürünler için ${relevantEvents.length} olay kaydı var; ${new Set(relevantEvents.map((e) => e.profileRef)).size} kaynak içi takma profil içeriyor. Satış veya motivasyon doğrulaması değildir.`,
          'computed',
          relevantEvents.slice(0, 8).map((e) => `event:${e.id}`),
        ),
      );
    const groundedRefs = [
      ...new Set(
        [...observedFacts, ...derivedSignals].flatMap((c) => c.evidenceRefs),
      ),
    ];
    const assumptions = [
      claim(
        'scenario-need',
        `${theme.need}. Bu kart, verilen bağlamla sınanacak kurgusal bir ihtiyaç senaryosudur.`,
        'assumed',
        groundedRefs.slice(0, 8),
      ),
      claim(
        'scenario-objection',
        theme.objection,
        'assumed',
        groundedRefs.slice(0, 8),
      ),
    ];
    const knownClaims = [...observedFacts, ...derivedSignals, ...assumptions];
    const evidenceRefs = [
      ...new Set(knownClaims.flatMap((c) => c.evidenceRefs)),
    ].sort();
    if (evidenceRefs.some((ref) => !normalized.evidence[ref]))
      throw new Error('AUDIENCE_LAB_COMPILER_EVIDENCE_INVALID');
    const sourceHasDemographics = observations.some(
      (o) =>
        o.status === 'observed' &&
        Object.keys(o.dimensions).some((key) =>
          [
            'age',
            'age_group',
            'ageGroup',
            'gender',
            'country',
            'city',
            'gender_age',
          ].includes(key),
        ),
    );
    return {
      schemaVersion: 1,
      id,
      version: 1,
      datasetHash: normalized.datasetHash,
      compilerVersion: PERSONA_COMPILER_VERSION,
      title: theme.title,
      summary: theme.need,
      observedFacts,
      derivedSignals,
      assumptions,
      unknowns: [
        'Bu senaryonun gerçek kitledeki payı ve gerçek dönüşüm olasılığı bilinmiyor.',
        'Kişisel yaş, gelir, meslek, satın alma geçmişi ve deneyim bilinmiyor.',
        'Kaynaklar arasında bireysel kimlik eşlemesi yapılmadı.',
        ...(sourceHasDemographics
          ? [
              'Toplu demografi bu kurgusal kimliğin bireysel özelliklerini belirlemez.',
            ]
          : ['Birincil kaynağın kullanılabilir demografik kırılımı yok.']),
        ...(!posts.length && !research.length && !relevantEvents.length
          ? [
              'Bu ihtiyaç için doğrudan kitle kanıtı yok; ürün/brief varsayımı kullanılıyor.',
            ]
          : []),
      ],
      needs: [theme.need],
      objections: [theme.objection],
      decisionRules: [
        {
          id: `${id}:rule-specific`,
          condition:
            'Deneyim, ihtiyaç ve görevle ilgili somut ve destekli bilgi veriyorsa',
          effect: 'prefer',
          reason: theme.need,
          claimRefs: knownClaims.map((c) => c.id),
        },
        {
          id: `${id}:rule-unknown`,
          condition: 'Karar için gereken ürün veya teklif bilgisi eksikse',
          effect: 'ask',
          reason: theme.objection,
          claimRefs: [assumptions[1].id],
        },
        {
          id: `${id}:rule-claim`,
          condition:
            'Kaynağı bulunmayan kesin sonuç, indirim veya deneyim iddiası varsa',
          effect: 'avoid',
          reason: 'Vaat güvenilirliğini somut kaynakla kontrol et.',
          claimRefs: [assumptions[0].id],
        },
      ],
      weight: { value: 1 / selected.length, basis: 'equal-scenario' },
      evidenceRefs,
    };
  });
  return {
    schemaVersion: 1,
    datasetHash: normalized.datasetHash,
    seed,
    personas,
    agents: compileAgentIdentities(personas, dataset.brand.language),
  };
}
