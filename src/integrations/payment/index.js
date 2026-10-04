import crypto from 'node:crypto';

// Simulated provider: no real money moves and no provider credentials are accepted.
class MockPaymentProvider {
  async createPaymentIntent({ amount, currency, metadata = {} }) {
    return { id: `pi_mock_${crypto.randomUUID()}`, status: 'requires_capture', amount, currency, metadata, mocked: true };
  }
}

let provider;
export function getPaymentProvider() {
  provider ||= new MockPaymentProvider();
  return provider;
}
