import { readFileSync, existsSync } from 'node:fs';

/**
 * LocalFileAdapterTransport
 * Generic file transport that accepts a custom parse callback.
 */
export class LocalFileAdapterTransport {
  /**
   * @param {Object} options
   * @param {string} options.filePath - Absolute path to target file
   * @param {Function} [options.parse] - Custom parser/schema transformer (default: JSON.parse)
   */
  constructor({ filePath, parse = JSON.parse }) {
    this.filePath = filePath;
    this.parse = parse;
  }

  async fetch() {
    if (!existsSync(this.filePath)) {
      throw new Error(`File not found at transport path: ${this.filePath}`);
    }
    const raw = readFileSync(this.filePath, 'utf8');
    return this.parse(raw);
  }
}
