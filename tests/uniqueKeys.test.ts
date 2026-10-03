/**
 * Uniqueness keys name their company in clear, so firestore.rules can refuse a probe from
 * another company whether the key exists or not; keys in the old id format (company
 * base64-encoded) are moved once by the platform owner.
 */
import { describe, expect, it } from 'vitest';
import { legacyUniqueKeyDocId, normalizeKeyValue, normalizeKeyValueV1, readUniqueKey, uniqueKeyDocId, uniqueKeyDocIdV1, type Actor } from '../src/domain/common';
import { encodeKeyPart } from '../src/utils/ids';
import { createEntity, migrateLegacyUniqueKeys, uniqueKeyOwnersOf, type UniqueKeyOwner } from '../src/domain/directory';
import type { ServiceProvider } from '../src/types';
import { ORG, admin, freshStore, key } from './helpers';

const owner: Actor = { id: 'uidOwner000000000000000001', name: 'Owner', email: 'mahmoud@tieapps.com', role: 'super_admin' };
const now = new Date('2026-09-30T10:00:00.000Z');

const providerKey = (id: string, value = 'Vodafone'): UniqueKeyOwner => ({ scope: 'provider_name', orgId: ORG, value, collection: 'providers', id });
const seedLegacy = (store: ReturnType<typeof freshStore>, o: UniqueKeyOwner, entityId = o.id) =>
  store.seed('uniqueKeys', legacyUniqueKeyDocId(o.scope, o.orgId, o.value), {
    scope: o.scope, orgId: o.orgId, value: o.value.toLowerCase(), entityCollection: o.collection, entityId, createdAt: '2026-01-01T00:00:00.000Z',
  });

describe('uniqueness key ids', () => {
  it('name the company in clear (the rules read it from the id) and keep the value encoded', () => {
    expect(uniqueKeyDocId('member_email', ORG, 'A.B@Acme.test')).toBe(`member_email__${ORG}__${encodeKeyPart('a.b@acme.test')}`);
    // keys written before 2026-10 folded an email's separators (old id format and V1 current format)
    expect(uniqueKeyDocIdV1('member_email', ORG, 'A.B@Acme.test')).toBe(`member_email__${ORG}__${legacyUniqueKeyDocId('member_email', ORG, 'A.B@Acme.test').split('__')[2]}`);
    expect(uniqueKeyDocId('org_code', '-', 'ACME').split('__')[1]).toBe('-');
    expect(legacyUniqueKeyDocId('member_email', ORG, 'x@acme.test')).not.toBe(uniqueKeyDocId('member_email', ORG, 'x@acme.test'));
  });

  it('a new record claims its key under the current id', async () => {
    const store = freshStore();
    const build = (id: string): ServiceProvider => ({
      id, orgId: ORG, name: 'Vodafone', serviceCategoryIds: [], serviceCategoryNames: [], contactPerson: '', phone: '010', email: '', taxNumber: '', crNumber: '',
      bankName: '', iban: '', address: '', rating: 5, totalPaid: 0, active: true,
    } as ServiceProvider);
    const res = await createEntity(store, admin, 'provider', build, () => 'x', key(), now);
    expect(store.read('uniqueKeys', uniqueKeyDocId('provider_name', ORG, 'Vodafone'))).toMatchObject({ orgId: ORG, entityId: res.value.id });
  });
});

describe('migrateLegacyUniqueKeys (platform owner, once after the rules update)', () => {
  it('moves a key that still names its record, and a second run finds nothing to move', async () => {
    const store = freshStore();
    const o = providerKey('prov-1');
    seedLegacy(store, o);
    expect(await migrateLegacyUniqueKeys(store, owner, [o], now)).toEqual({ moved: 1, replaced: 0, skipped: 0 });
    expect(store.read('uniqueKeys', legacyUniqueKeyDocId(o.scope, ORG, o.value))).toBeFalsy();
    expect(store.read('uniqueKeys', uniqueKeyDocId(o.scope, ORG, o.value))).toMatchObject({
      scope: 'provider_name', orgId: ORG, value: 'vodafone', entityCollection: 'providers', entityId: 'prov-1', createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(await migrateLegacyUniqueKeys(store, owner, [o], now)).toEqual({ moved: 0, replaced: 0, skipped: 0 });
  });

  it('after the move, a duplicate of an existing record is refused again', async () => {
    const store = freshStore();
    const o = providerKey('prov-1');
    seedLegacy(store, o);
    store.seed('providers', 'prov-1', { id: 'prov-1', orgId: ORG, name: 'Vodafone', totalPaid: 0, active: true }); // the record the key names
    await migrateLegacyUniqueKeys(store, owner, [o], now);
    const build = (id: string) => ({ id, orgId: ORG, name: 'vodafone', active: true, totalPaid: 0 } as unknown as ServiceProvider);
    await expect(createEntity(store, admin, 'provider', build, () => 'x', key(), now)).rejects.toMatchObject({ code: 'duplicate' });
  });

  it('leaves a key that names another record, and removes one already replaced for the same record', async () => {
    const store = freshStore();
    const stale = providerKey('prov-live', 'Orange');
    seedLegacy(store, stale, 'prov-deleted');
    const done = providerKey('prov-2', 'Etisalat');
    seedLegacy(store, done);
    store.seed('uniqueKeys', uniqueKeyDocId(done.scope, ORG, done.value), { scope: done.scope, orgId: ORG, value: 'etisalat', entityCollection: 'providers', entityId: 'prov-2' });
    expect(await migrateLegacyUniqueKeys(store, owner, [stale, done], now)).toEqual({ moved: 0, replaced: 1, skipped: 1 });
    expect(store.read('uniqueKeys', legacyUniqueKeyDocId(stale.scope, ORG, stale.value))).toMatchObject({ entityId: 'prov-deleted' });
    expect(store.read('uniqueKeys', uniqueKeyDocId(stale.scope, ORG, stale.value))).toBeFalsy();
    expect(store.read('uniqueKeys', legacyUniqueKeyDocId(done.scope, ORG, done.value))).toBeFalsy();
  });

  it('two records with the same value (older data): the key moves for the one it names', async () => {
    const store = freshStore();
    seedLegacy(store, providerKey('prov-b'));
    expect(await migrateLegacyUniqueKeys(store, owner, [providerKey('prov-a'), providerKey('prov-b')], now)).toEqual({ moved: 1, replaced: 0, skipped: 0 });
    expect(store.read('uniqueKeys', uniqueKeyDocId('provider_name', ORG, 'Vodafone'))).toMatchObject({ entityId: 'prov-b' });
  });

  it('with no old-format key left, reads no current-format key (the ones every create writes), all reads at once', async () => {
    const store = freshStore();
    const reads: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const watched: typeof store = {
      ...store,
      runTransaction: fn =>
        store.runTransaction(tx =>
          fn({
            ...tx,
            get: async (c, id) => {
              reads.push(`${c}/${id}`);
              inFlight += 1;
              maxInFlight = Math.max(maxInFlight, inFlight);
              await Promise.resolve();
              inFlight -= 1;
              return tx.get(c, id);
            },
          }),
        ),
    };
    const owners = ['A', 'B', 'C'].map(v => providerKey(`prov-${v}`, v));
    expect(await migrateLegacyUniqueKeys(watched, owner, owners, now)).toEqual({ moved: 0, replaced: 0, skipped: 0 });
    expect(reads).toEqual(owners.map(o => `uniqueKeys/${legacyUniqueKeyDocId(o.scope, o.orgId, o.value)}`));
    expect(maxInFlight).toBe(owners.length);
  });

  it('is the platform owner’s only', async () => {
    const store = freshStore();
    seedLegacy(store, providerKey('prov-1'));
    await expect(migrateLegacyUniqueKeys(store, admin, [providerKey('prov-1')], now)).rejects.toMatchObject({ code: 'forbidden' });
    expect(store.read('uniqueKeys', legacyUniqueKeyDocId('provider_name', ORG, 'Vodafone'))).toBeTruthy();
  });

  it('uniqueKeyOwnersOf lists every keyed record with the value the domain claims', () => {
    const owners = uniqueKeyOwnersOf({
      organizations: [{ id: ORG, name: 'Acme', code: 'ACME' } as never],
      members: [{ id: `u1_${ORG}`, orgId: ORG, userEmail: ' Emp@Acme.test ' } as never],
      services: [{ id: 'srv-1', orgId: ORG, code: ' CLD ' } as never],
      providers: [{ id: 'prov-1', orgId: ORG, name: 'Vodafone ' } as never],
      departments: [{ id: 'dept-1', orgId: ORG, name: 'IT' } as never],
      paymentAccounts: [{ id: 'acc-1', orgId: ORG, accountIdentifier: 'EG001' } as never],
    });
    expect(owners).toEqual([
      { scope: 'org_code', orgId: '-', value: 'ACME', collection: 'organizations', id: ORG },
      { scope: 'member_email', orgId: ORG, value: 'emp@acme.test', collection: 'members', id: `u1_${ORG}` },
      { scope: 'service_code', orgId: ORG, value: 'CLD', collection: 'services', id: 'srv-1' },
      { scope: 'provider_name', orgId: ORG, value: 'Vodafone', collection: 'providers', id: 'prov-1' },
      { scope: 'department_name', orgId: ORG, value: 'IT', collection: 'departments', id: 'dept-1' },
      { scope: 'account_identifier', orgId: ORG, value: 'EG001', collection: 'paymentAccounts', id: 'acc-1' },
    ]);
  });
});

describe('normalizeKeyValue (must match firestore.rules → uniqueKeys keyNorm character for character)', () => {
  it('lower-cases A-Z only, folds Arabic-Indic digits, drops the JavaScript whitespace, invisible marks, tatweel, harakat and - _ . (kept in an email / @ address)', () => {
    expect(normalizeKeyValue(' Vodafone-EG_1.0 ')).toBe('vodafoneeg10');
    expect(normalizeKeyValue('ko\u3000DAK\u00A0\uFEFF\u2028\u000B')).toBe('kodak');
    // non-ASCII capitals are kept (the rules' lower() need not map them like JavaScript)
    expect(normalizeKeyValue('SOCIÉTÉ')).toBe('sociÉtÉ');
    expect(normalizeKeyValue('\u212Aodak')).toBe('\u212Aodak');
    // invisible format characters, tatweel and harakat: dropped; Arabic-Indic / Persian digits: ASCII
    expect(normalizeKeyValue('a\u180Eb\u200Bc\u00AD')).toBe('abc');
    expect(normalizeKeyValue('شَرِكَة الأمـــل')).toBe(normalizeKeyValue('شركة الأمل'));
    expect(normalizeKeyValue('\u0660\u0661\u0662\u06F3\u06F9')).toBe('01239');
    // separators tell emails and InstaPay addresses apart; elsewhere they are dropped
    expect(normalizeKeyValue('Ahmed.Ali@Acme.test', 'member_email')).toBe('ahmed.ali@acme.test');
    expect(normalizeKeyValue('ali.m@instapay', 'account_identifier')).toBe('ali.m@instapay');
    expect(normalizeKeyValue('EG-001.2', 'account_identifier')).toBe('eg0012');
    // the value app versions before 2026-10 computed
    expect(normalizeKeyValueV1('Ahmed.Ali@Acme.test')).toBe('ahmedali@acmetest');
    expect(normalizeKeyValueV1('a\u200Bb')).toBe('a\u200Bb');
    const dropped = /[\s\u00ad\u034f\u061c\u0640\u064b-\u065f\u0670\u180e\u200b-\u200f\u2060]/;
    for (let c = 0; c < 0x10000; c++) {
      const ch = String.fromCharCode(c);
      if (/[A-Z\-_.\u0660-\u0669\u06f0-\u06f9]/.test(ch)) continue;
      expect(normalizeKeyValue(`x${ch}y`) === 'xy').toBe(dropped.test(ch));
    }
  });

  it('a value that normalizes to nothing ("-", "...") has no key: nothing is read or claimed', async () => {
    const store = freshStore();
    let reads = 0;
    await store.runTransaction(async tx => {
      const counting = { ...tx, get: async (c: string, id: string) => { reads++; return tx.get(c, id); } } as typeof tx;
      const k = await readUniqueKey(counting, 'account_identifier', ORG, ' - ');
      expect(k.owner).toBeNull();
    });
    expect(reads).toBe(0);
    for (const name of ['...', '_']) {
      await createEntity(store, admin, 'provider', (id: string) => ({ id, orgId: ORG, name, totalPaid: 0, active: true } as ServiceProvider), () => 'x', key(), now);
    }
    expect(store.dump('uniqueKeys').filter((k: any) => k.value === '')).toHaveLength(0);
  });
});
