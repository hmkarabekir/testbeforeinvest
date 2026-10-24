/** Preserve PostgreSQL microseconds: Date.parse alone truncates them. */
export function evidenceTimestamp(value: unknown): bigint | null {
  if (typeof value !== 'string') return null;
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (!parts) return null;
  const [
    ,
    year,
    month,
    day,
    hour,
    minute,
    second,
    fraction = '',
    zone,
    ,
    offsetHour,
    offsetMinute,
  ] = parts;
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    m < 1 ||
    m > 12 ||
    d < 1 ||
    d > days[m - 1] ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59 ||
    (zone !== 'Z' && (Number(offsetHour) > 23 || Number(offsetMinute) > 59))
  )
    return null;
  const wholeSecond = Date.parse(
    `${year}-${month}-${day}T${hour}:${minute}:${second}${zone}`,
  );
  if (!Number.isFinite(wholeSecond)) return null;
  return BigInt(wholeSecond) * 1000n + BigInt(fraction.padEnd(6, '0'));
}

/** Keep legacy millisecond ISO output, retaining precision for new microsecond inputs. */
export function evidenceTimestampIso(value: bigint): string {
  const remainder = ((value % 1000n) + 1000n) % 1000n;
  const iso = new Date(Number((value - remainder) / 1000n)).toISOString();
  return remainder === 0n
    ? iso
    : iso.replace('Z', `${remainder.toString().padStart(3, '0')}Z`);
}
