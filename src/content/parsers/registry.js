import { headingParser } from './headingParser.js';
import { imdbListParser } from './imdbListParser.js';
import { jsonLdParser } from './jsonLdParser.js';
import { openGraphParser } from './openGraphParser.js';

export const mediaParsers = [
  jsonLdParser,
  openGraphParser,
  headingParser,
  imdbListParser
];
