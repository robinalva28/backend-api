import type {
  SubmitOrderRecovery,
  SubmitOrderRecoveryInput,
  SubmitOrderRecoveryOutcome,
} from '../../src/orders/application/ports/out/submit-order-recovery.port.js';

/**
 * Test double for submission paths where an uncertain COMMIT cannot occur.
 * It fails loudly if recovery is unexpectedly requested.
 */
export class NeverSubmitOrderRecovery implements SubmitOrderRecovery {
  async recover(_input: SubmitOrderRecoveryInput): Promise<SubmitOrderRecoveryOutcome> {
    throw new Error('Submit order recovery was not expected in this test.');
  }
}
