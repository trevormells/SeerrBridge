import { guessYearFromText } from './parserUtils.js';

function getMeta(document, attribute, value) {
  return (
    document
      .querySelector(`meta[${attribute}="${value}"]`)
      ?.getAttribute('content') || ''
  );
}

export const openGraphParser = {
  id: 'open-graph',
  async parse({ document }) {
    const ogTitle = getMeta(document, 'property', 'og:title');
    if (!ogTitle) {
      return [];
    }

    const ogType = (getMeta(document, 'property', 'og:type') || '').toLowerCase();
    const tvTypes = ['video.tv_show', 'video.episode', 'tv_show', 'tv.episode'];
    const type = tvTypes.some((tvType) => ogType.includes(tvType)) ? 'tv' : 'movie';

    return [
      {
        title: ogTitle,
        subtitle: getMeta(document, 'property', 'og:description') || '',
        poster: getMeta(document, 'property', 'og:image') || '',
        releaseYear: guessYearFromText(
          getMeta(document, 'name', 'release_date') || document.title
        ),
        source: 'open-graph',
        mediaType: type
      }
    ];
  }
};
