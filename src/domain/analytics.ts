/**
 * Financial Analytics & Multi-Currency Aggregation Domain Logic
 * 
 * Guarantees mathematical invariants:
 * - Financial numbers across different currencies (EGP, USD, SAR, etc.) are never summed without conversion.
 * - Each currency receives its own isolated metrics row.
 * - The organization's base currency is prioritized as primary.
 */

export interface CurrencyMetricRow {
  currency: string;
  disbursedRequests: number;
  disbursedCount: number;
  settledCustodies: number;
  settledCount: number;
  totalActual: number;
  approvedRequests: number;
  approvedCount: number;
  pendingRequests: number;
  pendingCount: number;
  custodiesIssued: number;
  custodiesInHand: number;
  custodiesSettled: number;
  custodiesReturned: number;
  activeCustodiesCount: number;
}

export interface AggregateMetricsOptions {
  requests: Array<{
    status: string;
    amount?: number | null;
    currency?: string | null;
  }>;
  settlements: Array<{
    amount?: number | null;
    currency?: string | null;
  }>;
  custodies: Array<{
    status: string;
    totalAmount?: number | null;
    settledAmount?: number | null;
    returnedAmount?: number | null;
    remainingAmount?: number | null;
    currency?: string | null;
  }>;
  baseCurrency?: string;
}

export function normalizeCurrency(cur?: string | null, fallback = 'EGP'): string {
  const cleaned = (cur || '').trim().toUpperCase();
  return cleaned || fallback.trim().toUpperCase() || 'EGP';
}

export function aggregateMetricsByCurrency({
  requests,
  settlements,
  custodies,
  baseCurrency = 'EGP',
}: AggregateMetricsOptions): CurrencyMetricRow[] {
  const normBase = normalizeCurrency(baseCurrency, 'EGP');
  const map = new Map<string, CurrencyMetricRow>();

  const getRow = (c: string): CurrencyMetricRow => {
    let row = map.get(c);
    if (!row) {
      row = {
        currency: c,
        disbursedRequests: 0,
        disbursedCount: 0,
        settledCustodies: 0,
        settledCount: 0,
        totalActual: 0,
        approvedRequests: 0,
        approvedCount: 0,
        pendingRequests: 0,
        pendingCount: 0,
        custodiesIssued: 0,
        custodiesInHand: 0,
        custodiesSettled: 0,
        custodiesReturned: 0,
        activeCustodiesCount: 0,
      };
      map.set(c, row);
    }
    return row;
  };

  for (const r of requests) {
    const cur = normalizeCurrency(r.currency, normBase);
    const row = getRow(cur);
    const amt = Number(r.amount || 0);

    if (r.status === 'disbursed') {
      row.disbursedRequests += amt;
      row.disbursedCount += 1;
      row.totalActual += amt;
    } else if (r.status === 'approved') {
      row.approvedRequests += amt;
      row.approvedCount += 1;
    } else if (r.status === 'pending') {
      row.pendingRequests += amt;
      row.pendingCount += 1;
    }
  }

  for (const s of settlements) {
    const cur = normalizeCurrency(s.currency, normBase);
    const row = getRow(cur);
    const amt = Number(s.amount || 0);

    row.settledCustodies += amt;
    row.settledCount += 1;
    row.totalActual += amt;
  }

  for (const c of custodies) {
    const cur = normalizeCurrency(c.currency, normBase);
    const row = getRow(cur);
    const total = Number(c.totalAmount || 0);
    const settled = Number(c.settledAmount || 0);
    const returned = Number(c.returnedAmount || 0);
    const remaining = Math.max(0, Number(c.remainingAmount || 0));

    row.custodiesIssued += total;
    row.custodiesSettled += settled;
    row.custodiesReturned += returned;

    if (c.status === 'active') {
      row.custodiesInHand += remaining;
      row.activeCustodiesCount += 1;
    }
  }

  const sorted = Array.from(map.values()).sort((a, b) =>
    a.currency === normBase ? -1 : b.currency === normBase ? 1 : a.currency.localeCompare(b.currency)
  );

  if (sorted.length === 0) {
    sorted.push(getRow(normBase));
  }

  return sorted;
}
