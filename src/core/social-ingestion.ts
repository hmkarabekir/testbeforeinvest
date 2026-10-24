import type { AudienceDatasetV1 } from './types.js';
import { parseAudienceDataset } from './dataset-contract.js';
import { appendDemoDataset, generateDemoData } from './demo-data.js';
import { hashCanonical } from './dataset-normalizer.js';

export type SocialPlatform = 'instagram' | 'facebook' | 'x' | 'custom';
export type SocialPopulation = 'followers' | 'engaged-audience';

export type FetchSocialParams = {
  platform: SocialPlatform;
  handle: string;
  accessToken?: string;
  demo?: boolean;
  seed?: string | number;
  scenarioId?: string;
  size?: string;
  login?: 'facebook' | 'instagram';
  population?: SocialPopulation;
  brandName?: string;
  brandDescription?: string;
  category?: 'personal-brand' | 'creator' | 'software' | 'coffee' | 'furniture' | 'other';
};

export type CreateCustomProductParams = {
  productName: string;
  brandName?: string;
  category?: 'personal-brand' | 'creator' | 'software' | 'coffee' | 'furniture' | 'other';
  description?: string;
  facts: string[];
  targetAudienceHypothesis?: string;
  samplePosts?: string[];
  price?: number | null;
  region?: string;
  knowledgeLevel?: string;
  ageRange?: string;
  topics?: string[];
  motivations?: string[];
  objections?: string[];
  userProfile?: string;
  decisionCriteria?: string[];
};

export type MultiSourceParams = {
  dataset?:AudienceDatasetV1;
  instagram?: { handle: string; accessToken?: string; population?: SocialPopulation };
  x?: { handle: string; accessToken?: string; population?: SocialPopulation };
  includePixel?: boolean;
  pixelEvents?: Array<{ id: string; eventName: string; pageUrl?: string; timestamp?: string; anonymousId?: string; synthetic?:boolean }>;
};

export type SocialAudienceSummary = {
  platform: SocialPlatform;
  handle: string;
  totalAudience: number | null;
  metrics: { contentCount: number; eventCount: number; researchCount: number; observationCount: number; sourceCount: number };
  provenance: { kind: 'synthetic-demo' | 'declared-research' | 'source-data'; notices: string[] };
  population: AudienceDatasetV1['sources'][number]['population'];
  demographics: {
    gender: { male: number | null; female: number | null; other?: number | null };
    topAgeGroup: string | null;
    ageDistribution: Record<string, number>;
    topCities: Array<{ city: string; percentage: number }>;
  };
  recentPosts: Array<{
    id: string;
    text: string;
    likes: number | null;
    comments: number | null;
    date: string;
    themes: string[];
  }>;
  identifiedInterests: string[];
};

export class SocialAudienceIngestionService {
  /**
   * Fetches or parses audience data from Meta (Instagram/Facebook) or X (Twitter).
   */
  async ingestSocialAudience(params: FetchSocialParams): Promise<{
    dataset: AudienceDatasetV1;
    summary: SocialAudienceSummary;
  }> {
    const { platform, handle, accessToken, population = 'engaged-audience' } = params;
    const cleanHandle = handle.replace(/^@/, '').trim();

    if (!cleanHandle) throw new Error('SOCIAL_HANDLE_REQUIRED');
    if (params.demo) {
      const scenarioId = params.scenarioId || (/dev|code|tech|soft|mert/i.test(cleanHandle) || params.category==='software' ? 'software-builders'
        : params.category==='coffee' ? 'coffee-explorers' : params.category==='furniture' ? 'furniture-design' : 'creator-beginners');
      const generated = generateDemoData({scenarioId,seed:params.seed,size:params.size,source:platform==='x'?'grok':platform==='custom'?'mixed':platform});
      generated.dataset.brand.name=params.brandName||`@${cleanHandle}`;
      if(params.brandDescription)generated.dataset.brand.description=params.brandDescription;
      return {dataset:parseAudienceDataset(generated.dataset),summary:this.buildSummary(generated.dataset,platform,cleanHandle)};
    }
    if (!accessToken?.trim()) throw new Error('SOCIAL_TOKEN_REQUIRED');
    if (platform === 'x') throw new Error('X_DIRECT_DISABLED_USE_GROK');
    if (platform !== 'facebook' && platform !== 'instagram') throw new Error('SOCIAL_PLATFORM_INVALID');
    return this.fetchLiveMetaGraph(cleanHandle, accessToken, population, platform, params.login);
  }

  /**
   * Attempts public profile resolution from open web endpoints when token is absent.
   */
  private async fetchPublicWebProfile(platform: SocialPlatform, handle: string): Promise<{ name?: string; bio?: string } | null> {
    try {
      if (platform === 'x') {
        const res = await fetch(`https://publish.twitter.com/oembed?url=https://twitter.com/${handle}`, {
          signal: AbortSignal.timeout(2500),
        });
        if (res.ok) {
          const json = (await res.json()) as any;
          return {
            name: json.author_name || handle,
            bio: `${json.author_name || handle} X platformundaki açık profili.`,
          };
        }
      }
    } catch {}
    return null;
  }

  /**
   * Imports audience dataset from a raw JSON payload (e.g. Meta Insights or X Analytics export).
   */
  importFromJson(rawJson: unknown): { dataset: AudienceDatasetV1; summary: SocialAudienceSummary } {
    let dataset: AudienceDatasetV1;
    try {
      dataset = parseAudienceDataset(rawJson);
    } catch {
      // If it's a raw Meta or X export, normalize it
      dataset = parseAudienceDataset(this.normalizeRawExport(rawJson));
    }
    const summary = this.buildSummary(dataset, 'custom', dataset.brand.name);
    return { dataset, summary };
  }

  /**
   * Parses qualitative audience research report generated by xAI Grok (X Search).
   */
  importGrokReport(reportText: string, baseDataset?: AudienceDatasetV1): { dataset: AudienceDatasetV1; summary: SocialAudienceSummary } {
    if (typeof reportText !== 'string' || reportText.trim().length < 40 || reportText.length > 50000) {
      throw new Error('GROK_REPORT_INVALID');
    }
    const now = new Date().toISOString();
    const sourceId = 'src-grok-user-report';
    const dataset: AudienceDatasetV1 = {
      schemaVersion: 1, label: 'Grok araştırması - kullanıcı tarafından içe aktarıldı', synthetic: false,
      asOf: now, window: { from: new Date(Date.now() - 30 * 86400000).toISOString(), to: now },
      brand: { name: 'İçe aktarılan kitle araştırması', category: 'creator', language: 'tr', description: 'Açık içerikten çıkarılmış, bağımsız doğrulanmamış kitle hipotezleri.' },
      products: [{ id: 'prod-research', name: 'İncelenecek deneyim', category: 'research', price: null,
        facts: [{ id: 'brief-required', text: 'Ürün özellikleri kullanıcı briefinde ayrıca belirtilmelidir.' }] }],
      sources: [{ id: sourceId, platform: 'x', population: 'declared-research', sampled: true, complete: false, collectedAt: now }],
      observations: [], content: [], events: [],
      research: reportText.split(/(?=M[ÜU][ŞS]TER[İI]\s+KARTI\s*\d)/iu).filter(s=>s.trim()).flatMap(s=>s.match(/[\s\S]{1,1600}/g) || []).map((chunk, i) => ({
        id: `grok-${hashCanonical(reportText).slice(0,12)}-${i + 1}`, sourceRef: sourceId,
        statement: `Grok raporundan kullanıcı/model beyanı (doğrulanmış ölçüm değildir): ${chunk.trim()}`,
        theme: 'audience-hypothesis', sampleSize: null,
      })),
    };
    const parsed = baseDataset ? appendDemoDataset(baseDataset, dataset) : parseAudienceDataset(dataset);
    return { dataset: parsed, summary: this.buildSummary(parsed, 'x', 'Grok araştırması') };
  }

  /**
   * Live Meta Graph API Ingestion (Instagram Business & Facebook Pages)
   */
  private async fetchLiveMetaGraph(
    handle: string, accessToken: string, population: SocialPopulation, platform: 'facebook' | 'instagram',
    login: 'facebook' | 'instagram' = 'facebook',
  ): Promise<{ dataset: AudienceDatasetV1; summary: SocialAudienceSummary }> {
    const version = process.env.META_GRAPH_VERSION || 'v25.0';
    if (!/^v\d+\.0$/.test(version)) throw new Error('META_VERSION_INVALID');
    const read = async (path: string, token = accessToken) => {
      const url = new URL(`https://${login==='instagram'&&platform==='instagram'?'graph.instagram.com':'graph.facebook.com'}/${version}/${path}`);
      url.searchParams.set('access_token', token);
      let response: Response;
      let value: any;
      try {
        response = await fetch(url, { signal: AbortSignal.timeout(12000) });
        value = await response.json();
      } catch { throw new Error('META_REQUEST_FAILED'); }
      if (!response.ok || value.error) throw new Error('META_REQUEST_FAILED');
      return value;
    };
    let pages: any[] = [];
    if (login==='instagram'&&platform==='instagram') {
      const account=await read('me?fields=user_id,username');
      const accountId=account.user_id || account.id;
      pages=[{id:accountId,name:account.username,instagram_business_account:{id:accountId}}];
    } else {
      try { pages = (await read('me/accounts?fields=id,name,instagram_business_account')).data || []; }
      catch { pages = [await read('me?fields=id,name,instagram_business_account')]; }
    }
    const page = pages.find((p) => p.id === handle || String(p.name).toLocaleLowerCase() === handle.toLocaleLowerCase())
      || (pages.length === 1 ? pages[0] : null);
    if (!page?.id) throw new Error('META_ACCOUNT_SELECTION_REQUIRED');
    const now = new Date().toISOString();
    const id = platform === 'instagram' ? page.instagram_business_account?.id : page.id;
    if (!id) throw new Error('META_INSTAGRAM_ACCOUNT_REQUIRED');
    const notices: string[] = [];
    let profile: any = { id, name: page.name };
    try { profile = await read(`${id}?fields=${platform === 'instagram' ? 'id,username,name,followers_count' : 'id,name,followers_count'}`); }
    catch { notices.push('Takipçi toplamı alınamadı.'); }
    const sourceId = `src-meta-${platform}-${id}`;
    const observations: AudienceDatasetV1['observations'] = [];
    if (Number.isInteger(profile.followers_count) && profile.followers_count >= 0) observations.push({
      id: 'meta-followers', sourceRef: sourceId, metric: 'followers_count', dimensions: {}, unit: 'count',
      value: profile.followers_count, status: 'observed', denominatorRef: null, observedAt: now,
    });
    if (platform === 'instagram') {
      for (const dimension of ['age','gender','city','country']) {
        try {
          const response = await read(`${id}/insights?metric=follower_demographics&period=lifetime&metric_type=total_value&breakdown=${dimension}&timeframe=last_30_days`);
          for (const metric of response.data || []) for (const breakdown of metric.total_value?.breakdowns || []) {
            for (const [i, result] of (breakdown.results || []).entries()) {
              const key = result.dimension_values?.[0];
              if (typeof key !== 'string' || !Number.isFinite(result.value)) continue;
              observations.push({ id: `ig-${dimension}-${i}`, sourceRef: sourceId, metric: 'follower_demographics',
                dimensions: { [dimension]: key }, unit: 'count', value: result.value, status: 'observed',
                denominatorRef: observations.some((o) => o.id === 'meta-followers') ? 'meta-followers' : null, observedAt: now });
            }
          }
        } catch { notices.push(`${dimension} kırılımı API tarafından sağlanmadı.`); }
      }
    } else notices.push('Facebook demografisi bu bağlantıda alınmadı; bilinmeyen alanlar doldurulmaz.');
    let posts: any[] = [];
    try {
      const edge = platform === 'instagram' ? 'media?fields=id,caption,timestamp,like_count,comments_count&limit=15'
        : 'published_posts?fields=id,message,created_time,likes.summary(true),comments.summary(true)&limit=15';
      posts = (await read(`${id}/${edge}`)).data || [];
    } catch { notices.push('Gönderiler alınamadı.'); }
    const dataset: AudienceDatasetV1 = {
      schemaVersion: 1, label: `${platform}: ${profile.username || profile.name || handle}`, synthetic: false,
      asOf: now, window: { from: new Date(Date.now() - 30 * 86400000).toISOString(), to: now },
      brand: { name: profile.name || handle, category: 'creator', language: 'tr', description: 'Yetkilendirilmiş hesabın API tarafından döndürülen verileri.' },
      products: [{ id: 'prod-social-1', name: 'İncelenecek deneyim', category: 'social', price: null,
        facts: [{ id: 'social-brief', text: 'Ürün özellikleri kullanıcı briefinde ayrıca belirtilmelidir.' }] }],
      sources: [{ id: sourceId, platform, population: 'followers', sampled: true, complete: false, collectedAt: now }],
      observations, events: [], research: [],
      content: posts.filter((p) => p.id && (p.caption || p.message)).map((p) => ({
        id: `post-${p.id}`, sourceRef: sourceId, productRefs: [], text: p.caption || p.message,
        publishedAt: p.timestamp || p.created_time || now,
        likes: p.like_count ?? p.likes?.summary?.total_count ?? null,
        comments: p.comments_count ?? p.comments?.summary?.total_count ?? null, themeTags: [],
      })),
    };
    const parsed = parseAudienceDataset(dataset);
    const summary = this.buildSummary(parsed, platform, profile.username || profile.name || handle);
    summary.provenance.notices.push(...notices);
    return { dataset: parsed, summary };
  }

  /**
   * Live X API v2 Ingestion
   */
  private async fetchLiveTwitterApi(
    handle: string,
    bearerToken: string,
    population: SocialPopulation,
  ): Promise<{ dataset: AudienceDatasetV1; summary: SocialAudienceSummary }> {
    const userRes = await fetch(
      `https://api.twitter.com/2/users/by/username/${handle}?user.fields=description,public_metrics`,
      { headers: { Authorization: `Bearer ${bearerToken}` } },
    );
    const userData = (await userRes.json()) as any;
    const user = userData?.data;

    const tweetsRes = await fetch(
      `https://api.twitter.com/2/users/${user?.id}/tweets?max_results=10&tweet.fields=public_metrics,created_at`,
      { headers: { Authorization: `Bearer ${bearerToken}` } },
    );
    const tweetsData = (await tweetsRes.json()) as any;

    const now = new Date().toISOString();
    const from = new Date(Date.now() - 30 * 86400000).toISOString();
    const sourceId = `src-x-${user?.id || handle}`;

    const content: AudienceDatasetV1['content'] = [];
    if (Array.isArray(tweetsData?.data)) {
      for (const t of tweetsData.data) {
        content.push({
          id: `tweet-${t.id}`,
          sourceRef: sourceId,
          productRefs: [],
          text: t.text || '',
          publishedAt: t.created_at || now,
          likes: t.public_metrics?.like_count ?? 0,
          comments: t.public_metrics?.reply_count ?? 0,
          themeTags: ['x-tweet'],
        });
      }
    }

    const dataset: AudienceDatasetV1 = {
      schemaVersion: 1,
      label: `@${handle} · X (Twitter) Audience`,
      synthetic: false,
      asOf: now,
      window: { from, to: now },
      brand: {
        name: user?.name || handle,
        category: 'creator',
        language: 'tr',
        description: user?.description || `@${handle} X profili.`,
      },
      products: [
        {
          id: 'prod-x-1',
          name: `${handle} Dijital Teklifi`,
          category: 'sosyal-icerik',
          facts: [{ id: 'f1', text: `${handle} X takipçileri için derlenmiş organik kitle verisi.` }],
          price: null,
        },
      ],
      sources: [
        {
          id: sourceId,
          platform: 'x',
          population,
          sampled: true,
          complete: false,
          collectedAt: now,
        },
      ],
      observations: [],
      content,
      events: [],
      research: [],
    };

    const summary = this.buildSummary(dataset, 'x', handle);
    return { dataset, summary };
  }

  /**
   * Smart Profile & Ingestion Simulator for Handles
   */
  private synthesizeSocialAudience(params: {
    platform: SocialPlatform;
    handle: string;
    population: SocialPopulation;
    brandName?: string;
    brandDescription?: string;
    category?: 'personal-brand' | 'creator' | 'software' | 'coffee' | 'furniture' | 'other';
  }): { dataset: AudienceDatasetV1; summary: SocialAudienceSummary } {
    const { platform, handle, population } = params;
    const now = new Date().toISOString();
    const from = new Date(Date.now() - 30 * 86400000).toISOString();
    const sourceId = `src-${platform}-${handle}`;

    const isDeveloperNiche = /dev|code|tech|soft|linus|engineer|ai|bot|mert/i.test(handle);
    const isCultureNiche = /ilber|tarih|kitap|felsefe|kultur|art|yazar/i.test(handle);

    const category = params.category || (isDeveloperNiche ? 'software' : isCultureNiche ? 'creator' : 'personal-brand');
    const brandName = params.brandName || `@${handle}`;
    const brandDescription =
      params.brandDescription ||
      (isDeveloperNiche
        ? `@${handle} — Yazılım mimarisi, kodlama pratikleri, AI sistemleri ve teknoloji içerikleri üreten dijital profil.`
        : isCultureNiche
          ? `@${handle} — Tarih, edebiyat, entelektüel derinlik ve kültür analizleri sunan dijital yayıncı.`
          : `@${handle} — ${platform.toUpperCase()} üzerinde aktif takipçi ve etkileşim kitlesi.`);

    // Structured observations (Instagram/Meta Insights format)
    const observations: AudienceDatasetV1['observations'] = [
      // Gender breakdown
      {
        id: 'obs-gender-male',
        sourceRef: sourceId,
        metric: 'follower_demographics',
        dimensions: { gender: 'M' },
        unit: 'percent',
        value: isDeveloperNiche ? 78 : isCultureNiche ? 52 : 60,
        status: 'observed',
        denominatorRef: null,
        observedAt: now,
      },
      {
        id: 'obs-gender-female',
        sourceRef: sourceId,
        metric: 'follower_demographics',
        dimensions: { gender: 'F' },
        unit: 'percent',
        value: isDeveloperNiche ? 22 : isCultureNiche ? 48 : 40,
        status: 'observed',
        denominatorRef: null,
        observedAt: now,
      },
      // Age distribution
      {
        id: 'obs-age-25-34',
        sourceRef: sourceId,
        metric: 'follower_demographics',
        dimensions: { age: '25-34' },
        unit: 'percent',
        value: isDeveloperNiche ? 54 : isCultureNiche ? 42 : 46,
        status: 'observed',
        denominatorRef: null,
        observedAt: now,
      },
      {
        id: 'obs-age-18-24',
        sourceRef: sourceId,
        metric: 'follower_demographics',
        dimensions: { age: '18-24' },
        unit: 'percent',
        value: isDeveloperNiche ? 26 : isCultureNiche ? 20 : 28,
        status: 'observed',
        denominatorRef: null,
        observedAt: now,
      },
      {
        id: 'obs-age-35-44',
        sourceRef: sourceId,
        metric: 'follower_demographics',
        dimensions: { age: '35-44' },
        unit: 'percent',
        value: isDeveloperNiche ? 15 : isCultureNiche ? 25 : 18,
        status: 'observed',
        denominatorRef: null,
        observedAt: now,
      },
      // Top Cities
      {
        id: 'obs-city-ist',
        sourceRef: sourceId,
        metric: 'follower_demographics',
        dimensions: { city: 'İstanbul' },
        unit: 'percent',
        value: 44,
        status: 'observed',
        denominatorRef: null,
        observedAt: now,
      },
      {
        id: 'obs-city-ank',
        sourceRef: sourceId,
        metric: 'follower_demographics',
        dimensions: { city: 'Ankara' },
        unit: 'percent',
        value: 19,
        status: 'observed',
        denominatorRef: null,
        observedAt: now,
      },
      {
        id: 'obs-city-izm',
        sourceRef: sourceId,
        metric: 'follower_demographics',
        dimensions: { city: 'İzmir' },
        unit: 'percent',
        value: 12,
        status: 'observed',
        denominatorRef: null,
        observedAt: now,
      },
    ];

    // High-engagement posts tailored to the profile
    const content: AudienceDatasetV1['content'] = isDeveloperNiche
      ? [
          {
            id: 'post-1',
            sourceRef: sourceId,
            productRefs: ['prod-main-1'],
            text: 'Yeni mimarimizde Docker ve NestJS optimizasyonu ile gecikmeyi %40 düşürdük. Clean code sadece fantezi değil, faturayı düşüren bir zorunluluk.',
            publishedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
            likes: 1420,
            comments: 94,
            themeTags: ['mimari', 'clean-code', 'performans'],
          },
          {
            id: 'post-2',
            sourceRef: sourceId,
            productRefs: ['prod-main-1'],
            text: 'Yapay zeka araçları kod yazıyor ama mimariyi hala insan kurmak zorunda. 18 izole simülasyon ajanı ile test ettiğimiz yeni framework açık kaynakta.',
            publishedAt: new Date(Date.now() - 7 * 86400000).toISOString(),
            likes: 2150,
            comments: 182,
            themeTags: ['ai', 'agentic', 'açık-kaynak'],
          },
          {
            id: 'post-3',
            sourceRef: sourceId,
            productRefs: ['prod-main-1'],
            text: 'Talk is cheap, show me the code. Boilerplate laflarla vakit kaybetmeyin, repo linki bio’da.',
            publishedAt: new Date(Date.now() - 12 * 86400000).toISOString(),
            likes: 3100,
            comments: 240,
            themeTags: ['kod', 'linus', 'pratik'],
          },
        ]
      : isCultureNiche
        ? [
            {
              id: 'post-1',
              sourceRef: sourceId,
              productRefs: ['prod-main-1'],
              text: 'Cahil kalmayın, mimariyi ve tarihi derinlemesine öğrenin. Bir sistemi anlamadan üzerine yenisini inşa edemezsiniz.',
              publishedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
              likes: 4200,
              comments: 310,
              themeTags: ['kütüphane', 'tarih', 'öğrenme'],
            },
            {
              id: 'post-2',
              sourceRef: sourceId,
              productRefs: ['prod-main-1'],
              text: 'Kitapların ve kadim bilgilerin ışığında düşünce disiplini geliştirmek, günümüzün en kıymetli becerisidir.',
              publishedAt: new Date(Date.now() - 8 * 86400000).toISOString(),
              likes: 3450,
              comments: 215,
              themeTags: ['felsefe', 'derinlik', 'kültür'],
            },
          ]
        : [
            {
              id: 'post-1',
              sourceRef: sourceId,
              productRefs: ['prod-main-1'],
              text: `${handle} takipçileri için özel analiz: İçeriklerimizi yayına almadan önce kitlenin gerçek beklentilerini ölçüyoruz.`,
              publishedAt: new Date(Date.now() - 4 * 86400000).toISOString(),
              likes: 980,
              comments: 67,
              themeTags: ['analiz', 'topluluk'],
            },
          ];

    const dataset: AudienceDatasetV1 = {
      schemaVersion: 1,
      label: `@${handle} · ${platform.toUpperCase()} (${population})`,
      synthetic: true,
      asOf: now,
      window: { from, to: now },
      brand: {
        name: brandName,
        category,
        language: 'tr',
        description: brandDescription,
      },
      products: [
        {
          id: 'prod-main-1',
          name: isDeveloperNiche ? 'Agentic Coding & Mimariler' : isCultureNiche ? 'Kültür & Düşünce Serisi' : `${handle} Dijital Teklifi`,
          category: isDeveloperNiche ? 'yazılım' : 'içerik',
          facts: isDeveloperNiche
            ? [
                { id: 'f1', text: '18 izole sanal kimlikle reklam ve içerik ön testi sunar.' },
                { id: 'f2', text: 'Açık kaynak TypeScript mimarisi ile sıfır gizli maliyet.' },
                { id: 'f3', text: 'Codex CLI GPT-6 Luna ve yerel kural motoruyla tam entegre çalışır.' },
              ]
            : [
                { id: 'f1', text: 'Kapsamlı kaynaklar ve kanıtlanmış analitik yöntemler içerir.' },
                { id: 'f2', text: 'Yüzeysel trendler yerine sağlam kavramsal temel sunar.' },
              ],
          price: null,
        },
      ],
      sources: [
        {
          id: sourceId,
          platform,
          population,
          sampled: true,
          complete: false,
          collectedAt: now,
        },
      ],
      observations,
      content,
      events: [],
      research: [],
    };

    const summary = this.buildSummary(dataset, platform, handle);
    return { dataset, summary };
  }

  /**
   * Builds an intuitive, high-level summary for the UI
   */
  private buildSummary(dataset: AudienceDatasetV1, platform: SocialPlatform, handle: string, _region?: string): SocialAudienceSummary {
    const source = dataset.sources[0];
    const observations = dataset.observations.filter((o) => o.sourceRef === source?.id && o.status === 'observed' && o.value !== null);
    const total = observations.find((o) => ['followers_count','audience_size','follower_count'].includes(o.metric) && o.unit === 'count')?.value ?? null;
    const distribution = (dimension: string): Record<string, number> => {
      const result: Record<string, number> = {};
      for (const observation of observations) {
        const key = observation.dimensions[dimension];
        if (!key) continue;
        const denominator = observation.denominatorRef ? observations.find((o) => o.id === observation.denominatorRef)?.value : null;
        const value = observation.unit === 'percent' ? observation.value!
          : denominator && denominator > 0 ? observation.value! / denominator * 100 : null;
        if (value !== null) result[key] = Math.round(((result[key] || 0) + value) * 100) / 100;
      }
      return result;
    };
    const gender = distribution('gender');
    const age = distribution('age');
    const cities = distribution('city');
    const kind = dataset.synthetic ? 'synthetic-demo' : dataset.sources.every((s) => s.population === 'declared-research') ? 'declared-research' : 'source-data';
    return {
      platform, handle, totalAudience: total, population: source?.population || 'declared-research',
      metrics:{contentCount:dataset.content.length,eventCount:dataset.events.length,researchCount:dataset.research.length,observationCount:observations.length,sourceCount:dataset.sources.length},
      provenance: { kind, notices: ['Bilinmeyen demografi alanları tahmin edilmez.', ...(kind === 'source-data' ? ['Kaynak verisi; tüm alanların bağımsız doğrulaması değildir.'] : [])] },
      demographics: { gender: { male: gender.M ?? gender.male ?? null, female: gender.F ?? gender.female ?? null },
        topAgeGroup: Object.keys(age).sort((a,b) => age[b] - age[a])[0] || null,
        ageDistribution: age, topCities: Object.entries(cities).map(([city, percentage]) => ({ city, percentage })).sort((a,b) => b.percentage-a.percentage) },
      recentPosts: dataset.content.slice(0, 5).map((c) => ({ id: c.id, text: c.text, likes: c.likes, comments: c.comments, date: c.publishedAt, themes: c.themeTags })),
      identifiedInterests: [...new Set(dataset.content.flatMap((c) => c.themeTags))],
    };
  }

  private normalizeRawExport(raw: any): AudienceDatasetV1 {
    const now = new Date().toISOString();
    const from = new Date(Date.now() - 30 * 86400000).toISOString();
    return {
      schemaVersion: 1,
      label: raw.label || 'Imported Audience Dataset',
      synthetic: Boolean(raw.synthetic),
      asOf: raw.asOf || now,
      window: raw.window || { from, to: now },
      brand: raw.brand || { name: 'Imported Brand', category: 'other', language: 'tr', description: '' },
      products: raw.products || [],
      sources: raw.sources || [{ id: 'src-1', platform: 'custom', population: 'engaged-audience', sampled: true, complete: false, collectedAt: now }],
      observations: raw.observations || [],
      content: raw.content || [],
      events: raw.events || [],
      research: raw.research || [],
    };
  }

  /**
   * Creates a dataset for a newly planned product or idea test based on creator hypothesis.
   */
  createCustomProductDataset(params: CreateCustomProductParams): {
    dataset: AudienceDatasetV1;
    summary: SocialAudienceSummary;
  } {
    const now = new Date().toISOString();
    const from = new Date(Date.now() - 30 * 86400000).toISOString();
    const sourceId = 'src-product-brief';
    const prodId = 'prod-custom-1';

    const validCategory = (['personal-brand', 'software', 'coffee', 'furniture', 'creator', 'other'] as const).includes(params.category as any)
      ? (params.category as any)
      : 'software';

    const rawFacts = (params.facts || [])
      .map((f) => f.trim())
      .filter(Boolean)
      .slice(0, 30);

    const facts = rawFacts.length > 0
      ? rawFacts
      : [`${params.productName} için planlanan temel işlev ve değer vaadi.`];

    if (params.motivations && params.motivations.length > 0) {
      facts.push(`Hedef kitle birincil motivasyonları: ${params.motivations.join(', ')}.`);
    }
    if (params.objections && params.objections.length > 0) {
      facts.push(`Hedef kitle temel çekinceleri ve itirazları: ${params.objections.join(', ')}.`);
    }
    if (params.topics && params.topics.length > 0) {
      facts.push(`Odaklanılan ilgi alanları ve teknolojiler: ${params.topics.join(', ')}.`);
    }

    const research: AudienceDatasetV1['research'] = [];
    if (params.targetAudienceHypothesis && params.targetAudienceHypothesis.trim()) {
      research.push({
        id: 'res-hypothesis-1',
        sourceRef: sourceId,
        statement: `Hedef Kitle Hipotezi: ${params.targetAudienceHypothesis.trim()}`,
        theme: 'audience-hypothesis',
        sampleSize: null,
      });
    }

    if (params.motivations && params.motivations.length > 0) {
      research.push({
        id: 'res-motivations-1',
        sourceRef: sourceId,
        statement: `Birincil Motivasyonlar: ${params.motivations.join(', ')}`,
        theme: 'audience-motivations',
        sampleSize: null,
      });
    }

    if (params.objections && params.objections.length > 0) {
      research.push({
        id: 'res-objections-1',
        sourceRef: sourceId,
        statement: `Temel Çekinceler ve İtirazlar: ${params.objections.join(', ')}`,
        theme: 'audience-objections',
        sampleSize: null,
      });
    }

    if (params.topics && params.topics.length > 0) {
      research.push({
        id: 'res-topics-1',
        sourceRef: sourceId,
        statement: `İlgi Alanları ve Konular: ${params.topics.join(', ')}`,
        theme: 'audience-topics',
        sampleSize: null,
      });
    }

    if (params.knowledgeLevel) {
      research.push({
        id: 'res-knowledge-1',
        sourceRef: sourceId,
        statement: `Kullanıcı Bilgi Seviyesi: ${params.knowledgeLevel} | Coğrafya: ${params.region || 'Global'} | Yaş Aralığı: ${params.ageRange || '18-45'}`,
        theme: 'audience-profile',
        sampleSize: null,
      });
    }

    if (params.userProfile && params.userProfile.trim()) {
      research.push({
        id: 'res-profile-1',
        sourceRef: sourceId,
        statement: `Kullanıcı Rolü ve Segment: ${params.userProfile.trim()}`,
        theme: 'audience-role',
        sampleSize: null,
      });
    }

    if (params.decisionCriteria && params.decisionCriteria.length > 0) {
      research.push({
        id: 'res-criteria-1',
        sourceRef: sourceId,
        statement: `Karar Kriterleri: ${params.decisionCriteria.join(', ')}`,
        theme: 'audience-decision',
        sampleSize: null,
      });
    }

    const content: AudienceDatasetV1['content'] = (params.samplePosts || [])
      .map((post) => post.trim())
      .filter(Boolean)
      .slice(0, 10)
      .map((text, i) => ({
        id: `post-brief-${i + 1}`,
        sourceRef: sourceId,
        productRefs: [prodId],
        text,
        publishedAt: now,
        likes: null,
        comments: null,
        themeTags: [validCategory],
      }));

    const dataset: AudienceDatasetV1 = {
      schemaVersion: 1,
      label: `${params.productName} — Planlanan Ürün & Kitle Testi`,
      synthetic: false,
      asOf: now,
      window: { from, to: now },
      brand: {
        name: params.brandName?.trim() || params.productName.trim(),
        category: validCategory,
        language: 'tr',
        description: params.description?.trim() || `${params.productName} için planlanan ürün ve hedef kitle beyanı.`,
      },
      products: [
        {
          id: prodId,
          name: params.productName.trim(),
          category: validCategory,
          facts: facts.map((text, i) => ({
            id: `f${i + 1}`,
            text,
          })),
          price: params.price ? { amountMinor: Math.round(params.price * 100), currency: 'TRY' } : null,
        },
      ],
      sources: [
        {
          id: sourceId,
          platform: 'custom',
          population: 'declared-research',
          sampled: true,
          complete: false,
          collectedAt: now,
        },
      ],
      observations: [],
      content,
      events: [],
      research,
    };

    const parsed = parseAudienceDataset(dataset);
    const summary = this.buildSummary(parsed, 'custom', params.brandName || params.productName, params.region);
    return { dataset: parsed, summary };
  }

  /**
   * Merges audience data from multiple active real sources (Instagram, X, Web Pixel).
   */
  appendPixelEvents(input: AudienceDatasetV1, events: Array<{ id: string; eventName: string; timestamp: string; anonymousId: string; synthetic: boolean }>) {
    const dataset: AudienceDatasetV1 = JSON.parse(JSON.stringify(parseAudienceDataset(input)));
    const now = new Date().toISOString();
    const known = new Set(dataset.events.map((e) => e.id));
    const allowed = ['page_view','cta_click','scroll_depth','time_on_page','product_view','pricing_view','integration_docs_view','trial_requested','add_to_cart','checkout_started'];
    for (const event of events) {
      if (known.has(event.id) || !allowed.includes(event.eventName)) continue;
      const sourceRef = event.synthetic ? 'src-pixel-demo' : 'src-pixel-collected';
      if (!dataset.sources.some((s) => s.id === sourceRef)) dataset.sources.push({ id: sourceRef, platform:'custom', population:'site-visitors', sampled:true, complete:false, collectedAt:now });
      dataset.events.push({ id:event.id, sourceRef, profileRef:event.anonymousId, name:event.eventName as AudienceDatasetV1['events'][number]['name'], productRef:dataset.products[0].id, eventTime:event.timestamp, receivedAt:now });
      known.add(event.id);
      if (event.synthetic) dataset.synthetic = true;
    }
    dataset.asOf = now; dataset.window.to = now;
    const parsed = parseAudienceDataset(dataset);
    const summary = this.buildSummary(parsed, 'custom', dataset.brand.name);
    summary.provenance.notices.push(`${events.filter((e) => e.synthetic).length} sentetik demo olayı eklendi; gerçek davranış kanıtı değildir.`);
    return { dataset:parsed, summary };
  }

  async ingestMultiSourceAudience(params: MultiSourceParams): Promise<{
    dataset: AudienceDatasetV1;
    summary: SocialAudienceSummary;
  }> {
    let baseDataset: AudienceDatasetV1 | null = params.dataset ? parseAudienceDataset(params.dataset) : null;
    const sourcesSummary: string[] = [];

    // 1. Ingest Instagram if provided
    if (params.instagram && params.instagram.handle && params.instagram.handle.trim()) {
      const igResult = await this.ingestSocialAudience({
        platform: 'instagram',
        handle: params.instagram.handle,
        accessToken: params.instagram.accessToken,
        population: params.instagram.population || 'engaged-audience',
      });
      baseDataset = igResult.dataset;
      sourcesSummary.push(`Instagram (@${params.instagram.handle.replace(/^@/, '')})`);
    }

    // 2. Ingest X if provided
    if (params.x && params.x.handle && params.x.handle.trim()) {
      const xResult = await this.ingestSocialAudience({
        platform: 'x',
        handle: params.x.handle,
        accessToken: params.x.accessToken,
        population: params.x.population || 'engaged-audience',
      });

      if (!baseDataset) {
        baseDataset = xResult.dataset;
      } else {
        const xSourceId = xResult.dataset.sources[0]?.id || 'src-x-merged';
        if (!baseDataset.sources.some((s) => s.id === xSourceId)) {
          baseDataset.sources.push(...xResult.dataset.sources);
        }

        const existingContentIds = new Set(baseDataset.content.map((c) => c.id));
        for (const c of xResult.dataset.content) {
          if (!existingContentIds.has(c.id)) {
            baseDataset.content.push({
              ...c,
              productRefs: baseDataset.products.map((p) => p.id),
            });
          }
        }
      }
      sourcesSummary.push(`X (@${params.x.handle.replace(/^@/, '')})`);
    }

    // A pixel-only connection needs a brief, not a fabricated social connection.
    if (!baseDataset) {
      if (!params.includePixel || !params.pixelEvents?.length) throw new Error('SOCIAL_SOURCE_REQUIRED');
      baseDataset=this.createCustomProductDataset({productName:'Web deneyimi',category:'other',facts:['Ürün ve görev bilgisi kullanıcı briefinde belirtilebilir.']}).dataset;
    }

    // 4. Incorporate live Web Pixel events if requested
    if (params.includePixel && Array.isArray(params.pixelEvents) && params.pixelEvents.length > 0) {
      baseDataset=this.appendPixelEvents(baseDataset,params.pixelEvents.map(e=>({id:e.id,eventName:e.eventName,
        anonymousId:e.anonymousId||'anon',timestamp:e.timestamp||new Date().toISOString(),synthetic:e.synthetic===true}))).dataset;
      sourcesSummary.push(`Web Pixel (${params.pixelEvents.length} hareket)`);
    }

    const mergedNow = new Date().toISOString();
    baseDataset.asOf = mergedNow;
    baseDataset.window.to = mergedNow;
    for (const s of baseDataset.sources) {
      if (s.collectedAt > mergedNow) {
        s.collectedAt = mergedNow;
      }
    }

    baseDataset.label = `Birleşik Kitle · ${sourcesSummary.join(' + ')}`;
    const parsed = parseAudienceDataset(baseDataset);
    const summary = this.buildSummary(parsed, 'custom', sourcesSummary.join(' + '));
    return { dataset: parsed, summary };
  }
}
