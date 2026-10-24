import { createHash } from 'node:crypto';
import type { AudienceDatasetV1, CreativeVariantV1, ExperimentContext, InferenceImage } from './types.js';

const fail = (): never => { throw new Error('AUDIENCE_LAB_EXPERIMENT_INVALID'); };
const bounded = (value: unknown, max: number, fallback = '') => {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || value.length > max) return fail();
  return value.trim();
};
export function validateImages(value: unknown): InferenceImage[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 3) return fail();
  return value.map((image, index) => {
    if (!image || typeof image !== 'object' || !['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType)
      || typeof image.data !== 'string' || image.data.length > 2_800_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) return fail();
    const bytes = Buffer.from(image.data, 'base64');
    const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const webp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!bytes.length || bytes.length > 2 * 1024 * 1024 || !(image.mimeType === 'image/png' ? png : image.mimeType === 'image/jpeg' ? jpg : webp)) return fail();
    return { name: bounded(image.name, 160, `Görsel ${index + 1}`), mimeType: image.mimeType, data: image.data };
  });
}
export function experimentContext(value?: Partial<ExperimentContext>): ExperimentContext {
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) return fail();
  const objective = value?.objective ?? 'consideration';
  const surface = value?.surface ?? 'content';
  if (!['attention','consideration','click-intent','task-completion','clarity','trust'].includes(objective)
    || !['web','mobile','content','other'].includes(surface)) return fail();
  return { objective, surface, task: bounded(value?.task, 1000, 'Verilen iki seçeneği incelemek'),
    changedElement: bounded(value?.changedElement, 500, 'Bütün konsept') };
}
/** One boundary for browser forms, API clients, and model-generated candidates. */
export function normalizeExperimentVariant(raw: unknown, dataset: AudienceDatasetV1, side: 'a' | 'b'): CreativeVariantV1 {
  if (!raw || typeof raw !== 'object') return fail();
  const row = raw as Record<string, any>;
  const productId = row.productId ?? dataset.products[0]?.id;
  const product = dataset.products.find((p) => p.id === productId);
  if (!product) return fail();
  const format = row.format ?? 'text';
  const platform = row.platform ?? 'generic';
  if (!['text-ad','story','image-ad','html','text','screen','web-page','flow'].includes(format)
    || !['generic','instagram','facebook'].includes(platform)) return fail();
  const images = validateImages(row.images);
  const headline = bounded(row.headline, 150, side === 'a' ? 'Varyant A' : 'Varyant B');
  const body = bounded(row.body, 10000);
  const html = bounded(row.html, 20000, format === 'html' ? body : '');
  const visualDescription = bounded(row.visualDescription, 2000);
  if (!body && !html && !images.length && !visualDescription && !bounded(row.headline, 150)) return fail();
  if (['screen','flow','image-ad'].includes(format) && !images.length && !visualDescription) return fail();
  const refs = row.productFactRefs ?? product.facts.map((f) => f.id);
  if (!Array.isArray(refs) || refs.some((id) => typeof id !== 'string' || !product.facts.some((f) => f.id === id))) return fail();
  const result: CreativeVariantV1 = {
    id: bounded(row.id, 160, `variant-${side}`), version: 1, productId, platform, format,
    headline, body, callToAction: bounded(row.callToAction, 80),
    testedVariable: bounded(row.testedVariable, 100, 'bundle'), productFactRefs: refs,
    assumptions: Array.isArray(row.assumptions) ? row.assumptions.filter((x: unknown) => typeof x === 'string').slice(0, 20) : [],
    generation: row.generation === 'model' ? 'model' : 'manual',
    productClaims: [], claimValidation: 'supported', contentHash: '',
    ...(visualDescription ? { visualDescription } : {}), ...(html ? { html } : {}),
    ...(images.length ? { images } : {}),
    ...(row.referenceUrl ? { referenceUrl: bounded(row.referenceUrl, 2000) } : {}),
  };
  const { id: _id, generation: _generation, contentHash: _hash, ...content } = result;
  result.contentHash = createHash('sha256').update(JSON.stringify(content)).digest('hex');
  return result;
}
