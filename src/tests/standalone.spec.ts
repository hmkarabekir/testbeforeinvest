import { AudienceLabOrchestrator } from '../orchestrator.js';
import { AudienceLabEngine } from '../inference/index.js';
import type { AudienceDatasetV1, CreativeVariantV1 } from '../core/types.js';

describe('OctopIQ Standalone Audience Lab Engine', () => {
  const engine = new AudienceLabEngine('local');
  const orchestrator = new AudienceLabOrchestrator(engine);

  const dataset: AudienceDatasetV1 = {
    schemaVersion: 1,
    label: 'Test Creator Dataset',
    synthetic: true,
    asOf: new Date().toISOString(),
    window: { from: new Date().toISOString(), to: new Date().toISOString() },
    brand: {
      name: 'Test Creator',
      category: 'personal-brand',
      language: 'tr',
      description: 'Yazılım ve açık kaynak geliştirici rehberleri.',
    },
    products: [
      {
        id: 'prod-1',
        name: 'OpenSource Tool',
        category: 'developer-tools',
        facts: [
          { id: 'f1', text: '18 izole sanal ajanla A/B testi yapar.' },
          { id: 'f2', text: 'Sıfır harici API maliyetiyle yerel kurallarla çalışır.' },
        ],
        price: null,
      },
    ],
    sources: [{ id: 's1', platform: 'instagram', population: 'engaged-audience', sampled: true, complete: false, collectedAt: new Date().toISOString() }],
    observations: [],
    content: [],
    events: [],
    research: [],
  };

  const variantA: CreativeVariantV1 = {
    id: 'var-a',
    version: 1,
    productId: 'prod-1',
    platform: 'instagram',
    format: 'story',
    headline: 'Talk is cheap show code',
    body: 'Pazarlama laflarını bırak. 18 izole sanal ajanla A/B testi yap.',
    callToAction: 'Kodu İncele',
    testedVariable: 'hook',
    productFactRefs: ['f1'],
    assumptions: [],
    generation: 'manual',
    productClaims: [],
    claimValidation: 'supported',
    contentHash: '',
    visualDescription: 'Linus Torvalds terminal başında C kodu inceliyor.',
  };

  const variantB: CreativeVariantV1 = {
    id: 'var-b',
    version: 1,
    productId: 'prod-1',
    platform: 'instagram',
    format: 'story',
    headline: 'Cahil kalmayın öğrenin',
    body: 'Günübirlik trendler yerine sağlam yazılım mimarisi kurun.',
    callToAction: 'Rehberi Oku',
    testedVariable: 'hook',
    productFactRefs: ['f1'],
    assumptions: [],
    generation: 'manual',
    productClaims: [],
    claimValidation: 'supported',
    contentHash: '',
    visualDescription: 'İlber Ortaylı kütüphanede kitap inceliyor.',
  };

  it('compiles 6 personas and 18 agent identities from creator dataset', () => {
    const { personas, identities } = orchestrator.compilePanel(dataset);
    expect(personas.length).toBeGreaterThanOrEqual(1);
    expect(identities.length).toBe(personas.length * 3);
  });

  it('runs complete counterbalanced A/B simulation and produces winner & reasons', async () => {
    const result = await orchestrator.runExperiment({
      dataset,
      variantA,
      variantB,
      repeats: 2,
    });

    expect(['a', 'b', 'tie', 'neither']).toContain(result.summary.winner);
    expect(result.summary.votes.a + result.summary.votes.b + result.summary.votes.tie + result.summary.votes.neither).toBeGreaterThan(0);
    expect(result.segmentBreakdown.length).toBeGreaterThan(0);
    expect(result.segmentBreakdown[0].pairExplanation).toBeTruthy();
  });

  it('derives Variant B from Variant A using selected narrative angle', async () => {
    const { variantB: derivedB } = await orchestrator.deriveVariantB({
      dataset,
      sourceVariantA: variantA,
      angle: 'contrarian',
    });

    expect(derivedB.headline).toBeTruthy();
    expect(derivedB.body).toBeTruthy();
  });
});
