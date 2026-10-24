import { createHash, randomUUID } from 'node:crypto';
import {
  type Criterion,
  type CriterionScores,
  type SingleEvaluation,
  type PairEvaluation,
  rubricScore,
  CRITERIA,
} from '../core/evaluation-contract.js';
import type { InferenceResult, InferenceReceipt } from '../core/types.js';

export class LabInferenceError extends Error {
  constructor(public code: string, public receipt: any) {
    super(code);
  }
}

export type LabInferenceRequest = {
  task?: 'variant-generation' | 'single-evaluation' | 'pair-evaluation';
  system: string;
  prompt: string;
  maxOutputTokens?: number;
  requestId?: string;
};

export const LOCAL_RULES_MODEL = 'local-rules-v1';
type Row = Record<string, any>;
type Fact = { id: string; text: string };
type SingleOutput = Omit<
  SingleEvaluation,
  'agentId' | 'exposureId' | 'score' | 'creativeStatus'
>;
type PairOutput = Omit<
  PairEvaluation,
  | 'agentId'
  | 'exposureId'
  | 'leftVariantId'
  | 'rightVariantId'
  | 'preferredVariantId'
>;
const row = (v: unknown): v is Row =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
const lower = (s: string) =>
  s
    .normalize('NFKC')
    .toLocaleLowerCase('tr-TR')
    .replace(
      /[çğıöşü]/g,
      (c) => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' })[c]!,
    );
const STOP = new Set([
  'icin',
  'olan',
  'olarak',
  'gibi',
  'daha',
  'bunu',
  'bana',
  'bunun',
  'kendi',
  'kimlik',
  'kart',
  'senaryo',
  'verilen',
  'ilgili',
  'goster',
  'gostermek',
  'gormek',
  'incelemek',
  'anlamak',
  'istiyorum',
  'isteyen',
  'ihtiyac',
  'ihtiyaci',
  'yaklasim',
  'gercek',
  'somut',
  'acik',
  'mevcut',
  'metin',
  'reklam',
  'yontem',
  'etmek',
  'eder',
  'olmak',
  'nedir',
  'nasil',
  'urun',
  'urunler',
  'proje',
  'projeler',
]);
const tokens = (s: string) => [
  ...new Set(
    lower(s)
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4 && !STOP.has(t)),
  ),
];
const rootsMatch = (a: string, b: string) =>
  a === b ||
  (Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a)));
const CONCEPTS = [
  [
    'teknik',
    'mimari',
    'kod',
    'github',
    'api',
    'entegrasyon',
    'integration',
    'architecture',
    'repository',
    'benchmark',
    'acik kaynak',
  ],
  [
    'surec',
    'hikaye',
    'yolculuk',
    'deneyim',
    'denedim',
    'ders',
    'build in public',
    'story',
  ],
  [
    'sablon',
    'taktik',
    'rehber',
    'adim',
    'uygula',
    'template',
    'framework',
    'checklist',
  ],
  [
    'tartisma',
    'topluluk',
    'yorum',
    'sizce',
    'birlikte',
    'community',
    'diyalog',
  ],
  ['baslangic', 'ogren', 'temel', 'jargon', 'sifirdan', 'beginner'],
  ['zaman', 'verim', 'otomasyon', 'pratik', 'kolay', 'hizli', 'kurulum'],
  ['tat', 'aroma', 'asidite', 'kahve', 'coffee', 'cekirdek'],
  ['ogutum', 'demleme', 'ekipman', 'espresso', 'filtre'],
  ['koken', 'ciftlik', 'hasat', 'izlenebilir'],
  ['olcu', 'boyut', 'alan', 'sigar', 'yerlesim', 'mekan'],
  ['malzeme', 'dayanik', 'masif', 'kaplama', 'ahsap'],
  ['teslimat', 'kargo', 'montaj', 'nakliye'],
  ['fiyat', 'butce', 'maliyet', 'ucret', 'odeme', 'abonelik'],
  ['tasarim', 'renk', 'stil', 'estetik'],
  ['kanit', 'abarti', 'sinir', 'trade off', 'seffaf', 'hype', 'suphe'],
];
function matchStrength(focus: string, copy: string) {
  const focusTokens = tokens(focus),
    copyTokens = tokens(copy);
  const matchedTokens = focusTokens.filter((f) =>
    copyTokens.some((c) => rootsMatch(f, c)),
  );
  const concepts = CONCEPTS.filter((terms) =>
    terms.some((term) => lower(focus).includes(term)),
  );
  const matchedConcepts = concepts.filter((terms) =>
    terms.some((term) => lower(copy).includes(term)),
  );
  return {
    hits: matchedTokens.length,
    total: focusTokens.length,
    concepts: matchedConcepts.length,
    conceptTotal: concepts.length,
  };
}
const excerpt = (text: string, preferred?: string) =>
  (preferred && text.includes(preferred)
    ? preferred
    : text.split(/\r?\n/).find((s) => s.trim()) || text
  ).slice(0, 480);
const factsIn = (payload: Row): Fact[] =>
  (Array.isArray(payload.productFacts) ? payload.productFacts : []).filter(
    (f: unknown) =>
      row(f) && typeof f.id === 'string' && typeof f.text === 'string',
  );
const clamp = (n: number) => Math.min(4, Math.max(0, Math.round(n)));

/** Transparent lexical and feature rules. No trained model, human forecast or network request. */
export class LocalAgentEvaluator {
  infer(request: LabInferenceRequest): InferenceResult {
    const started = performance.now(),
      task = request.task || 'single-evaluation';
    const receipt: InferenceReceipt = {
      provider: 'local-rules',
      requestedModel: LOCAL_RULES_MODEL,
      returnedModel: LOCAL_RULES_MODEL,
      requestId: request.requestId || randomUUID(),
      providerRequestId: null,
      responseId: null,
      task,
      promptVersion: 'audience-lab-prompts-1',
      schemaVersion: 1,
      inputHash: createHash('sha256')
        .update(
          JSON.stringify({
            task,
            system: request.system,
            prompt: request.prompt,
          }),
        )
        .digest('hex'),
      latencyMs: 0,
      dispatchState: 'not-dispatched',
      outcome: 'rejected',
      httpStatus: null,
      usage: null,
      usageState: 'missing',
      cost: {
        state: 'not-billed',
        reason: 'local-rules-execution',
        providerChargeNanoUsd: 0,
        currency: 'USD',
        invoice: false,
      },
    };
    try {
      if (
        ![
          'single-evaluation',
          'pair-evaluation',
          'variant-generation',
        ].includes(task) ||
        !str(request.system).trim() ||
        request.system.length > 16000 ||
        !str(request.prompt).trim() ||
        request.prompt.length > 64000 ||
        (request.maxOutputTokens !== undefined &&
          (!Number.isInteger(request.maxOutputTokens) ||
            request.maxOutputTokens < 128 ||
            request.maxOutputTokens > 4096)) ||
        (request.requestId !== undefined &&
          !/^[A-Za-z0-9._:-]{1,200}$/.test(request.requestId))
      )
        throw new Error('input');
      const payload: unknown = JSON.parse(request.prompt);
      if (!row(payload)) throw new Error('input');
      const value =
        task === 'variant-generation'
          ? this.generateVariants(payload)
          : task === 'pair-evaluation'
            ? this.evaluatePair(payload)
            : this.evaluateSingle(payload);
      return {
        value,
        receipt: {
          ...receipt,
          outcome: 'completed',
          latencyMs: Math.max(0, Math.round(performance.now() - started)),
        },
      };
    } catch {
      throw new LabInferenceError('AUDIENCE_LAB_INFERENCE_INPUT_INVALID', {
        ...receipt,
        latencyMs: Math.max(0, Math.round(performance.now() - started)),
      });
    }
  }

  generateVariants(payload: Row) {
    const product = row(payload.product) ? payload.product : {},
      facts = factsIn(payload).length
        ? factsIn(payload)
        : ((Array.isArray(product.facts) ? product.facts : []) as Fact[]);
    if (
      !str(product.id) ||
      !str(product.name) ||
      !facts.length ||
      facts.some((f) => !str(f.id) || !str(f.text))
    )
      throw new Error('AUDIENCE_LAB_INFERENCE_INPUT_INVALID');
    const variable = str(payload.testedVariable) || 'hook';
    if (payload.sourceVariantA || payload.variantA)
      return this.deriveVariantBFromA(
        payload.sourceVariantA || payload.variantA,
        facts,
        variable,
        payload.angle || 'contrarian',
      );
    const selected: Fact[] = [];
    let length = 0;
    for (const fact of facts) {
      if (length + fact.text.length + 1 <= 2000 && selected.length < 2) {
        selected.push(fact);
        length += fact.text.length + 1;
      }
    }
    if (!selected.length)
      throw new Error('AUDIENCE_LAB_INFERENCE_INPUT_INVALID');
    const a = {
      productId: product.id,
      platform: payload.platform || 'instagram',
      format: 'text-ad',
      headline: str(product.name).slice(0, 150),
      body: selected.map((f) => f.text).join(' '),
      callToAction: 'Ayrıntıları incele',
      testedVariable: variable,
      productFactRefs: selected.map((f) => f.id),
      productClaims: selected.map((f) => ({ factRef: f.id, quote: f.text })),
      assumptions: [],
      generation: 'model',
    };
    const derived = this.deriveVariantBFromA(a, selected, variable, 'problem');
    return { ...derived, variants: [a, derived.variants[1]] };
  }

  deriveVariantBFromA(
    sourceA: Row,
    facts: Fact[],
    testedVariable: string,
    angle:
      | 'contrarian'
      | 'story'
      | 'concise'
      | 'problem'
      | 'actionable' = 'contrarian',
  ) {
    if (
      !row(sourceA) ||
      !str(sourceA.headline).trim() ||
      !str(sourceA.body).trim() ||
      !str(sourceA.callToAction).trim()
    )
      throw new Error('AUDIENCE_LAB_INFERENCE_INPUT_INVALID');
    const prefixes = {
      contrarian: 'Başka bir yol mümkün mü?',
      story: 'Bu yaklaşımın arkasındaki süreç:',
      concise: 'Kısaca:',
      problem: 'Çözmek istediğin sorun bu mu?',
      actionable: 'Nasıl uygulanır?',
    };
    if (
      !Object.hasOwn(prefixes, angle) ||
      !['hook', 'need-frame', 'proof', 'cta', 'length', 'bundle'].includes(
        testedVariable,
      )
    )
      throw new Error('AUDIENCE_LAB_INFERENCE_INPUT_INVALID');
    const text = [sourceA.headline, sourceA.body, sourceA.callToAction].join(
      '\n',
    );
    const known = facts.filter((f) => text.includes(f.text));
    const refs = strings(sourceA.productFactRefs);
    const claims = Array.isArray(sourceA.productClaims)
      ? sourceA.productClaims
      : known.map((f) => ({ factRef: f.id, quote: f.text }));
    const a = {
      productId: sourceA.productId,
      platform: sourceA.platform || 'instagram',
      format: 'text-ad',
      headline: sourceA.headline,
      body: sourceA.body,
      callToAction: sourceA.callToAction,
      testedVariable,
      productFactRefs: Array.isArray(sourceA.productFactRefs)
        ? refs
        : known.map((f) => f.id),
      productClaims: claims,
      assumptions: strings(sourceA.assumptions),
      generation: sourceA.generation || 'manual',
    };
    const b = {
      ...a,
      productFactRefs: [...a.productFactRefs],
      productClaims: [...a.productClaims],
      generation: 'model',
    };
    if (['hook', 'need-frame', 'bundle'].includes(testedVariable)) {
      const words = sourceA.headline.trim().split(/\s+/);
      b.headline = angle === 'concise'
        ? words.slice(0, Math.min(6, Math.max(1, words.length - 1))).join(' ')
        : `${prefixes[angle]} ${sourceA.headline}`.slice(0, 150);
    }
    if (testedVariable === 'cta' || testedVariable === 'bundle')
      b.callToAction =
        sourceA.callToAction === 'Bir soru sor'
          ? 'Ayrıntıları incele'
          : 'Bir soru sor';
    if (['need-frame', 'proof', 'length', 'bundle'].includes(testedVariable)) {
      const prefix =
        testedVariable === 'proof'
          ? 'Dayanak: '
          : angle === 'story'
            ? 'Yaklaşımın ayrıntıları: '
            : angle === 'actionable'
              ? 'Uygulamada: '
              : 'Özet: ';
      const essential = known.map((f) => f.text).join(' ');
      const base =
        (testedVariable === 'length' || angle === 'concise') &&
        essential &&
        essential.length < sourceA.body.length
          ? essential
          : sourceA.body;
      b.body = angle === 'concise' && base !== sourceA.body
        ? base
        : prefix.length + base.length <= 2000 ? prefix + base : base;
    }
    if (a.headline === b.headline && a.body === b.body && a.callToAction === b.callToAction)
      throw new Error('AUDIENCE_LAB_DERIVATION_NO_CHANGE');
    // A remains byte-for-byte identical. B changes framing, never invents a founder story, price or outcome.
    return {
      schemaVersion: 1,
      variants: [a, b],
      changedElement: testedVariable,
    };
  }

  private claims(payload: Row) {
    const persona = row(payload.persona) ? payload.persona : {},
      identity = row(payload.identity) ? payload.identity : {};
    const allowed = strings(identity.knowledgeClaimIds);
    const claims: Row[] = ['observedFacts', 'derivedSignals', 'assumptions']
      .flatMap((key) =>
        Array.isArray(persona[key]) ? persona[key].filter(row) : [],
      )
      .filter(
        (c) =>
          typeof c.id === 'string' &&
          typeof c.text === 'string' &&
          allowed.includes(c.id),
      );
    return { persona, identity, claims, allowed };
  }
  private claimRefs(payload: Row, focus: string) {
    const { claims } = this.claims(payload);
    return claims
      .map((c) => ({
        id: c.id as string,
        strength: matchStrength(focus, c.text).hits,
      }))
      .sort((a, b) => b.strength - a.strength || a.id.localeCompare(b.id))
      .slice(0, 2)
      .map((c) => c.id);
  }
  evaluateSingle(payload: Row): SingleOutput {
    const text = str(payload.creative?.text);
    if (!text.trim() || text.length > 2400)
      throw new Error('AUDIENCE_LAB_INFERENCE_INPUT_INVALID');
    const { persona, identity, claims } = this.claims(payload);
    const lines = text.split(/\r?\n/).filter((s) => s.trim()),
      headline = lines[0] || text,
      body = lines.slice(1, -1).join('\n') || headline,
      cta = lines.at(-1) || text;
    const needs = strings(persona.needs).join(' '),
      objections = strings(persona.objections).join(' ');
    const focus = needs || str(persona.title),
      need = matchStrength(focus, text),
      objection = matchStrength(objections, text);
    const facts = factsIn(payload),
      matchedFacts = facts.filter((f) => text.includes(f.text));
    const copyWithoutFacts = matchedFacts.reduce(
      (s, f) => s.split(f.text).join(' '),
      text,
    );
    const unsupported =
      copyWithoutFacts.match(
        /(?:%\s*\d+|\d+\s*%|\d+\s*(?:TL|USD|EUR|dakika|saniye|saat|gün|kat)|ücretsiz|garantili|kesin sonuç|garanti eder|en iyi|en ucuz|sıfır risk|risksiz|kusursuz|mucize)/giu,
      ) || [];
    const hype =
      /(?:herkes|kesinlikle|inanılmaz|devrim|asla|mutlaka|\bviral\b)/iu.test(
        copyWithoutFacts,
      );
    const scenario = row(identity.scenario) ? identity.scenario : {},
      objective = payload.exposure?.objective || 'consideration';
    const missing = !claims.length || !focus.trim();
    const relevant = need.hits > 0 || need.concepts > 0;
    const criterionScores: CriterionScores = {
      relevance: clamp(
        missing
          ? 0
          : !relevant
            ? 0
            : need.hits >= 3 || need.concepts >= 2
              ? 4
              : need.hits >= 1
                ? 3
                : 2,
      ),
      credibility: clamp(
        unsupported.length
          ? scenario.skepticism === 'high'
            ? 0
            : 1
          : matchedFacts.length
            ? hype
              ? 2
              : 4
            : hype
              ? 1
              : 2,
      ),
      clarity: clamp(
        lines.length >= 3 && headline.length <= 150 && body.length >= 15
          ? text.length > 1200
            ? 2
            : 3
          : text.length < 20
            ? 1
            : 2,
      ),
      objectionResolution: clamp(
        !objections
          ? 1
          : objection.hits || objection.concepts
            ? matchedFacts.length
              ? 3
              : 2
            : 0,
      ),
      attention: clamp(
        scenario.attention === 'brief'
          ? headline.length <= 80 && text.length <= 500
            ? 4
            : text.length > 1000
              ? 1
              : 2
          : scenario.attention === 'deliberate'
            ? matchedFacts.length && body.length >= 80
              ? 4
              : body.length >= 40
                ? 3
                : 1
            : headline.length <= 110
              ? 3
              : 2,
      ),
      ctaFit: clamp(
        cta.length > 80 || cta.length < 3
          ? 1
          : /satın al|hemen al|ödeme yap/iu.test(cta) &&
              (scenario.skepticism === 'high' || objective !== 'click-intent')
            ? 1
            : /sor|yorum|incele|öğren|gör|dene|katıl|keşfet|bak/iu.test(cta)
              ? 3
              : 2,
      ),
    };
    const refs = (focusText: string) => this.claimRefs(payload, focusText);
    const explanations: Record<Criterion, string> = {
      relevance: missing
        ? 'Kimliğin ihtiyaç ve kaynaklı bilgisi eksik; yerel kurallar bu eşleşmeyi değerlendiremiyor.'
        : relevant
          ? `İhtiyaç metniyle ${need.hits} kelime/kök ve ${need.concepts} konu grubu eşleşti. Bu dilsel eşleşme gerçek tercih ölçümü değildir.`
          : `Bu kimliğin ihtiyacı (${focus.slice(0, 160)}) metinde açık bir dilsel eşleşme bulmadı.`,
      credibility: unsupported.length
        ? 'Kaynaklı ürün cümlelerinin dışında sayısal veya kesin vaat bulundu; doğrulanması gerekiyor.'
        : matchedFacts.length
          ? `${matchedFacts.length} izinli ürün cümlesi metinde birebir var. Kural motoru bunların dışındaki bütün anlamı doğrulayamaz.`
          : 'İzinli ürün bilgilerinden birebir dayanak bulunamadı; yerel kurallar güvenilirliği kesinleştiremiyor.',
      clarity: `Başlık ${headline.length}, toplam metin ${text.length} karakter. Açıklık puanı metin yapısı ve uzunluk kurallarına dayanıyor.`,
      objectionResolution:
        objection.hits || objection.concepts
          ? 'Kimliğin itirazıyla ilgili kelimeler var. Bu, itirazın anlam bakımından tamamen çözüldüğünün kanıtı değildir.'
          : `İtiraz (${objections.slice(0, 160) || 'bilinmiyor'}) için doğrudan metin eşleşmesi yok.`,
      attention: `${scenario.attention === 'brief' ? 'Kısa dikkat' : scenario.attention === 'deliberate' ? 'Ayrıntılı inceleme' : 'Normal dikkat'} senaryosunda metin uzunluğu ve mevcut somut dayanaklar kullanıldı.`,
      ctaFit: `Eylem çağrısı ${objective} hedefi ve ${scenario.skepticism || 'medium'} şüphecilik varsayımıyla kurallı olarak karşılaştırıldı.`,
    };
    const excerpts: Record<Criterion, string> = {
      relevance: excerpt(text, headline),
      credibility: excerpt(text, matchedFacts[0]?.text || body),
      clarity: excerpt(text, headline),
      objectionResolution: excerpt(text, body),
      attention: excerpt(text, headline),
      ctaFit: excerpt(text, cta),
    };
    const score = rubricScore(criterionScores);
    return {
      schemaVersion: 1,
      criterionScores,
      reasons: CRITERIA.map((criterion) => ({
        criterion,
        personaClaimIds: refs(
          criterion === 'objectionResolution' ? objections : focus,
        ),
        creativeExcerpt: excerpts[criterion],
        explanation: explanations[criterion],
      })),
      intendedAction: missing
        ? 'insufficient_context'
        : unsupported.length
          ? 'ask_question'
          : !relevant
            ? 'skip'
            : criterionScores.objectionResolution === 0
              ? 'ask_question'
              : score >= 70 && criterionScores.ctaFit >= 3
                ? 'click'
                : 'inspect',
      unansweredQuestions: missing
        ? ['Bu kimliğin ihtiyacı ve dayanakları nedir?']
        : criterionScores.objectionResolution === 0 && objections
          ? [objections.slice(0, 650)]
          : [],
      unsupportedClaims: [...new Set(unsupported)].slice(0, 10),
    };
  }
  evaluatePair(payload: Row): PairOutput {
    const leftText = str(payload.left?.text),
      rightText = str(payload.right?.text);
    if (!leftText.trim() || !rightText.trim())
      throw new Error('AUDIENCE_LAB_INFERENCE_INPUT_INVALID');
    const a = this.evaluateSingle({ ...payload, creative: { text: leftText } }),
      b = this.evaluateSingle({ ...payload, creative: { text: rightText } });
    const leftScore = rubricScore(a.criterionScores),
      rightScore = rubricScore(b.criterionScores),
      diff = leftScore - rightScore;
    let preference: PairEvaluation['preference'] = 'tie';
    let explanation =
      'Yerel özellik kuralları anlamlı bir fark bulmadı; insan tercihi ölçülmedi.';
    if (
      a.intendedAction === 'insufficient_context' ||
      b.intendedAction === 'insufficient_context'
    ) {
      preference = 'insufficient_context';
      explanation =
        'Kimliğin ihtiyacı veya dayanakları eksik; karşılaştırma yapılamıyor.';
    } else if (leftText === rightText) {
      preference = 'tie';
      explanation = 'İki metin birebir aynı; taraf konumu puana etki etmiyor.';
    } else if (
      (!a.criterionScores.relevance && !b.criterionScores.relevance) ||
      (a.unsupportedClaims.length && b.unsupportedClaims.length)
    ) {
      preference = 'neither';
      explanation =
        'İki seçenek de kimliğin ihtiyaç eşleşmesinde zayıf veya doğrulanmamış vaat içeriyor.';
    } else if (a.unsupportedClaims.length !== b.unsupportedClaims.length) {
      preference = a.unsupportedClaims.length ? 'right' : 'left';
      explanation =
        'Bir alternatifte izinli ürün gerçeklerinin dışında doğrulanmamış vaat bulundu.';
    } else if (Math.abs(diff) >= 4) {
      preference = diff > 0 ? 'left' : 'right';
      explanation = `İhtiyaç eşleşmesi, dayanak ve dikkat kurallarında ${Math.abs(diff).toFixed(1)} puan fark var. Sonuç bu kurgusal senaryodaki kural karşılaştırmasıdır.`;
    }
    return {
      schemaVersion: 1,
      preference,
      personaClaimIds: this.claimRefs(
        payload,
        strings(payload.persona?.needs).join(' '),
      ),
      leftExcerpt: excerpt(leftText),
      rightExcerpt: excerpt(rightText),
      explanation,
    };
  }
}
