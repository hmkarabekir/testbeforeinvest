#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { AudienceLabOrchestrator } from './orchestrator.js';
import { AudienceLabEngine } from './inference/index.js';
import type { AudienceDatasetV1, CreativeVariantV1 } from './core/types.js';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'demo';

  const engine = new AudienceLabEngine();
  const orchestrator = new AudienceLabOrchestrator(engine);
  const config = engine.configuration();

  console.log(`\n======================================================`);
  console.log(`  OCTOPIQ AUDIENCE AGENT LAB — STANDALONE CLI`);
  console.log(`  Engine: ${config.provider} (${config.model})`);
  console.log(`======================================================\n`);

  if (command === '--help' || command === '-h' || command === 'help') {
    console.log(`Usage:`);
    console.log(`  audience-lab demo               Run live Linus vs. İlber story demo`);
    console.log(`  audience-lab derive <dataset>   Derive Variant B from Variant A`);
    console.log(`  audience-lab run <dataset>      Run experiment on provided dataset\n`);
    process.exit(0);
  }

  if (command === 'demo') {
    console.log(`Running Live Demo: "Linus Torvalds vs. İlber Ortaylı" Story A/B Test...\n`);

    const now = new Date().toISOString();
    const from = new Date(Date.now() - 30 * 86400000).toISOString();

    // 1. Build Creator Dataset
    const dataset: AudienceDatasetV1 = {
      schemaVersion: 1,
      label: 'AI & Developer Creator Brand',
      synthetic: true,
      asOf: now,
      window: { from, to: now },
      brand: {
        name: 'DevBuilder Studio',
        category: 'personal-brand',
        language: 'tr',
        description: 'Yazılım mimarisi, AI agent sistemleri ve indie hacking rehberleri paylaşan içerik üreticisi.',
      },
      products: [
        {
          id: 'prod-1',
          name: 'Agentic Coding Rehberi',
          category: 'yazılım rehberi',
          facts: [
            { id: 'f1', text: '18 izole sanal kimlikle reklam ve içerik ön testi sunar.' },
            { id: 'f2', text: 'Tamamen açık kaynak kodlu TypeScript ve NestJS/Next.js mimarisi.' },
            { id: 'f3', text: 'Codex CLI GPT-6 Luna veya offline kural motoruyla çalışır.' },
          ],
          price: null,
        },
      ],
      sources: [{ id: 's1', platform: 'instagram', population: 'engaged-audience', sampled: true, complete: false, collectedAt: now }],
      observations: [],
      content: [],
      events: [],
      research: [],
    };

    // 2. Define Story A (Linus Torvalds Meme / Engineer Hook)
    const variantA: CreativeVariantV1 = {
      id: 'story-linus-a',
      version: 1,
      productId: 'prod-1',
      platform: 'instagram',
      format: 'story',
      headline: 'Talk is cheap, show me the code',
      body: 'Pazarlama laflarını bırak. 18 izole yapay zeka ajanıyla reklam ve içeriklerini yayına almadan test et. Kodlar açık kaynak.',
      callToAction: 'Kodu İncele ⚡',
      testedVariable: 'hook',
      productFactRefs: ['f1', 'f2'],
      assumptions: [],
      generation: 'manual',
      productClaims: [],
      claimValidation: 'supported',
      contentHash: '',
      visualDescription: 'Linus Torvalds terminal başında C kodu incelerken, arka planda Linux pengueni ve kod satırları var.',
    };

    // 3. Define Story B (İlber Ortaylı Quote / Intellectual Depth Hook)
    const variantB: CreativeVariantV1 = {
      id: 'story-ilber-b',
      version: 1,
      productId: 'prod-1',
      platform: 'instagram',
      format: 'story',
      headline: 'Cahil kalmayın, mimariyi öğrenin',
      body: 'Günübirlik trendler yerine sağlam yazılım mimarisi kurun. 18 izole sanal kimlikle kitle psikolojisini analitik olarak analiz edin.',
      callToAction: 'Rehberi Oku 📚',
      testedVariable: 'hook',
      productFactRefs: ['f1', 'f2'],
      assumptions: [],
      generation: 'manual',
      productClaims: [],
      claimValidation: 'supported',
      contentHash: '',
      visualDescription: 'İlber Ortaylı devasa bir kütüphanede elinde antika kitapla derin düşüncelere dalmış halde kameraya bakıyor.',
    };

    console.log(`[Varyant A - Story]:`);
    console.log(`  Görsel: ${variantA.visualDescription}`);
    console.log(`  Başlık: ${variantA.headline}`);
    console.log(`  Metin:  ${variantA.body}`);
    console.log(`  CTA:    ${variantA.callToAction}\n`);

    console.log(`[Varyant B - Story]:`);
    console.log(`  Görsel: ${variantB.visualDescription}`);
    console.log(`  Başlık: ${variantB.headline}`);
    console.log(`  Metin:  ${variantB.body}`);
    console.log(`  CTA:    ${variantB.callToAction}\n`);

    console.log(`Deney 18 sanal kimlik üzerinden yürütülüyor (çift tekrar, counterbalancing)...\n`);
    const result = await orchestrator.runExperiment({
      dataset,
      variantA,
      variantB,
      repeats: 2,
    });

    console.log(`======================================================`);
    console.log(`  SONUÇ: KAZANAN VARYANT -> [${result.summary.winner.toUpperCase()}]`);
    console.log(`======================================================`);
    console.log(`  Oylar: A: ${result.summary.votes.a} | B: ${result.summary.votes.b} | Beraberlik: ${result.summary.votes.tie} | İkisi de Zayıf: ${result.summary.votes.neither}`);
    console.log(`  Ortalama Puan: A: ${result.summary.averageScores.a}/100 | B: ${result.summary.averageScores.b}/100\n`);

    console.log(`Segment Dağılımı ve Gerekçeler:`);
    for (const seg of result.segmentBreakdown) {
      console.log(`  • ${seg.personaTitle} -> Tercih: [${seg.winner.toUpperCase()}]`);
      console.log(`    Gerekçe: "${seg.pairExplanation}"`);
    }

    console.log(`\nDemo başarıyla tamamlandı!\n`);
  }
}

main().catch((err) => {
  console.error('CLI Error:', err);
  process.exit(1);
});
