import { guessYearFromText } from './parserUtils.js';

function buildSubtitle({ ranking, metadataItems, rating, votes }) {
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
  return subtitleParts.join(' • ');
}

export const imdbListParser = {
  id: 'imdb-list',
  async parse({ document }) {
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

        const releaseYearText =
          metadataItems.find((text) => /(19|20)\d{2}/.test(text)) || '';

        return {
          title,
          subtitle: buildSubtitle({ ranking, metadataItems, rating, votes }),
          poster: '',
          releaseYear: guessYearFromText(releaseYearText || title),
          source: 'imdb-list',
          mediaType: 'movie'
        };
      })
      .filter(Boolean);
  }
};
