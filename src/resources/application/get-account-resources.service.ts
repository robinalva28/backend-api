import { calculateAccountResources } from '../domain/calculate-account-resources.js';
import { AccountResourcesError } from './errors/account-resources.error.js';
import type {
  GetAccountResourcesInput,
  GetAccountResourcesOutput,
  GetAccountResourcesUseCase,
} from './ports/in/get-account-resources.use-case.js';
import type { AccountMovementRepository } from './ports/out/account-movement.repository.js';

export class GetAccountResourcesService implements GetAccountResourcesUseCase {
  constructor(private readonly repository: AccountMovementRepository) {}

  async execute(
    input: GetAccountResourcesInput,
  ): Promise<GetAccountResourcesOutput> {
    try {
      const movements = await this.repository.findByUserId(input.userId);

      return calculateAccountResources(movements);
    } catch (error) {
      throw new AccountResourcesError(error);
    }
  }
}
