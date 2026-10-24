import { evidenceTimestamp } from './evidence-timestamp.js';

export type AudienceDatasetV1 = {
  schemaVersion: 1;
  label: string;
  synthetic: boolean;
  asOf: string;
  window: { from: string; to: string };
  brand: {
    name: string;
    category:
      | 'furniture'
      | 'coffee'
      | 'software'
      | 'personal-brand'
      | 'creator'
      | 'other';
    language: string;
    description: string;
  };
  products: Array<{
    id: string;
    name: string;
    category: string;
    facts: Array<{ id: string; text: string }>;
    price: { amountMinor: number; currency: string } | null;
  }>;
  sources: Array<{
    id: string;
    platform: string;
    population:
      | 'followers'
      | 'engaged-audience'
      | 'viewers'
      | 'site-visitors'
      | 'declared-research';
    sampled: boolean;
    complete: boolean;
    collectedAt: string;
  }>;
  observations: Array<{
    id: string;
    sourceRef: string;
    metric: string;
    dimensions: Record<string, string>;
    unit: 'count' | 'percent';
    value: number | null;
    status: 'observed' | 'unavailable' | 'suppressed' | 'not-returned';
    denominatorRef: string | null;
    observedAt: string;
  }>;
  content: Array<{
    id: string;
    sourceRef: string;
    productRefs: string[];
    text: string;
    publishedAt: string;
    likes: number | null;
    comments: number | null;
    themeTags: string[];
  }>;
  events: Array<{
    id: string;
    sourceRef: string;
    profileRef: string;
    name:
      | 'product_view'
      | 'add_to_cart'
      | 'checkout_started'
      | 'purchase_reported'
      | 'verified_purchase'
      | 'trial_requested'
      | 'pricing_view'
      | 'integration_docs_view';
    productRef: string;
    eventTime: string;
    receivedAt: string;
  }>;
  research: Array<{
    id: string;
    sourceRef: string;
    statement: string;
    theme: string;
    sampleSize: number | null;
  }>;
};

export type PersonaClaim = {
  id: string;
  text: string;
  kind: 'observed' | 'declared' | 'computed' | 'inferred' | 'assumed';
  evidenceRefs: string[];
};

export type SimulationPersonaV1 = {
  schemaVersion: 1;
  id: string;
  version: number;
  datasetHash: string;
  compilerVersion: string;
  title: string;
  summary: string;
  observedFacts: PersonaClaim[];
  derivedSignals: PersonaClaim[];
  assumptions: PersonaClaim[];
  unknowns: string[];
  needs: string[];
  objections: string[];
  decisionRules: Array<{
    id: string;
    condition: string;
    effect: 'prefer' | 'avoid' | 'ask';
    reason: string;
    claimRefs: string[];
  }>;
  weight: {
    value: number;
    basis: 'observed-disjoint' | 'equal-scenario' | 'merchant-scenario';
  };
  evidenceRefs: string[];
};

export type AgentIdentityV1 = {
  id: string;
  personaId: string;
  personaVersion: number;
  identityVersion: 'identity-1';
  memberIndex: number;
  language: string;
  knowledgeClaimIds: string[];
  decisionRuleIds: string[];
  scenario: {
    attention: 'brief' | 'normal' | 'deliberate';
    skepticism: 'low' | 'medium' | 'high';
    familiarity: 'unknown' | 'new' | 'returning';
    basis: 'assumed';
  };
  prohibitedInferences: string[];
  identityHash: string;
};

export type CreativeVariantV1 = {
  id: string;
  version: number;
  productId: string;
  platform: 'instagram' | 'facebook' | 'generic';
  format: 'text-ad' | 'story' | 'image-ad' | 'html';
  headline: string;
  body: string;
  callToAction: string;
  testedVariable: string;
  productFactRefs: string[];
  assumptions: string[];
  generation: 'manual' | 'model';
  productClaims: Array<{ factRef: string; quote: string }>;
  claimValidation: 'supported' | 'review-required';
  contentHash: string;
  mediaUrl?: string;
  visualDescription?: string;
  html?: string;
};

export class AudienceLabValidationError extends Error {
  readonly code = 'AUDIENCE_LAB_INPUT_INVALID';
  readonly issues: Array<{ path: string; code: string }>;
  constructor(path: string, issue = 'INVALID_VALUE') {
    super(`AUDIENCE_LAB_INPUT_INVALID:${path}:${issue}`);
    this.name = 'AudienceLabValidationError';
    this.issues = [{ path, code: issue }];
  }
}

export const invalidLabInput = (path: string, code?: string): never => {
  throw new AudienceLabValidationError(path, code);
};
export function labRecord(
  value: unknown,
  keys: readonly string[],
  path: string,
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return invalidLabInput(path, 'OBJECT_REQUIRED');
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).some(
      (key) => !keys.includes(key) && !optional.includes(key),
    )
  )
    return invalidLabInput(path, 'UNKNOWN_FIELD');
  if (keys.some((key) => !Object.hasOwn(row, key)))
    return invalidLabInput(path, 'FIELD_REQUIRED');
  return row;
}
export function labText(value: unknown, path: string, max = 2000): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  )
    return invalidLabInput(path, 'TEXT_INVALID');
  return value.trim();
}
export function labId(value: unknown, path: string): string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value)
  )
    return invalidLabInput(path, 'ID_INVALID');
  return value;
}
export function labEnum<T extends string>(
  value: unknown,
  values: readonly T[],
  path: string,
): T {
  if (!values.includes(value as T))
    return invalidLabInput(path, 'ENUM_INVALID');
  return value as T;
}
function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean')
    return invalidLabInput(path, 'BOOLEAN_REQUIRED');
  return value;
}
export function labArray(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    return invalidLabInput(path, 'ARRAY_LIMIT');
  return value;
}
function number(value: unknown, path: string, nullable = false): number | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    return invalidLabInput(path, 'COUNT_INVALID');
  return value;
}
function timestamp(value: unknown, path: string): string {
  if (
    typeof value !== 'string' ||
    value.length > 40 ||
    evidenceTimestamp(value) === null
  )
    return invalidLabInput(path, 'TIME_INVALID');
  return value;
}
function unique<T extends { id: string }>(rows: T[], path: string): T[] {
  const result = new Map<string, T>();
  for (const row of rows) {
    const old = result.get(row.id);
    if (old && JSON.stringify(old) !== JSON.stringify(row))
      return invalidLabInput(path, 'ID_CONFLICT');
    if (!old) result.set(row.id, row);
  }
  return [...result.values()];
}
function refs(
  value: unknown,
  path: string,
  known: Set<string>,
  max = 50,
): string[] {
  const rows = labArray(value, path, max).map((item, i) =>
    labId(item, `${path}.${i}`),
  );
  if (rows.some((id) => !known.has(id)))
    return invalidLabInput(path, 'REFERENCE_INVALID');
  return [...new Set(rows)].sort();
}

/** Parses upload data only. Provider verification and tenant authority are server metadata. */
export function parseAudienceDataset(raw: unknown): AudienceDatasetV1 {
  try {
    if (Buffer.byteLength(JSON.stringify(raw) ?? '', 'utf8') > 2 * 1024 * 1024)
      invalidLabInput('$', 'BODY_LIMIT');
  } catch (error) {
    if (error instanceof AudienceLabValidationError) throw error;
    return invalidLabInput('$', 'JSON_REQUIRED');
  }
  const root = labRecord(
    raw,
    [
      'schemaVersion',
      'label',
      'synthetic',
      'asOf',
      'window',
      'brand',
      'products',
      'sources',
      'observations',
      'content',
      'events',
      'research',
    ],
    '$',
  );
  if (root.schemaVersion !== 1)
    return invalidLabInput('schemaVersion', 'VERSION_UNSUPPORTED');
  const asOf = timestamp(root.asOf, 'asOf');
  const w = labRecord(root.window, ['from', 'to'], 'window');
  const window = {
    from: timestamp(w.from, 'window.from'),
    to: timestamp(w.to, 'window.to'),
  };
  const from = evidenceTimestamp(window.from)!,
    to = evidenceTimestamp(window.to)!,
    asOfUs = evidenceTimestamp(asOf)!;
  if (from > to || to > asOfUs)
    return invalidLabInput('window', 'CHRONOLOGY_INVALID');
  const inWindow = (time: string, path: string) => {
    const at = evidenceTimestamp(time)!;
    if (at < from || at > to) invalidLabInput(path, 'OUTSIDE_WINDOW');
    return time;
  };
  const b = labRecord(
    root.brand,
    ['name', 'category', 'language', 'description'],
    'brand',
  );
  const language = labText(b.language, 'brand.language', 20);
  if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language))
    return invalidLabInput('brand.language', 'LANGUAGE_INVALID');
  const brand: AudienceDatasetV1['brand'] = {
    name: labText(b.name, 'brand.name', 120),
    category: labEnum(
      b.category,
      [
        'furniture',
        'coffee',
        'software',
        'personal-brand',
        'creator',
        'other',
      ],
      'brand.category',
    ),
    language,
    description: labText(b.description, 'brand.description'),
  };
  const factIds = new Set<string>();
  const products = unique(
    labArray(root.products, 'products', 50).map((value, i) => {
      const path = `products.${i}`,
        row = labRecord(
          value,
          ['id', 'name', 'category', 'facts', 'price'],
          path,
        );
      const facts = unique(
        labArray(row.facts, `${path}.facts`, 30).map((f, j) => {
          const p = `${path}.facts.${j}`,
            fact = labRecord(f, ['id', 'text'], p);
          return {
            id: labId(fact.id, `${p}.id`),
            text: labText(fact.text, `${p}.text`),
          };
        }),
        `${path}.facts`,
      );
      let price: AudienceDatasetV1['products'][number]['price'] = null;
      if (row.price !== null) {
        const p = labRecord(
          row.price,
          ['amountMinor', 'currency'],
          `${path}.price`,
        );
        const currency = labText(p.currency, `${path}.price.currency`, 3);
        if (!/^[A-Z]{3}$/.test(currency))
          return invalidLabInput(`${path}.price.currency`, 'CURRENCY_INVALID');
        price = {
          amountMinor: number(p.amountMinor, `${path}.price.amountMinor`)!,
          currency,
        };
      }
      return {
        id: labId(row.id, `${path}.id`),
        name: labText(row.name, `${path}.name`, 160),
        category: labText(row.category, `${path}.category`, 100),
        facts,
        price,
      };
    }),
    'products',
  );
  if (!products.length) return invalidLabInput('products', 'PRODUCT_REQUIRED');
  for (const product of products)
    for (const fact of product.facts) {
      if (factIds.has(fact.id))
        return invalidLabInput('products.facts', 'FACT_ID_AMBIGUOUS');
      factIds.add(fact.id);
    }
  const productIds = new Set(products.map((p) => p.id));
  const sources = unique(
    labArray(root.sources, 'sources', 10).map((value, i) => {
      const path = `sources.${i}`,
        row = labRecord(
          value,
          [
            'id',
            'platform',
            'population',
            'sampled',
            'complete',
            'collectedAt',
          ],
          path,
        );
      const collectedAt = timestamp(row.collectedAt, `${path}.collectedAt`);
      if (evidenceTimestamp(collectedAt)! > asOfUs)
        return invalidLabInput(`${path}.collectedAt`, 'FUTURE_SOURCE');
      const sampled = boolean(row.sampled, `${path}.sampled`),
        complete = boolean(row.complete, `${path}.complete`);
      if (sampled && complete)
        return invalidLabInput(path, 'SAMPLED_COMPLETE_CONFLICT');
      return {
        id: labId(row.id, `${path}.id`),
        platform: labId(row.platform, `${path}.platform`),
        population: labEnum(
          row.population,
          [
            'followers',
            'engaged-audience',
            'viewers',
            'site-visitors',
            'declared-research',
          ],
          `${path}.population`,
        ),
        sampled,
        complete,
        collectedAt,
      };
    }),
    'sources',
  );
  if (!sources.length) return invalidLabInput('sources', 'SOURCE_REQUIRED');
  const sourceIds = new Set(sources.map((s) => s.id));
  const sourceRef = (value: unknown, path: string) => {
    const id = labId(value, path);
    if (!sourceIds.has(id)) return invalidLabInput(path, 'SOURCE_INVALID');
    return id;
  };
  const productRef = (value: unknown, path: string) => {
    const id = labId(value, path);
    if (!productIds.has(id)) return invalidLabInput(path, 'PRODUCT_INVALID');
    return id;
  };
  const observations = unique(
    labArray(root.observations, 'observations', 2000).map((value, i) => {
      const path = `observations.${i}`,
        row = labRecord(
          value,
          [
            'id',
            'sourceRef',
            'metric',
            'dimensions',
            'unit',
            'value',
            'status',
            'denominatorRef',
            'observedAt',
          ],
          path,
        );
      const dimensions = labRecord(row.dimensions, [], `${path}.dimensions`, [
        'age',
        'gender',
        'country',
        'city',
        'age_group',
        'ageGroup',
        'theme',
        'product',
        'gender_age',
      ]);
      const dims: Record<string, string> = {};
      for (const key of Object.keys(dimensions).sort())
        dims[key] = labText(dimensions[key], `${path}.dimensions.${key}`, 120);
      const unit = labEnum(row.unit, ['count', 'percent'], `${path}.unit`),
        status = labEnum(
          row.status,
          ['observed', 'unavailable', 'suppressed', 'not-returned'],
          `${path}.status`,
        );
      let val: number | null = null;
      if (status === 'observed') {
        if (
          typeof row.value !== 'number' ||
          !Number.isFinite(row.value) ||
          row.value < 0 ||
          (unit === 'percent'
            ? row.value > 100
            : !Number.isSafeInteger(row.value))
        )
          return invalidLabInput(`${path}.value`, 'METRIC_INVALID');
        val = row.value;
      } else if (row.value !== null)
        return invalidLabInput(`${path}.value`, 'MISSING_METRIC_MUST_BE_NULL');
      return {
        id: labId(row.id, `${path}.id`),
        sourceRef: sourceRef(row.sourceRef, `${path}.sourceRef`),
        metric: labId(row.metric, `${path}.metric`),
        dimensions: dims,
        unit,
        value: val,
        status,
        denominatorRef:
          row.denominatorRef === null
            ? null
            : labId(row.denominatorRef, `${path}.denominatorRef`),
        observedAt: inWindow(
          timestamp(row.observedAt, `${path}.observedAt`),
          `${path}.observedAt`,
        ),
      };
    }),
    'observations',
  );
  const observationById = new Map(observations.map((o) => [o.id, o]));
  for (const observation of observations)
    if (observation.denominatorRef !== null) {
      const denominator = observationById.get(observation.denominatorRef);
      if (
        !denominator ||
        denominator.id === observation.id ||
        denominator.sourceRef !== observation.sourceRef ||
        denominator.unit !== 'count' ||
        denominator.status !== 'observed' ||
        denominator.denominatorRef !== null ||
        Object.keys(denominator.dimensions).length ||
        !denominator.value ||
        denominator.observedAt !== observation.observedAt ||
        (observation.unit === 'count' &&
          observation.value !== null &&
          observation.value > denominator.value)
      )
        return invalidLabInput(
          'observations.denominatorRef',
          'DENOMINATOR_INVALID',
        );
    }
  const content = unique(
    labArray(root.content, 'content', 200).map((value, i) => {
      const path = `content.${i}`,
        row = labRecord(
          value,
          [
            'id',
            'sourceRef',
            'productRefs',
            'text',
            'publishedAt',
            'likes',
            'comments',
            'themeTags',
          ],
          path,
        );
      return {
        id: labId(row.id, `${path}.id`),
        sourceRef: sourceRef(row.sourceRef, `${path}.sourceRef`),
        productRefs: refs(row.productRefs, `${path}.productRefs`, productIds),
        text: labText(row.text, `${path}.text`),
        publishedAt: inWindow(
          timestamp(row.publishedAt, `${path}.publishedAt`),
          `${path}.publishedAt`,
        ),
        likes: number(row.likes, `${path}.likes`, true),
        comments: number(row.comments, `${path}.comments`, true),
        themeTags: [
          ...new Set(
            labArray(row.themeTags, `${path}.themeTags`, 20).map((tag, j) =>
              labText(tag, `${path}.themeTags.${j}`, 80),
            ),
          ),
        ].sort(),
      };
    }),
    'content',
  );
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const events = unique(
    labArray(root.events, 'events', 5000).map((value, i) => {
      const path = `events.${i}`,
        row = labRecord(
          value,
          [
            'id',
            'sourceRef',
            'profileRef',
            'name',
            'productRef',
            'eventTime',
            'receivedAt',
          ],
          path,
        );
      const eventTime = inWindow(
          timestamp(row.eventTime, `${path}.eventTime`),
          `${path}.eventTime`,
        ),
        receivedAt = timestamp(row.receivedAt, `${path}.receivedAt`);
      if (
        evidenceTimestamp(eventTime)! > evidenceTimestamp(receivedAt)! ||
        evidenceTimestamp(receivedAt)! > asOfUs
      )
        return invalidLabInput(path, 'EVENT_CHRONOLOGY_INVALID');
      const source = sourceRef(row.sourceRef, `${path}.sourceRef`);
      if (sourceById.get(source)!.population !== 'site-visitors')
        return invalidLabInput(
          `${path}.sourceRef`,
          'INDIVIDUAL_SOURCE_REQUIRED',
        );
      return {
        id: labId(row.id, `${path}.id`),
        sourceRef: source,
        profileRef: labId(row.profileRef, `${path}.profileRef`),
        name: labEnum(
          row.name,
          [
            'product_view',
            'add_to_cart',
            'checkout_started',
            'purchase_reported',
            'verified_purchase',
            'trial_requested',
            'pricing_view',
            'integration_docs_view',
          ],
          `${path}.name`,
        ),
        productRef: productRef(row.productRef, `${path}.productRef`),
        eventTime,
        receivedAt,
      };
    }),
    'events',
  );
  const research = unique(
    labArray(root.research, 'research', 200).map((value, i) => {
      const path = `research.${i}`,
        row = labRecord(
          value,
          ['id', 'sourceRef', 'statement', 'theme', 'sampleSize'],
          path,
        );
      const source = sourceRef(row.sourceRef, `${path}.sourceRef`);
      if (sourceById.get(source)!.population !== 'declared-research')
        return invalidLabInput(`${path}.sourceRef`, 'DECLARED_SOURCE_REQUIRED');
      const sampleSize = number(row.sampleSize, `${path}.sampleSize`, true);
      if (sampleSize === 0)
        return invalidLabInput(
          `${path}.sampleSize`,
          'SAMPLE_POSITIVE_OR_UNKNOWN',
        );
      return {
        id: labId(row.id, `${path}.id`),
        sourceRef: source,
        statement: labText(row.statement, `${path}.statement`),
        theme: labText(row.theme, `${path}.theme`, 80),
        sampleSize,
      };
    }),
    'research',
  );
  return {
    schemaVersion: 1,
    label: labText(root.label, 'label', 160),
    synthetic: boolean(root.synthetic, 'synthetic'),
    asOf,
    window,
    brand,
    products,
    sources,
    observations,
    content,
    events,
    research,
  };
}
