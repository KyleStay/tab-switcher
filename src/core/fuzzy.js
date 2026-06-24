const EXACT_THRESHOLD = 25;

export function buildSearchText(item) {
  return buildSearchDocument(item).text;
}

export function buildSearchDocument(item) {
  const fields = [
    ["title", item.title || ""],
    ["url", item.displayUrl || item.url || ""]
  ];
  const offsets = {};
  const parts = [];
  let cursor = 0;

  for (const [name, value] of fields) {
    if (parts.length) cursor += 1;
    offsets[name] = [cursor, cursor + value.length];
    parts.push(value);
    cursor += value.length;
  }

  return { text: parts.join(" "), offsets };
}

export function rankItems(items, query, options = {}) {
  const trimmed = query.trim();
  const maxResults = options.maxResults || 75;

  if (!trimmed) {
    return items.slice(0, maxResults).map((item, index) => ({
      item,
      score: 10_000 - index,
      ranges: [],
      fieldRanges: { title: [], url: [] },
      index,
      reason: "recent"
    }));
  }

  const tokens = trimmed.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const exactMode = trimmed.length > EXACT_THRESHOLD;
  const ranked = [];

  items.forEach((item, index) => {
    const { text, offsets } = item.searchDocument || buildSearchDocument(item);
    const lower = text.toLocaleLowerCase();
    const allRanges = [];
    let total = 0;

    for (const token of tokens) {
      const match = exactMode ? exactMatch(lower, token) : fuzzyMatch(text, token);
      if (!match) return;
      total += match.score;
      allRanges.push(...match.ranges);
    }

    const mruBoost = Math.max(0, 1000 - index * 8);
    ranked.push({
      item,
      score: total + mruBoost,
      ranges: mergeRanges(allRanges),
      fieldRanges: projectFieldRanges(allRanges, offsets),
      index,
      reason: exactMode ? "exact" : "fuzzy"
    });
  });

  return ranked.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.index - right.index;
  }).slice(0, maxResults);
}

export function fuzzyMatch(text, token) {
  const lower = text.toLocaleLowerCase();
  const query = token.toLocaleLowerCase();
  let position = 0;
  const ranges = [];
  let score = 0;
  let runLength = 0;

  for (const char of query) {
    const found = lower.indexOf(char, position);
    if (found === -1) return null;
    const nextPosition = found + char.length;

    const isBoundary = found === 0 || /[\s/.\-_:?#=&]/.test(text[found - 1] || "");
    const isCamel = /[A-Z]/.test(text[found] || "") && found > 0 && /[a-z]/.test(text[found - 1] || "");
    const contiguous = found === position;

    score += 12;
    if (isBoundary) score += 18;
    if (isCamel) score += 14;
    if (contiguous) {
      runLength += 1;
      score += 10 + runLength * 4;
    } else {
      runLength = 0;
      score -= Math.min(12, found - position);
    }

    ranges.push([found, nextPosition]);
    position = nextPosition;
  }

  const prefix = lower.startsWith(query);
  if (prefix) score += 80;

  const wordPrefix = lower.includes(` ${query}`) || lower.includes(`/${query}`) || lower.includes(`-${query}`);
  if (wordPrefix) score += 45;

  return { score, ranges };
}

function exactMatch(lower, token) {
  const index = lower.indexOf(token);
  if (index === -1) return null;
  return {
    score: 500 + Math.max(0, 100 - index),
    ranges: [[index, index + token.length]]
  };
}

export function mergeRanges(ranges) {
  if (!ranges.length) return [];
  const sorted = [...ranges].sort((left, right) => left[0] - right[0]);
  const merged = [sorted[0]];

  for (const range of sorted.slice(1)) {
    const previous = merged[merged.length - 1];
    if (range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]);
    else merged.push([...range]);
  }

  return merged;
}

export function projectFieldRanges(ranges, offsets) {
  const projected = {};

  for (const [name, [fieldStart, fieldEnd]] of Object.entries(offsets)) {
    projected[name] = mergeRanges(ranges
      .map(([start, end]) => [
        Math.max(0, start - fieldStart),
        Math.min(fieldEnd - fieldStart, end - fieldStart)
      ])
      .filter(([start, end]) => end > 0 && start < end));
  }

  return projected;
}
