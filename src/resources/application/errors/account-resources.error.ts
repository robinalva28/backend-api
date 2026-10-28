export class AccountResourcesError extends Error {
  constructor(cause: unknown) {
    super('Account resources could not be calculated.', { cause });
    this.name = 'AccountResourcesError';
  }
}
