export class SearchInstrumentsError extends Error {
  constructor(cause: unknown) {
    super('Instrument search could not be completed.', { cause });
    this.name = 'SearchInstrumentsError';
  }
}
