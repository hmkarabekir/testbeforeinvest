import {
  invalidLabInput,
  labArray,
  labEnum,
  labId,
  labRecord,
  labText,
  parseAudienceDataset,
  type AudienceDatasetV1,
  type CreativeVariantV1,
} from './dataset-contract.js';
import { hashCanonical } from './dataset-normalizer.js';

export const CREATIVE_TEST_VARIABLES = [
  'hook',
  'need-frame',
  'proof',
  'cta',
  'length',
  'bundle',
] as const;

/** Validates evidence claims, without requiring every word of original ad copy to quote a fact. */
export function parseCreativeVariant(
  raw: unknown,
  input: AudienceDatasetV1,
): CreativeVariantV1 {
  const dataset = parseAudienceDataset(input);
  const row = labRecord(
    raw,
    [
      'productId',
      'platform',
      'format',
      'headline',
      'body',
      'callToAction',
      'testedVariable',
      'productFactRefs',
      'assumptions',
      'generation',
    ],
    'variant',
    [
      'id',
      'version',
      'contentHash',
      'productClaims',
      'claimValidation',
      'mediaUrl',
      'visualDescription',
      'html',
    ],
  );
  const productId = labId(row.productId, 'variant.productId');
  const product = dataset.products.find((p) => p.id === productId);
  if (!product) return invalidLabInput('variant.productId', 'PRODUCT_INVALID');
  const facts = new Map(product.facts.map((f) => [f.id, f.text]));
  const productFactRefs = [
    ...new Set(
      labArray(row.productFactRefs, 'variant.productFactRefs', 30).map(
        (ref, i) => labId(ref, `variant.productFactRefs.${i}`),
      ),
    ),
  ].sort();
  if (productFactRefs.some((ref) => !facts.has(ref)))
    return invalidLabInput('variant.productFactRefs', 'PRODUCT_FACT_INVALID');
  const headline = labText(row.headline, 'variant.headline', 150),
    body = labText(row.body, 'variant.body', 2000),
    callToAction = labText(row.callToAction, 'variant.callToAction', 80);
  const creativeText = `${headline}\n${body}\n${callToAction}`;
  const productClaims = labArray(
    row.productClaims ?? [],
    'variant.productClaims',
    30,
  ).map((value, i) => {
    const path = `variant.productClaims.${i}`,
      claim = labRecord(value, ['factRef', 'quote'], path);
    const factRef = labId(claim.factRef, `${path}.factRef`),
      quote = labText(claim.quote, `${path}.quote`, 2000);
    const fact = facts.get(factRef);
    if (
      !fact ||
      !productFactRefs.includes(factRef) ||
      quote.length < Math.min(8, fact.length) ||
      !fact.includes(quote) ||
      !creativeText.includes(quote)
    )
      return invalidLabInput(path, 'FACT_QUOTE_INVALID');
    if (
      /\d|%|₺|\$|€|ücretsiz|garant|indirim|yok|değil|hariç|koşul|şart|sadece|yalnız/iu.test(
        fact,
      ) &&
      quote !== fact
    )
      return invalidLabInput(path, 'CONDITIONAL_FACT_REQUIRES_FULL_QUOTE');
    return { factRef, quote };
  });
  // Numeric and unconditional commercial promises require an exact supported passage.
  // This gate is deliberately conservative; review-required is a stop before a run,
  // never proof that free-form semantics have been fully verified by a regex.
  const supportedPassages = [
    ...productClaims.map((claim) => claim.quote),
    ...productFactRefs.map((ref) => facts.get(ref)!),
  ];
  const unsourcedText = supportedPassages
    .sort((a, b) => b.length - a.length)
    .reduce((copy, passage) => copy.split(passage).join(' '), creativeText);
  const sensitiveClaim =
    /\d|%|₺|\$|€|\b(?:USD|TRY|EUR|TL)\b|ücretsiz|indirimli|garantili|kesin sonuç|garanti eder|garanti ediyor|en ucuz|en iyi|sıfır risk|risksiz|anında sonuç|hemen sonuç/iu.test(
      unsourcedText,
    );
  const claimValidation: CreativeVariantV1['claimValidation'] = sensitiveClaim
    ? 'review-required'
    : 'supported';
  const version = row.version === undefined ? 1 : row.version;
  if (
    typeof version !== 'number' ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    version > 1000000
  )
    return invalidLabInput('variant.version', 'VERSION_INVALID');
  const content = {
    productId,
    platform: labEnum(
      row.platform,
      ['instagram', 'facebook', 'generic'],
      'variant.platform',
    ),
    format: labEnum(
      row.format,
      ['text-ad', 'story', 'image-ad', 'html', 'text', 'screen', 'web-page', 'flow'],
      'variant.format',
    ),
    headline,
    body,
    callToAction,
    testedVariable: labEnum(
      row.testedVariable,
      CREATIVE_TEST_VARIABLES,
      'variant.testedVariable',
    ),
    productFactRefs,
    assumptions: labArray(row.assumptions, 'variant.assumptions', 10).map(
      (a, i) => labText(a, `variant.assumptions.${i}`, 300),
    ),
    productClaims,
    ...(row.mediaUrl ? { mediaUrl: labText(row.mediaUrl, 'variant.mediaUrl', 2000) } : {}),
    ...(row.visualDescription
      ? {
          visualDescription: labText(
            row.visualDescription,
            'variant.visualDescription',
            2000,
          ),
        }
      : {}),
    ...(row.html ? { html: labText(row.html, 'variant.html', 5000) } : {}),
  };
  const contentHash = hashCanonical(content);
  if (row.contentHash !== undefined && row.contentHash !== contentHash)
    return invalidLabInput('variant.contentHash', 'HASH_MISMATCH');
  if (
    row.claimValidation !== undefined &&
    row.claimValidation !== claimValidation
  )
    return invalidLabInput('variant.claimValidation', 'CLAIM_STATUS_MISMATCH');
  return {
    id:
      row.id === undefined
        ? `variant-${contentHash.slice(0, 24)}`
        : labId(row.id, 'variant.id'),
    version,
    ...content,
    generation: labEnum(
      row.generation,
      ['manual', 'model'],
      'variant.generation',
    ),
    claimValidation,
    contentHash,
  };
}

export function assertComparableVariants(
  a: CreativeVariantV1,
  b: CreativeVariantV1,
): void {
  if (
    a.productId !== b.productId ||
    a.platform !== b.platform ||
    a.format !== b.format ||
    a.testedVariable !== b.testedVariable
  )
    return invalidLabInput('variants', 'COMPARISON_CONTEXT_MISMATCH');
  if (a.claimValidation !== 'supported' || b.claimValidation !== 'supported')
    return invalidLabInput('variants', 'CLAIM_REVIEW_REQUIRED');
  const changedFields = (['headline', 'body', 'callToAction'] as const).filter(
    (key) => a[key] !== b[key],
  );
  const allowed: Record<string, readonly string[]> = {
    hook: ['headline'],
    'need-frame': ['headline', 'body'],
    proof: ['body'],
    cta: ['callToAction'],
    length: ['body'],
    bundle: ['headline', 'body', 'callToAction'],
  };
  if (
    changedFields.some((field) => !allowed[a.testedVariable]?.includes(field))
  )
    return invalidLabInput('variants', 'TEST_VARIABLE_MISMATCH');
}
