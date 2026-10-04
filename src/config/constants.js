// Simulated marketplace card, wallet and escrow domain.
export const FINANCE = Object.freeze({ CURRENCY: 'BDT', ACTIVATION_MINIMUM: 500, CARD_NETWORK: 'Giggo Network', CARD_TYPE: 'developer' });
export const VIRTUAL_CARD_STATUS = Object.freeze({ PENDING: 'pending', INACTIVE: 'inactive', ACTIVE: 'active', SUSPENDED: 'suspended', BLOCKED: 'blocked', EXPIRED: 'expired', CANCELLED: 'cancelled' });
export const SIMULATED_PROVIDER = Object.freeze({ BKASH: 'BKASH_SIMULATED', NAGAD: 'NAGAD_SIMULATED', ROCKET: 'ROCKET_SIMULATED' });
export const SIMULATED_PAYMENT_STATUS = Object.freeze({ PENDING: 'pending', PROCESSING: 'processing', SUCCESS: 'success', FAILED: 'failed', CANCELLED: 'cancelled' });
export const LEDGER_ENTRY_TYPE = Object.freeze({ CARD_RELOAD: 'card_reload', CLIENT_PAYMENT: 'client_payment', DEVELOPER_EARNING: 'developer_earning', PLATFORM_FEE: 'platform_fee', REFUND: 'refund', ADJUSTMENT: 'adjustment', WITHDRAWAL: 'withdrawal' });
export const PAYMENT_STATUS = Object.freeze({ CREATED: 'created', CHECKOUT_CREATED: 'checkout_created', PROCESSING: 'processing', SUCCEEDED: 'succeeded', FAILED: 'failed', CANCELLED: 'cancelled', REFUND_PENDING: 'refund_pending', REFUNDED: 'refunded', PARTIALLY_REFUNDED: 'partially_refunded', DISPUTED: 'disputed' });
export const ESCROW_STATUS = Object.freeze({ NOT_FUNDED: 'not_funded', FUNDING_PENDING: 'funding_pending', FUNDED: 'funded', RELEASE_PENDING: 'release_pending', RELEASED: 'released', REFUND_PENDING: 'refund_pending', REFUNDED: 'refunded', DISPUTED: 'disputed' });
