import { describe, expect, it } from 'vitest';
import { buildNotifications, countUnread, formatTimeAgo, parseEventTime, requestStatusEvent } from '../src/utils/notifications';
import type { AuditLogEntry, ExpenseRequest, VisaRequest } from '../src/types';

const NOW = new Date('2026-09-30T16:21:00').getTime();

const employee = { id: 'uid-emp', email: 'emp@acme.test', role: 'employee' as const };
const finance = { id: 'uid-fin', email: 'fin@acme.test', role: 'finance' as const };
const admin = { id: 'uid-admin', email: 'admin@acme.test', role: 'org_admin' as const };
const dataEntry = { id: 'uid-de', email: 'de@acme.test', role: 'data_entry' as const };

function request(over: Partial<ExpenseRequest>): ExpenseRequest {
  return {
    id: 'req-1',
    requestNumber: 'REQ-2026-000001',
    orgId: 'org',
    requesterId: employee.id,
    requesterName: 'موظف',
    requesterEmail: employee.email,
    requesterDepartment: '',
    serviceCategoryId: 's',
    serviceCategoryName: 'خدمة',
    providerId: 'p',
    providerName: 'مورد',
    title: 'اشتراك',
    description: '',
    justification: '',
    amount: 1800,
    currency: 'EGP',
    status: 'pending',
    urgency: 'medium',
    attachments: [],
    comments: [],
    timeline: [{ id: 'tl-1', status: 'created', title: 'إنشاء', description: '', actorName: 'موظف', timestamp: '2026-09-30 16:07' }],
    createdAt: '2026-09-30T13:07:00.000Z',
    updatedAt: '2026-09-30T13:07:00.000Z',
    ...over,
  };
}

function visa(over: Partial<VisaRequest>): VisaRequest {
  return {
    id: 'visa-1',
    requestNumber: 'VISA-2026-000001',
    orgId: 'org',
    requestDate: '2026-09-30T10:00:00.000Z',
    travelerName: 'مسافر',
    passportNumber: 'A1',
    destinationCountry: 'SA',
    hasTraveledBefore: false,
    expectedTravelDate: '2026-12-01',
    visaType: 'tourist',
    serviceProviderId: 'p',
    serviceProviderName: 'مركز',
    status: 'pending',
    assignedApprover: '',
    totalAmount: 2000,
    currency: 'EGP',
    paymentMode: 'full',
    paidAmount: 0,
    remainingBalance: 2000,
    payments: [],
    requesterId: dataEntry.id,
    requesterName: 'مدخل',
    createdAt: '2026-09-30T10:00:00.000Z',
    updatedAt: '2026-09-30T10:00:00.000Z',
    ...over,
  };
}

const none = new Set<string>();
const sources = (s: { requests?: ExpenseRequest[]; visaRequests?: VisaRequest[]; auditLogs?: AuditLogEntry[] }) => ({
  requests: s.requests ?? [],
  visaRequests: s.visaRequests ?? [],
  auditLogs: s.auditLogs ?? [],
});

describe('notification feed', () => {
  it("does not count the employee's own pending requests; the badge follows read state", () => {
    const own = [
      request({ id: 'a', status: 'pending' }),
      request({
        id: 'b',
        status: 'approved',
        timeline: [
          { id: 'b1', status: 'created', title: '', description: '', actorName: '', timestamp: '2026-09-30 16:07' },
          { id: 'b2', status: 'approved', title: '', description: '', actorName: '', timestamp: '2026-09-30 16:17' },
        ],
      }),
    ];
    const list = buildNotifications(sources({ requests: own }), employee, none, NOW);
    expect(list.map((n) => n.id)).toEqual(['req_b_approved_b2']);
    expect(countUnread(list)).toBe(1);
    expect(list[0].targetTab).toBe('my-requests');

    const afterRead = buildNotifications(sources({ requests: own }), employee, new Set(list.map((n) => n.id)), NOW);
    expect(countUnread(afterRead)).toBe(0);
  });

  it('dates a decision by the status change, not by the request creation', () => {
    const req = request({
      status: 'approved',
      timeline: [
        { id: 't1', status: 'created', title: '', description: '', actorName: '', timestamp: '2026-09-30 16:07' },
        { id: 't2', status: 'approved', title: '', description: '', actorName: '', timestamp: '2026-09-30 16:17' },
      ],
    });
    const { time } = requestStatusEvent(req);
    expect(time).toBe(parseEventTime('2026-09-30 16:17'));
    expect(formatTimeAgo(time, NOW)).toBe('منذ 4 دقيقة');
  });

  it("gives finance the approved-awaiting-disbursement requests as its tasks", () => {
    const list = buildNotifications(
      sources({ requests: [request({ id: 'x', status: 'approved', requesterId: 'someone', requesterEmail: 'x@acme.test' })] }),
      finance,
      none,
      NOW,
    );
    expect(list).toHaveLength(1);
    expect(list[0].actionable).toBe(true);
    expect(list[0].targetTab).toBe('requests');
  });

  it('a request that returns to pending after a clarification is a new unread item', () => {
    const base = request({ requesterId: 'someone', requesterEmail: 'x@acme.test' });
    const first = buildNotifications(sources({ requests: [base] }), admin, none, NOW);
    const answered = request({
      requesterId: 'someone',
      requesterEmail: 'x@acme.test',
      timeline: [
        ...base.timeline,
        { id: 'c1', status: 'clarification_requested', title: '', description: '', actorName: '', timestamp: '2026-09-30 16:10' },
        { id: 'c2', status: 'clarification_answered', title: '', description: '', actorName: '', timestamp: '2026-09-30 16:15' },
      ],
    });
    const second = buildNotifications(sources({ requests: [answered] }), admin, new Set(first.map((n) => n.id)), NOW);
    expect(countUnread(second)).toBe(1);
  });

  it("routes data entry's own request to my-requests, never to the approver list", () => {
    const list = buildNotifications(
      sources({ requests: [request({ requesterId: dataEntry.id, requesterEmail: dataEntry.email, status: 'rejected', rejectionReason: 'x' })] }),
      dataEntry,
      none,
      NOW,
    );
    expect(list[0].targetTab).toBe('my-requests');
    expect(list[0].actionable).toBe(false);
  });

  it('opens the visas page for a visa item and does not talk about a request', () => {
    const list = buildNotifications(
      sources({ visaRequests: [visa({ status: 'rejected', requesterId: admin.id, approvedAt: '2026-09-30T13:00:00.000Z' })] }),
      admin,
      none,
      NOW,
    );
    expect(list[0].kind).toBe('visa');
    expect(list[0].targetTab).toBe('visas');
    expect(list[0].actionLabel).not.toContain('الطلب');
  });

  it('shows pending visas to deciders and partially paid visas to payers', () => {
    const list = buildNotifications(
      sources({ visaRequests: [visa({ id: 'v1' }), visa({ id: 'v2', status: 'partially_paid', payments: [] })] }),
      finance,
      none,
      NOW,
    );
    expect(list.filter((n) => n.actionable)).toHaveLength(2);
  });

  it('audit activity opens the related page with a matching hint, never "open the request"', () => {
    const log: AuditLogEntry = {
      id: 'l1',
      actionType: 'password_reset',
      entityType: 'member',
      entityId: 'x@acme.test',
      entityName: 'x@acme.test',
      actorId: 'someone',
      actorName: 'مدير',
      actorEmail: 'a@acme.test',
      details: 'reset',
      timestamp: '2026-09-30T12:00:00.000Z',
    };
    const [item] = buildNotifications(sources({ auditLogs: [log] }), admin, none, NOW);
    expect(item.targetTab).toBe('users');
    expect(item.actionLabel).not.toContain('الطلب');
    // Finance may not read the audit log: no activity items.
    expect(buildNotifications(sources({ auditLogs: [log] }), finance, none, NOW)).toHaveLength(0);
  });
});
