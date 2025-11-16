import { guessYearFromText } from './parserUtils.js';

export const headingParser = {
  id: 'heading',
  async parse({ document }) {
    const heading = document.querySelector('h1') || document.querySelector('h2');
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
};
