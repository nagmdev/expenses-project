/**
 * Serverless API handler for dispatching emails directly to real email inboxes.
 * Supports:
 * 1. Resend API (Free 3,000 emails/month, zero credit card)
 * 2. Brevo API (Free 300 emails/day)
 * 3. Fallback and direct health check
 */
// Per-instance idempotency cache. The authoritative exactly-once guard is the
// transactional outbox claim in Firestore; this cache additionally absorbs retries
// that hit the same warm instance, and the key is forwarded to the provider.
const IDEMPOTENCY_TTL_MS = 10 * 60_000;
const PROVIDER_TIMEOUT_MS = 10_000;
const recentDeliveries = new Map<string, { at: number; body: any }>();

function rememberDelivery(key: string | undefined, body: any) {
  if (!key) return;
  const now = Date.now();
  for (const [k, v] of recentDeliveries) {
    if (now - v.at > IDEMPOTENCY_TTL_MS) recentDeliveries.delete(k);
  }
  recentDeliveries.set(key, { at: now, body });
}

// ---------------------------------------------------------------------------
// Authorization. This endpoint is NOT a generic mailer: it delivers one recipient of
// an outbox/{eventId} notification. The event is read from Firestore with the
// caller's own Firebase ID token, so the Firestore rules decide whether the caller
// may dispatch it (its creator, the org's finance/admins, or a super admin), and the
// rules on outbox creation decide who an event may address. Subject, body and sender
// come from the event, never from the request body.
// ---------------------------------------------------------------------------
const FIRESTORE_TIMEOUT_MS = 8_000;

function firestoreDocsBase() {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || 'expenses-project-ce1f9';
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;
  const origin = emulator ? `http://${emulator}` : 'https://firestore.googleapis.com';
  return `${origin}/v1/projects/${projectId}/databases/(default)/documents`;
}

/** Firestore REST value → plain JS value. */
export function decodeFirestoreValue(v: any): any {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return Boolean(v.booleanValue);
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue?.values || []).map(decodeFirestoreValue);
  if ('mapValue' in v) return decodeFirestoreFields(v.mapValue?.fields || {});
  return null;
}

export function decodeFirestoreFields(fields: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = decodeFirestoreValue(v);
  return out;
}

export type OutboxLookup =
  | { ok: true; event: Record<string, any> }
  | { ok: false; status: number; error: string };

/** Reads outbox/{eventId} as the caller (Firestore rules apply). */
export async function loadOutboxEventAsCaller(eventId: string, idToken: string): Promise<OutboxLookup> {
  const res = await fetchWithTimeout(
    `${firestoreDocsBase()}/outbox/${encodeURIComponent(eventId)}`,
    { method: 'GET', headers: { Authorization: `Bearer ${idToken}` } },
    FIRESTORE_TIMEOUT_MS,
  );
  if (res.status === 401 || res.status === 403) return { ok: false, status: 403, error: 'not_allowed_to_dispatch_event' };
  if (res.status === 404) return { ok: false, status: 404, error: 'event_not_found' };
  if (!res.ok) return { ok: false, status: 502, error: `firestore_http_${res.status}` };
  const doc = await res.json();
  return { ok: true, event: decodeFirestoreFields(doc?.fields || {}) };
}

function bearerToken(header: unknown): string | null {
  const m = typeof header === 'string' ? /^Bearer\s+(\S+)$/i.exec(header.trim()) : null;
  return m ? m[1] : null;
}

async function fetchWithTimeout(url: string, init: any, timeoutMs = PROVIDER_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      const timeoutErr: any = new Error(`Provider timeout after ${timeoutMs}ms`);
      timeoutErr.timeout = true;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req: any, res: any) {
  // Production-grade CORS configuration
  const origin = req.headers.origin || '';
  const allowedOrigins = [
    'https://expenses-project-xi.vercel.app',
    'https://expenses-project-ce1f9.firebaseapp.com',
    'https://expenses-project-ce1f9.web.app',
    'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:4173',
  ];
  const isOriginAllowed = !origin || allowedOrigins.includes(origin) || /^https:\/\/expenses-project(?:-[a-z0-9-]+)?\.vercel\.app$/.test(origin);

  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', isOriginAllowed ? (origin || '*') : 'https://expenses-project-xi.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, Idempotency-Key'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Health check endpoint
  if (req.method === 'GET') {
    const hasEnvResend = Boolean(process.env.Resend_API_KEY || process.env.RESEND_API_KEY);
    const hasEnvBrevo = Boolean(process.env.BREVO_API_KEY || process.env.Brevo_API_KEY);
    const hasEnvGmail = Boolean(process.env.GMAIL_APP_PASSWORD || process.env.GMAIL_PASSWORD);

    return res.status(200).json({
      status: 'ok',
      service: 'expenses-email-dispatcher',
      supportedProviders: ['gmail', 'brevo', 'resend'],
      hasEnvGmailAppPass: hasEnvGmail,
      hasEnvBrevoKey: hasEnvBrevo,
      hasEnvResendKey: hasEnvResend,
      timestamp: new Date().toISOString(),
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Only POST is accepted.' });
  }

  try {
    const parsedBody = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const idToken = bearerToken(req.headers.authorization);
    if (!idToken) {
      return res.status(401).json({ success: false, error: 'unauthenticated' });
    }
    const eventId = typeof parsedBody.eventId === 'string' ? parsedBody.eventId : '';
    const target = typeof parsedBody.to === 'string' ? parsedBody.to.trim().toLowerCase() : '';
    if (!/^[A-Za-z0-9_-]{1,700}$/.test(eventId) || !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(target)) {
      return res.status(400).json({ success: false, error: 'eventId and a single valid recipient email (to) are required' });
    }

    const lookup = await loadOutboxEventAsCaller(eventId, idToken);
    if (!lookup.ok) {
      return res.status(lookup.status).json({ success: false, error: lookup.error });
    }
    const event = lookup.event;
    if (event.channel !== 'email_api') {
      return res.status(422).json({ success: false, error: 'event_is_not_for_email_api' });
    }
    if (event.status !== 'sending') {
      // Only an event claimed by a dispatcher (outbox lease) is delivered.
      return res.status(409).json({ success: false, error: 'event_not_claimed' });
    }
    const eventRecipients: string[] = Array.isArray(event.recipients) ? event.recipients.map((e: any) => String(e).toLowerCase()) : [];
    if (!eventRecipients.includes(target)) {
      return res.status(403).json({ success: false, error: 'recipient_not_in_event' });
    }
    if (Array.isArray(event.deliveredTo) && event.deliveredTo.includes(target)) {
      return res.status(200).json({ success: true, deduplicated: true, recipients: [target] });
    }

    const message = event.message || {};
    const meta = event.meta || {};
    const rawSubject: string = message.subject || '';
    const subject: string = rawSubject.replace(/[\r\n]+/g, ' ').trim();
    const html: string = message.html;
    const text: string = message.text || '';
    const senderName: string = (meta.senderName || 'مصروفي').replace(/[\r\n]+/g, ' ').trim();
    const senderEmail: string = (meta.senderEmail || 'awadhsaudi2030@gmail.com').replace(/[\r\n]+/g, '').trim();
    const replyTo: string = (meta.replyTo || senderEmail).replace(/[\r\n]+/g, '').trim();
    const provider: string = meta.provider || 'auto';
    if (!subject || !html) {
      return res.status(422).json({ success: false, error: 'event_has_no_content' });
    }

    const idempotencyKey = `${eventId}:${target}`;
    const cached = recentDeliveries.get(idempotencyKey);
    if (cached && Date.now() - cached.at <= IDEMPOTENCY_TTL_MS) {
      return res.status(200).json({ ...cached.body, deduplicated: true });
    }
    // Deterministic Message-ID: mail clients collapse copies of the same message.
    const messageId = `<${idempotencyKey.replace(/[^A-Za-z0-9._-]/g, '.').slice(0, 180)}@masrofy.mail>`;
    const sendOk = (body: any) => {
      rememberDelivery(idempotencyKey, body);
      return res.status(200).json(body);
    };
    const recipients = [target];

    // Determine API Key strictly from server-side environment secrets (never trust client payload)
    const activeGmailAppPass = process.env.GMAIL_APP_PASSWORD 
      || process.env.GMAIL_PASSWORD;

    const activeBrevoKey = process.env.BREVO_API_KEY 
      || process.env.Brevo_API_KEY;

    const activeResendKey = process.env.Resend_API_KEY 
      || process.env.RESEND_API_KEY;

    let targetProvider = provider;
    if (targetProvider === 'auto') {
      if (activeGmailAppPass) targetProvider = 'gmail';
      else if (activeBrevoKey) targetProvider = 'brevo';
      else if (activeResendKey) targetProvider = 'resend';
      else targetProvider = 'gmail';
    }

    // -------------------------------------------------------------
    // Provider 0: Official Gmail SMTP (Direct from awadhsaudi2030@gmail.com)
    // -------------------------------------------------------------
    if (targetProvider === 'gmail') {
      const passToUse = activeGmailAppPass;
      if (!passToUse) {
        return res.status(200).json({
          success: false,
          skipped: true,
          error: 'missing_gmail_password',
          provider: 'gmail',
          message: 'كلمة مرور تطبيقات جوجل (Google App Password) غير محددة. يرجى إدخالها في صفحة الإعدادات أو إضافة GMAIL_APP_PASSWORD في Vercel.',
        });
      }

      try {
        const nodemailer = await import('nodemailer');
        const effectiveSender = senderEmail || 'awadhsaudi2030@gmail.com';
        const cleanPassword = String(passToUse).replace(/\s+/g, '');

        const transporter = nodemailer.createTransport({
          host: 'smtp.gmail.com',
          port: 465,
          secure: true,
          auth: {
            user: effectiveSender,
            pass: cleanPassword,
          },
          connectionTimeout: PROVIDER_TIMEOUT_MS,
          greetingTimeout: PROVIDER_TIMEOUT_MS,
          socketTimeout: PROVIDER_TIMEOUT_MS + 5_000,
        });

        const info = await transporter.sendMail({
          from: `"${senderName}" <${effectiveSender}>`,
          to: recipients,
          replyTo: replyTo || effectiveSender,
          subject,
          html,
          text: text || undefined,
          messageId,
        });

        return sendOk({
          success: true,
          provider: 'gmail',
          id: info.messageId,
          recipients,
          message: 'تم إرسال الإيميل بنجاح ومباشرة عبر خوادم Google الرسمية!',
        });
      } catch (gmailErr: any) {
        console.error('[Vercel Serverless Email] Gmail SMTP Error:', gmailErr);
        return res.status(500).json({
          success: false,
          provider: 'gmail',
          error: gmailErr?.message || 'فشل إرسال الإيميل عبر خادم Gmail SMTP',
          details: gmailErr,
        });
      }
    }

    // -------------------------------------------------------------
    // Provider 1: Resend
    // -------------------------------------------------------------
    if (targetProvider === 'resend') {
      const keyToUse = activeResendKey;
      if (!keyToUse) {
        return res.status(200).json({
          success: false,
          skipped: true,
          error: 'missing_api_key',
          provider: 'resend',
          message: 'مفتاح Resend API Key غير محدد. يرجى إدخال المفتاح في صفحة الإعدادات أو إضافة RESEND_API_KEY في Vercel.',
        });
      }

      // Resend: Show official identity awadhsaudi2030@gmail.com and route replies directly to it
      const effectiveSender = senderEmail || 'awadhsaudi2030@gmail.com';
      const effectiveReplyTo = replyTo || effectiveSender;
      const fromAddress = `${senderName} (${effectiveSender}) <onboarding@resend.dev>`;

      const resendRes = await fetchWithTimeout('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${keyToUse.trim()}`,
          'Content-Type': 'application/json',
          // Resend de-duplicates requests carrying the same key for 24h.
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey.slice(0, 256) } : {}),
        },
        body: JSON.stringify({
          from: fromAddress,
          to: recipients,
          subject,
          html,
          text: text || undefined,
          reply_to: effectiveReplyTo,
        }),
      });

      const resendData = await resendRes.json();

      if (!resendRes.ok) {
        console.error('[Vercel Serverless Email] Resend API Error:', resendData);
        let errorMsg = resendData?.message || resendData?.name || 'فشل إرسال الإيميل عبر Resend';
        if (typeof errorMsg === 'string' && errorMsg.includes('You can only send testing emails to your own email address')) {
          errorMsg = `تنبيه: حساب Resend الحالي في الوضع التجريبي المجاني (Sandbox) ويسمح فقط بالإرسال إلى حسابك (${effectiveSender}). للتمكن من إرسال الإيميلات لأي بريد موظف آخر، يرجى تفعيل Brevo (300 إيميل يومياً مجاناً لأي عنوان) أو توثيق دومين في Resend.`;
        }
        return res.status(resendRes.status).json({
          success: false,
          provider: 'resend',
          error: errorMsg,
          rawError: resendData?.message,
          details: resendData,
        });
      }

      return sendOk({
        success: true,
        provider: 'resend',
        id: resendData.id,
        recipients,
        message: 'تم إرسال الإيميل بنجاح إلى صندوق الوارد!',
      });
    }

    // -------------------------------------------------------------
    // Provider 2: Brevo (Sendinblue)
    // -------------------------------------------------------------
    if (targetProvider === 'brevo') {
      const keyToUse = activeBrevoKey;
      if (!keyToUse) {
        return res.status(200).json({
          success: false,
          skipped: true,
          error: 'missing_api_key',
          provider: 'brevo',
          message: 'مفتاح Brevo API Key غير محدد. يرجى إدخال المفتاح في صفحة الإعدادات.',
        });
      }

      const effectiveSender = senderEmail || 'awadhsaudi2030@gmail.com';
      const effectiveReplyTo = replyTo || effectiveSender;

      const brevoRes = await fetchWithTimeout('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': keyToUse.trim(),
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          sender: { name: senderName, email: effectiveSender },
          to: recipients.map((r: string) => ({ email: r })),
          subject,
          htmlContent: html,
          textContent: text || undefined,
          replyTo: { email: effectiveReplyTo },
          ...(messageId ? { headers: { 'Message-Id': messageId, 'X-Idempotency-Key': idempotencyKey } } : {}),
        }),
      });

      const brevoData = await brevoRes.json();

      if (!brevoRes.ok) {
        console.error('[Vercel Serverless Email] Brevo API Error:', brevoData);
        return res.status(brevoRes.status).json({
          success: false,
          provider: 'brevo',
          error: brevoData?.message || 'فشل إرسال الإيميل عبر Brevo',
          details: brevoData,
        });
      }

      return sendOk({
        success: true,
        provider: 'brevo',
        id: brevoData.messageId,
        recipients,
        message: 'تم إرسال الإيميل بنجاح إلى صندوق الوارد عبر Brevo!',
      });
    }

    // Neither key provided
    return res.status(200).json({
      success: false,
      skipped: true,
      error: 'no_provider_configured',
      message: 'لم يتم العثور على مفتاح إرسال (Resend أو Brevo). يرجى إدخال المفتاح المجاني في صفحة الإعدادات.',
    });

  } catch (err: any) {
    console.error('[Vercel Serverless Email] Exception:', err);
    if (err?.timeout) {
      return res.status(504).json({ success: false, error: 'انتهت مهلة الاتصال بمزود البريد. ستتم إعادة المحاولة تلقائياً.' });
    }
    return res.status(500).json({
      success: false,
      error: err?.message || 'Internal Server Error',
    });
  }
}
