/**
 * @typedef {import('../lib/types.js').DetectedMediaCandidate} DetectedMediaCandidate
 * @typedef {import('../lib/types.js').DetectionResponse} DetectionResponse
 */

(async () => {
  const [
    { sanitizeDetectionLimit },
    { DETECTION_LIMITS },
    { mediaParsers },
    parserUtilsModule
  ] = await Promise.all([
    import(chrome.runtime.getURL('src/lib/sanitizers.js')),
    import(chrome.runtime.getURL('src/lib/config.js')),
    import(chrome.runtime.getURL('src/content/parsers/registry.js')),
    import(chrome.runtime.getURL('src/content/parsers/parserUtils.js'))
  ]);
  const { guessYearFromText } = parserUtilsModule;

  const DEFAULT_DETECTION_LIMIT = DETECTION_LIMITS.default;
  const WEAK_TITLE_PATTERNS = [
    /\blist of\b/i,
    /\bwatchlist\b/i,
    /\bfilmography\b/i,
    /\bcollection\b/i,
    /\bguide\b/i,
    /\bepisode guide\b/i,
    /\btop\s+\d+\b/i,
    /\btop\b.*\bmovies?\b/i,
    /\bbest\b.*\bmovies?\b/i,
    /\bmovies?\b.*\blist\b/i,
    /\bimdb\b.*\btop\b/i
  ];
  const WEAK_SUFFIXES = ['movies', 'films', 'collections', 'rankings'];
  const TITLE_NOISE_SUFFIX_PATTERNS = [
    /\s*[-–—|:]\s*(imdb|tmdb|rotten tomatoes|rottentomatoes|metacritic|the numbers|official site|official trailer|trailer|teaser|watch online|full movie|movie review|netflix|prime video|amazon prime|disney\+|hulu|hbomax|max)\s*$/i,
    /\s+(?:movie|film|films)\s*$/i,
    /\s*\((19|20)\d{2}\)\s*$/i,
    /\s+(19|20)\d{2}\s*$/i
  ];
  const STOPWORDS = new Set([
    'a',
    'an',
    'and',
    'as',
    'at',
    'by',
    'for',
    'from',
    'in',
    'of',
    'on',
    'the',
    'to',
    'with'
  ]);

  let detectionLimit = DEFAULT_DETECTION_LIMIT;
  initializeDetectionLimit();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'DETECT_MEDIA') {
      detectMedia()
        .then(sendResponse)
        .catch((error) => {
          console.error('detectMedia failed', error);
          sendResponse({ items: [], weak_detections: [] });
        });
      return true;
    }
    return undefined;
  });

  function initializeDetectionLimit() {
    if (!chrome?.storage?.sync) {
      return;
    }

    chrome.storage.sync.get(['maxDetections'], (result = {}) => {
      detectionLimit = sanitizeDetectionLimit(result.maxDetections, DEFAULT_DETECTION_LIMIT);
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync' || !changes.maxDetections) {
        return;
      }
      detectionLimit = sanitizeDetectionLimit(
        changes.maxDetections.newValue,
        DEFAULT_DETECTION_LIMIT
      );
    });
  }

  /**
   * Generates a detection payload consumed by the popup script.
   * @returns {DetectionResponse}
   */
  async function detectMedia() {
    const parserContext = { document };
    const parserOutputs = await Promise.all(
      mediaParsers.map((parser) => runParser(parser, parserContext))
    );
    const candidates = parserOutputs.flat();

    const processed = dedupeCandidates(
      candidates.filter((item) => Boolean(item.title)).map(postProcessCandidate)
    );
    const buckets = bucketCandidates(processed);
    return {
      items: buckets.items,
      weak_detections: buckets.weakDetections
    };
  }

  async function runParser(parser, context) {
    try {
      const result = await parser.parse(context);
      return normalizeParserOutput(parser, result);
    } catch (error) {
      console.warn(`Media parser "${parser.id}" failed`, error);
      return [];
    }
  }

  function normalizeParserOutput(parser, output) {
    if (!Array.isArray(output)) {
      return [];
    }

    return output
      .filter(Boolean)
      .map((item) => ({
        ...item,
        source: item.source || parser.id
      }));
  }

  function dedupeCandidates(candidates) {
    const buckets = new Map();

    candidates.forEach((candidate) => {
      const normalizedTitle = normalizeTitle(candidate.title);
      if (!normalizedTitle) {
        return;
      }

      const normalizedCandidate = {
        ...candidate,
        title: candidate.title?.trim() || '',
        releaseYear: normalizeReleaseYear(candidate.releaseYear)
      };

      const bucket = buckets.get(normalizedTitle) || [];
      const existingIndex = bucket.findIndex((item) =>
        isPotentiallySameRelease(item.releaseYear, normalizedCandidate.releaseYear)
      );

      if (existingIndex === -1) {
        bucket.push(normalizedCandidate);
      } else {
        bucket[existingIndex] = pickPreferredCandidate(
          bucket[existingIndex],
          normalizedCandidate
        );
      }

      buckets.set(normalizedTitle, bucket);
    });

    return Array.from(buckets.values())
      .flat()
      .slice(0, detectionLimit);
  }

  function bucketCandidates(candidates) {
    return candidates.reduce(
      (acc, candidate) => {
        if (isWeakDetection(candidate)) {
          acc.weakDetections.push(candidate);
        } else {
          acc.items.push(candidate);
        }
        return acc;
      },
      { items: [], weakDetections: [] }
    );
  }

  function postProcessCandidate(candidate) {
    const trimmedTitle = candidate.title?.trim() || '';
    const cleanedTitle = stripTitleNoise(trimmedTitle);
    const normalizedTitle = cleanedTitle || trimmedTitle;

    return {
      ...candidate,
      title: normalizedTitle,
      releaseYear: candidate.releaseYear || guessYearFromText(normalizedTitle),
      mediaType: candidate.mediaType || 'movie'
    };
  }

  // Score heuristics to push list-like or metadata-only matches into the weak bucket.
  function isWeakDetection(candidate = {}) {
    const title = (candidate.title || '').trim();
    if (!title) {
      return true;
    }

    const normalized = title.toLowerCase();
    let score = 0;

    if (!candidate.releaseYear) {
      score += 1;
    } else {
      const releaseYear = parseInt(candidate.releaseYear, 10);
      const currentYear = new Date().getFullYear();
      if (
        !Number.isNaN(releaseYear) &&
        (releaseYear < 1900 || releaseYear > currentYear + 1)
      ) {
        score += 2;
      }
    }

    if (WEAK_TITLE_PATTERNS.some((pattern) => pattern.test(title))) {
      score += 3;
    } else if (
      WEAK_SUFFIXES.some((suffix) => normalized.endsWith(` ${suffix}`))
    ) {
      score += 2;
    }

    const words = normalized.split(/\s+/).filter(Boolean);
    const stopwordCount = words.filter((word) => STOPWORDS.has(word)).length;
    if (words.length >= 4 && stopwordCount >= Math.ceil(words.length / 2)) {
      score += 1;
    }

    if (candidate.source === 'heading' && !candidate.poster) {
      score += 1;
    }

    return score >= 3;
  }

  function normalizeTitle(value = '') {
    if (!value) {
      return '';
    }
    const stripped = stripTitleNoise(value);
    return stripped
      .normalize('NFKD')
      .replace(/[^\w\s]/g, ' ')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeReleaseYear(year) {
    if (!year) {
      return '';
    }
    const match = `${year}`.match(/(19|20)\d{2}/);
    return match ? match[0] : '';
  }

  function isPotentiallySameRelease(currentYear, nextYear) {
    if (!currentYear || !nextYear) {
      return true;
    }
    return currentYear === nextYear;
  }

  function pickPreferredCandidate(current, incoming) {
    return candidateCompletenessScore(incoming) > candidateCompletenessScore(current)
      ? incoming
      : current;
  }

  function candidateCompletenessScore(candidate = {}) {
    let score = 0;
    if (candidate.poster) {
      score += 2;
    }
    if (candidate.subtitle) {
      score += 1;
    }
    if (candidate.releaseYear) {
      score += 1;
    }
    return score;
  }

  function stripTitleNoise(value = '') {
    let result = value;
    let previous = null;
    while (result && result !== previous) {
      previous = result;
      TITLE_NOISE_SUFFIX_PATTERNS.forEach((pattern) => {
        result = result.replace(pattern, '');
      });
      result = result.trim();
    }
    return result;
  }

  if (
    typeof globalThis !== 'undefined' &&
    typeof globalThis.__SEERRBRIDGE_DETECTOR_TEST_HOOK__ === 'function'
  ) {
    globalThis.__SEERRBRIDGE_DETECTOR_TEST_HOOK__({
      detectMedia,
      dedupeCandidates,
      bucketCandidates,
      isWeakDetection,
      normalizeTitle,
      stripTitleNoise
    });
  }
})().catch((error) => {
  console.error('Detector bootstrap failed', error);
});
