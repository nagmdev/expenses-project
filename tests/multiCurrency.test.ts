import { describe, it, expect } from 'vitest';
import { aggregateMetricsByCurrency, normalizeCurrency } from '../src/domain/analytics';

describe('Multi-Currency Financial Isolation Matrix', () => {
  it('normalizes currency strings cleanly and falls back to base currency', () => {
    expect(normalizeCurrency('egp')).toBe('EGP');
    expect(normalizeCurrency('  usd  ')).toBe('USD');
    expect(normalizeCurrency(null, 'SAR')).toBe('SAR');
    expect(normalizeCurrency(undefined, 'EGP')).toBe('EGP');
    expect(normalizeCurrency('', 'AED')).toBe('AED');
  });

  it('keeps distinct currencies completely isolated without raw summation', () => {
    const requests = [
      { status: 'disbursed', amount: 5000, currency: 'EGP' },
      { status: 'disbursed', amount: 200, currency: 'USD' },
      { status: 'disbursed', amount: 1500, currency: 'SAR' },
      { status: 'approved', amount: 3000, currency: 'EGP' },
      { status: 'approved', amount: 100, currency: 'USD' },
      { status: 'pending', amount: 500, currency: 'SAR' },
    ];

    const settlements = [
      { amount: 1200, currency: 'EGP' },
      { amount: 50, currency: 'USD' },
    ];

    const custodies = [
      { status: 'active', totalAmount: 10000, settledAmount: 1200, returnedAmount: 800, remainingAmount: 8000, currency: 'EGP' },
      { status: 'active', totalAmount: 1000, settledAmount: 50, returnedAmount: 0, remainingAmount: 950, currency: 'USD' },
    ];

    const metrics = aggregateMetricsByCurrency({
      requests,
      settlements,
      custodies,
      baseCurrency: 'EGP',
    });

    // Exactly 3 distinct currencies
    expect(metrics).toHaveLength(3);

    // Primary currency must be EGP
    const egp = metrics[0];
    expect(egp.currency).toBe('EGP');
    expect(egp.disbursedRequests).toBe(5000);
    expect(egp.disbursedCount).toBe(1);
    expect(egp.settledCustodies).toBe(1200);
    expect(egp.settledCount).toBe(1);
    // EGP actual = 5000 + 1200 = 6200 EGP (never mixed with USD or SAR)
    expect(egp.totalActual).toBe(6200);
    expect(egp.approvedRequests).toBe(3000);
    expect(egp.custodiesIssued).toBe(10000);
    expect(egp.custodiesInHand).toBe(8000);
    expect(egp.custodiesSettled).toBe(1200);
    expect(egp.custodiesReturned).toBe(800);

    // Secondary currency USD
    const usd = metrics.find(m => m.currency === 'USD')!;
    expect(usd).toBeDefined();
    expect(usd.disbursedRequests).toBe(200);
    expect(usd.settledCustodies).toBe(50);
    // USD actual = 200 + 50 = 250 USD
    expect(usd.totalActual).toBe(250);
    expect(usd.approvedRequests).toBe(100);
    expect(usd.custodiesIssued).toBe(1000);
    expect(usd.custodiesInHand).toBe(950);

    // Secondary currency SAR
    const sar = metrics.find(m => m.currency === 'SAR')!;
    expect(sar).toBeDefined();
    expect(sar.disbursedRequests).toBe(1500);
    expect(sar.totalActual).toBe(1500);
    expect(sar.pendingRequests).toBe(500);
    expect(sar.custodiesIssued).toBe(0);

    // Crucial financial invariant check:
    // Total of each row must NEVER contain numbers from another currency
    expect(egp.totalActual).not.toBe(6200 + 250);
    expect(egp.totalActual).not.toBe(6200 + 1500);
  });

  it('prioritizes organization baseCurrency as index 0', () => {
    const requests = [
      { status: 'disbursed', amount: 50000, currency: 'EGP' },
      { status: 'disbursed', amount: 1000, currency: 'USD' },
    ];

    // Base currency configured as USD
    const metrics = aggregateMetricsByCurrency({
      requests,
      settlements: [],
      custodies: [],
      baseCurrency: 'USD',
    });

    expect(metrics[0].currency).toBe('USD');
    expect(metrics[0].disbursedRequests).toBe(1000);
    expect(metrics[1].currency).toBe('EGP');
    expect(metrics[1].disbursedRequests).toBe(50000);
  });

  it('handles empty data gracefully by returning default zero row in base currency', () => {
    const metrics = aggregateMetricsByCurrency({
      requests: [],
      settlements: [],
      custodies: [],
      baseCurrency: 'SAR',
    });

    expect(metrics).toHaveLength(1);
    expect(metrics[0]).toEqual({
      currency: 'SAR',
      disbursedRequests: 0,
      disbursedCount: 0,
      settledCustodies: 0,
      settledCount: 0,
      totalActual: 0,
      approvedRequests: 0,
      approvedCount: 0,
      pendingRequests: 0,
      pendingCount: 0,
      totalRequestsAmount: 0,
      totalRequestsCount: 0,
      custodiesIssued: 0,
      custodiesInHand: 0,
      custodiesSettled: 0,
      custodiesReturned: 0,
      activeCustodiesCount: 0,
    });
  });

  it('accurately aggregates totalRequestsAmount, totalRequestsCount, and clarification_requested requests', () => {
    const requests = [
      { status: 'disbursed', amount: 1500, currency: 'EGP' },
      { status: 'approved', amount: 2500, currency: 'EGP' },
      { status: 'pending', amount: 500, currency: 'EGP' },
      { status: 'clarification_requested', amount: 750, currency: 'EGP' },
      { status: 'rejected', amount: 300, currency: 'EGP' },
      { status: 'pending', amount: 100, currency: 'USD' },
    ];

    const metrics = aggregateMetricsByCurrency({
      requests,
      settlements: [],
      custodies: [],
      baseCurrency: 'EGP',
    });

    const egp = metrics.find(m => m.currency === 'EGP')!;
    // Total amount across all 5 EGP requests
    expect(egp.totalRequestsAmount).toBe(1500 + 2500 + 500 + 750 + 300);
    expect(egp.totalRequestsCount).toBe(5);
    // Pending requests includes both pending (500) and clarification_requested (750)
    expect(egp.pendingRequests).toBe(1250);
    expect(egp.pendingCount).toBe(2);

    const usd = metrics.find(m => m.currency === 'USD')!;
    expect(usd.totalRequestsAmount).toBe(100);
    expect(usd.totalRequestsCount).toBe(1);
    expect(usd.pendingRequests).toBe(100);
    expect(usd.pendingCount).toBe(1);
  });

  it('accurately groups custodies by currency with closed/settled status', () => {
    const custodies = [
      { status: 'settled', totalAmount: 5000, settledAmount: 5000, returnedAmount: 0, remainingAmount: 0, currency: 'EGP' },
      { status: 'active', totalAmount: 3000, settledAmount: 1000, returnedAmount: 0, remainingAmount: 2000, currency: 'EGP' },
      { status: 'active', totalAmount: 700, settledAmount: 200, returnedAmount: 100, remainingAmount: 400, currency: 'USD' },
    ];

    const metrics = aggregateMetricsByCurrency({
      requests: [],
      settlements: [],
      custodies,
      baseCurrency: 'EGP',
    });

    const egp = metrics.find(m => m.currency === 'EGP')!;
    expect(egp.custodiesIssued).toBe(8000);
    expect(egp.custodiesSettled).toBe(6000);
    expect(egp.custodiesInHand).toBe(2000);
    expect(egp.activeCustodiesCount).toBe(1);

    const usd = metrics.find(m => m.currency === 'USD')!;
    expect(usd.custodiesIssued).toBe(700);
    expect(usd.custodiesSettled).toBe(200);
    expect(usd.custodiesReturned).toBe(100);
    expect(usd.custodiesInHand).toBe(400);
    expect(usd.activeCustodiesCount).toBe(1);
  });
});
