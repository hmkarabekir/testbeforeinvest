import { createHash } from 'node:crypto';
import {
  parseAudienceDataset,
  type AudienceDatasetV1,
} from './dataset-contract.js';

/** Stable object keys; array order remains meaningful unless normalized explicitly. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`,
    )
    .join(',')}}`;
}
export const hashCanonical = (value: unknown): string =>
  createHash('sha256').update(stableStringify(value)).digest('hex');
export type LabEvidenceRecord = {
  id: string;
  kind: 'declared' | 'computed';
  text: string;
  sourceRef: string | null;
  synthetic: boolean;
};
export type NormalizedAudienceDataset = {
  schemaVersion: 1;
  dataset: AudienceDatasetV1;
  datasetHash: string;
  evidence: Record<string, LabEvidenceRecord>;
  populations: Array<{
    sourceRef: string;
    platform: string;
    population: AudienceDatasetV1['sources'][number]['population'];
    sampled: boolean;
    complete: boolean;
    observations: AudienceDatasetV1['observations'];
    profileCount: number;
    eventCounts: Partial<
      Record<AudienceDatasetV1['events'][number]['name'], number>
    >;
    contentCount: number;
  }>;
  summary: {
    products: number;
    content: number;
    profiles: number;
    events: number;
    observations: number;
    research: number;
    sources: number;
    missingDemographics: boolean;
  };
  limitations: string[];
};
const byId = <T extends { id: string }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => a.id.localeCompare(b.id, 'en'));

export function normalizeAudienceDataset(
  input: AudienceDatasetV1,
): NormalizedAudienceDataset {
  const parsed = parseAudienceDataset(input);
  const dataset: AudienceDatasetV1 = {
    ...parsed,
    products: byId(parsed.products).map((p) => ({
      ...p,
      facts: byId(p.facts),
    })),
    sources: byId(parsed.sources),
    observations: byId(parsed.observations),
    content: byId(parsed.content),
    events: byId(parsed.events),
    research: byId(parsed.research),
  };
  const evidence: Record<string, LabEvidenceRecord> = Object.create(null);
  const add = (
    id: string,
    text: string,
    sourceRef: string | null,
    kind: LabEvidenceRecord['kind'] = 'declared',
  ) => {
    evidence[id] = { id, text, sourceRef, kind, synthetic: dataset.synthetic };
  };
  add('brand:description', dataset.brand.description, null);
  for (const p of dataset.products) {
    add(`product:${p.id}`, p.name, null);
    for (const f of p.facts) add(`fact:${f.id}`, f.text, null);
  }
  for (const source of dataset.sources)
    add(
      `source:${source.id}`,
      `${source.platform}; ${source.population}; ${source.sampled ? 'örneklenmiş' : 'örnekleme bildirilmemiş'}`,
      source.id,
    );
  for (const row of dataset.content)
    add(`content:${row.id}`, row.text, row.sourceRef);
  for (const row of dataset.events)
    add(
      `event:${row.id}`,
      `${row.name}; ürün=${row.productRef}; zaman=${row.eventTime}`,
      row.sourceRef,
    );
  for (const row of dataset.research)
    add(`research:${row.id}`, row.statement, row.sourceRef);
  for (const row of dataset.observations)
    add(
      `observation:${row.id}`,
      `${row.metric}; ${stableStringify(row.dimensions)}; ${row.status}; ${row.value === null ? 'bilinmiyor' : row.value}; birim=${row.unit}`,
      row.sourceRef,
    );
  const populations = dataset.sources.map((source) => {
    const sourceEvents = dataset.events.filter(
      (e) => e.sourceRef === source.id,
    );
    const eventCounts: NormalizedAudienceDataset['populations'][number]['eventCounts'] =
      {};
    for (const event of sourceEvents)
      eventCounts[event.name] = (eventCounts[event.name] ?? 0) + 1;
    return {
      sourceRef: source.id,
      platform: source.platform,
      population: source.population,
      sampled: source.sampled,
      complete: source.complete,
      observations: dataset.observations.filter(
        (o) => o.sourceRef === source.id,
      ),
      profileCount: new Set(sourceEvents.map((e) => e.profileRef)).size,
      eventCounts,
      contentCount: dataset.content.filter((c) => c.sourceRef === source.id)
        .length,
    };
  });
  const missingDemographics = !dataset.observations.some(
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
    dataset,
    datasetHash: hashCanonical(dataset),
    evidence,
    populations,
    summary: {
      products: dataset.products.length,
      content: dataset.content.length,
      profiles: new Set(
        dataset.events.map((e) => `${e.sourceRef}:${e.profileRef}`),
      ).size,
      events: dataset.events.length,
      observations: dataset.observations.length,
      research: dataset.research.length,
      sources: dataset.sources.length,
      missingDemographics,
    },
    limitations: [
      'Farklı kaynakların profilleri veya sosyal kitleleri tekil kişi olarak birleştirilmedi.',
      'Demografik marjinaller birleştirilmedi; bastırılmış hücrelerden toplam veya ortak dağılım üretilmedi.',
      'Yüklenen kayıtlardaki olgular sağlayıcı veya sipariş doğrulaması sayılmaz; doğrulama sunucunun ayrı provenance metadata alanına aittir.',
      'Paylaşım beğeni ve yorumlarından erişim oranı, satış etkisi veya kişi motivasyonu hesaplanmadı.',
      ...(dataset.synthetic
        ? ['Bu veri paketindeki bütün kaynaklar ve olaylar sentetiktir.']
        : []),
      ...(missingDemographics
        ? ['Kullanılabilir demografik kırılım yok.']
        : []),
      ...(dataset.sources.some((s) => s.sampled || !s.complete)
        ? [
            'En az bir kaynak örneklenmiş veya eksik; örnek tüm kitlenin temsili dağılımı değildir.',
          ]
        : []),
    ],
  };
}
