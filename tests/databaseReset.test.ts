import { describe, expect, it } from 'vitest';
import { RESET_COLLECTIONS } from '../src/lib/databaseReset';

describe('Database Reset Configuration', () => {
  it('includes all operational collections targeted for wipe', () => {
    const names = RESET_COLLECTIONS.map(c => c.name);
    
    // Core organizational & operational collections
    expect(names).toContain('organizations');
    expect(names).toContain('paymentAccounts');
    expect(names).toContain('accountTransactions');
    expect(names).toContain('requests');
    expect(names).toContain('visaRequests');
    expect(names).toContain('custodies');
    expect(names).toContain('pettyCashCustodies');
    expect(names).toContain('custodySettlements');
    expect(names).toContain('services');
    expect(names).toContain('providers');
    expect(names).toContain('departments');

    // Logs, outbox, attachments, counters, and uniqueness keys
    expect(names).toContain('auditLogs');
    expect(names).toContain('outbox');
    expect(names).toContain('email_logs');
    expect(names).toContain('mail');
    expect(names).toContain('legacyRestores');
    expect(names).toContain('uniqueKeys');
    expect(names).toContain('attachmentTombstones');
    expect(names).toContain('attachments');
    expect(names).toContain('counters');
  });

  it('strictly excludes users, super_admins, members, and system_settings from deletion', () => {
    const names = RESET_COLLECTIONS.map(c => c.name);
    
    expect(names).not.toContain('users');
    expect(names).not.toContain('super_admins');
    expect(names).not.toContain('members');
    expect(names).not.toContain('system_settings');
  });

  it('has non-empty Arabic labels and unique collection names', () => {
    const names = new Set<string>();
    for (const c of RESET_COLLECTIONS) {
      expect(names.has(c.name)).toBe(false);
      names.add(c.name);
      expect(c.label.trim().length).toBeGreaterThan(0);
    }
  });
});
