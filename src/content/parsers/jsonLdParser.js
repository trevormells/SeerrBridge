import { getYear } from './parserUtils.js';

const MEDIA_TYPES = ['Movie', 'TVSeries', 'TVEpisode', 'VideoObject'];

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
      mediaType: entry['@type']?.toLowerCase().startsWith('tv') ? 'tv' : 'movie'
    }
  ];
}

export const jsonLdParser = {
  id: 'json-ld',
  async parse({ document }) {
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
      } catch {
        // Ignore invalid JSON-LD blobs
      }
    });

    return items;
  }
};
