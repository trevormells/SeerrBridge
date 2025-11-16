/**
 * @typedef {import('../lib/types.js').DetectedMediaCandidate} DetectedMediaCandidate
 * @typedef {import('../lib/types.js').DetectionResponse} DetectionResponse
 */

(async () => {
  const [{ sanitizeDetectionLimit }, { DETECTION_LIMITS }] = await Promise.all([
    import(chrome.runtime.getURL('src/lib/sanitizers.js')),
    import(chrome.runtime.getURL('src/lib/config.js'))
  ]);

  const DEFAULT_DETECTION_LIMIT = DETECTION_LIMITS.default;
  const MEDIA_TYPES = ['Movie', 'TVSeries', 'TVEpisode', 'VideoObject'];
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
      const detections = detectMedia();
      sendResponse(detections);
    }
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
  function detectMedia() {
    const candidates = [
      ...parseJsonLd(),
      ...parseOpenGraph(),
      ...parseHeading(),
      ...parseImdbListItems()
    ];

    const processed = dedupeCandidates(
      candidates.filter((item) => Boolean(item.title)).map(postProcessCandidate)
    );
    const buckets = bucketCandidates(processed);
    return {
      items: buckets.items,
      weak_detections: buckets.weakDetections
    };
  }

  function parseJsonLd() {
    const scripts = document.querySelectorAll(
      'script[type="application/ld+json"]'
    );
    const items = [];

    scripts.forEach((script) => {
      try {
        const json = JSON.parse(script.textContent || '{}');
        if (Array.isArray(json)) {
          json.forEach((entry) => items.push(...normalizeJsonLd(entry)));
        } else {
          items.push(...normalizeJsonLd(json));
        }
      } catch (error) {
        // Ignore invalid JSON-LD blobs
      }
    });

    return items;
  }

  function normalizeJsonLd(entry) {
    if (!entry || typeof entry !== 'object') {
      return [];
    }

    if (Array.isArray(entry['@graph'])) {
      return entry['@graph'].flatMap((item) => normalizeJsonLd(item));
    }

    if (Array.isArray(entry['@type'])) {
      return entry['@type'].flatMap((type) =>
        normalizeJsonLd({ ...entry, '@type': type })
      );
    }

    if (!MEDIA_TYPES.includes(entry['@type'])) {
      return [];
    }

    return [
      {
        title: entry.name || '',
        subtitle: entry.description || '',
        poster: entry.image || '',
        releaseYear: getYear(entry.datePublished || entry.dateCreated),
        source: 'json-ld',
        mediaType: entry['@type']?.toLowerCase().startsWith('tv')
          ? 'tv'
          : 'movie'
      }
    ];
  }

  function parseOpenGraph() {
    const ogTitle = getMeta('property', 'og:title');
    if (!ogTitle) {
      return [];
    }

    const ogType = (getMeta('property', 'og:type') || '').toLowerCase();
    const tvTypes = ['video.tv_show', 'video.episode', 'tv_show', 'tv.episode'];
    const type = tvTypes.some((tvType) => ogType.includes(tvType))
      ? 'tv'
      : 'movie';

    return [
      {
        title: ogTitle,
        subtitle: getMeta('property', 'og:description') || '',
        poster: getMeta('property', 'og:image') || '',
        releaseYear: guessYearFromText(
          getMeta('name', 'release_date') || document.title
        ),
        source: 'open-graph',
        mediaType: type
      }
    ];
  }

  function parseHeading() {
    const heading =
      document.querySelector('h1') || document.querySelector('h2');
    if (!heading) {
      return [];
    }

    return [
      {
        title: heading.textContent?.trim() || '',
        subtitle: document.title || '',
        poster: '',
        releaseYear: guessYearFromText(document.title),
        source: 'heading',
        mediaType: 'movie'
      }
    ];
  }

  function parseImdbListItems() {
    const items = document.querySelectorAll(
      '.cli-children, [data-testid="title-list-item"]'
    );
    if (!items.length) {
      return [];
    }

    return Array.from(items)
      .map((item) => {
        const title = item.querySelector('h3')?.textContent?.trim();
        if (!title) {
          return null;
        }

        const metadataItems = Array.from(
          item.querySelectorAll('.cli-title-metadata-item')
        )
          .map((el) => el.textContent?.trim())
          .filter(Boolean);
        const ranking =
          item
            .querySelector('[data-testid="title-list-item-ranking"] .ipc-signpost__text')
            ?.textContent?.trim() || '';
        const rating =
          item
            .querySelector('[data-testid="ratingGroup--imdb-rating"] .ipc-rating-star--rating')
            ?.textContent?.trim() || '';
        const votes =
          item
            .querySelector('[data-testid="ratingGroup--imdb-rating"] .ipc-rating-star--voteCount')
            ?.textContent?.trim() || '';

        const subtitleParts = [];
        if (ranking) {
          subtitleParts.push(ranking);
        }
        if (metadataItems.length) {
          subtitleParts.push(metadataItems.join(' • '));
        }
        if (rating) {
          subtitleParts.push(`IMDb ${rating}${votes ? ` ${votes}` : ''}`);
        }

        const releaseYearText =
          metadataItems.find((text) => /(19|20)\d{2}/.test(text)) || '';

        return {
          title,
          subtitle: subtitleParts.join(' • '),
          poster: '',
          releaseYear: guessYearFromText(releaseYearText || title),
          source: 'imdb-list',
          mediaType: 'movie'
        };
      })
      .filter(Boolean);
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

  function getMeta(attribute, value) {
    return (
      document
        .querySelector(`meta[${attribute}="${value}"]`)
        ?.getAttribute('content') || ''
    );
  }

  function getYear(dateString) {
    if (!dateString) {
      return '';
    }

    const year = new Date(dateString).getFullYear();
    return Number.isNaN(year) ? '' : `${year}`;
  }

  function guessYearFromText(text) {
    if (!text) {
      return '';
    }

    const match = text.match(/(19|20)\d{2}/);
    return match ? match[0] : '';
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
})().catch((error) => {
  console.error('Detector bootstrap failed', error);
});
