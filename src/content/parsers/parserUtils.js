export function getYear(dateString) {
  if (!dateString) {
    return '';
  }

  const year = new Date(dateString).getFullYear();
  return Number.isNaN(year) ? '' : `${year}`;
}

export function guessYearFromText(text) {
  if (!text) {
    return '';
  }

  const match = text.match(/(19|20)\d{2}/);
  return match ? match[0] : '';
}
