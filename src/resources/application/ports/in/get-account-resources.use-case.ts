import type { AccountResources } from '../../../domain/account-resources.js';

export interface GetAccountResourcesInput {
  readonly userId: number;
}

export type GetAccountResourcesOutput = AccountResources;

export interface GetAccountResourcesUseCase {
  execute(input: GetAccountResourcesInput): Promise<GetAccountResourcesOutput>;
}
