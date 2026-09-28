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
  const isOriginAllowed = !origin || allowedOrigins.includes(origin) || origin.endsWith('.vercel.app');

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
    const {
      to,
      subject,
      html,
      text,
      senderName = 'مصروفي',
      senderEmail = 'awadhsaudi2030@gmail.com',
      replyTo = 'awadhsaudi2030@gmail.com',
      provider = 'auto',
    } = parsedBody;

    const headerKey = req.headers['idempotency-key'];
    const idempotencyKey: string | undefined =
      (typeof headerKey === 'string' && headerKey) || (typeof parsedBody.idempotencyKey === 'string' && parsedBody.idempotencyKey) || undefined;
    if (idempotencyKey && !/^[A-Za-z0-9:_@.\-]{8,300}$/.test(idempotencyKey)) {
      return res.status(400).json({ success: false, error: 'Invalid Idempotency-Key' });
    }
    const cached = idempotencyKey ? recentDeliveries.get(idempotencyKey) : undefined;
    if (cached && Date.now() - cached.at <= IDEMPOTENCY_TTL_MS) {
      return res.status(200).json({ ...cached.body, deduplicated: true });
    }
    // Deterministic Message-ID: mail clients collapse copies of the same message.
    const messageId = idempotencyKey
      ? `<${idempotencyKey.replace(/[^A-Za-z0-9._-]/g, '.').slice(0, 180)}@masrofy.mail>`
      : undefined;
    const sendOk = (body: any) => {
      rememberDelivery(idempotencyKey, body);
      return res.status(200).json(body);
    };

    if (!to || (Array.isArray(to) && to.length === 0)) {
      return res.status(400).json({ error: 'Missing required recipient: to' });
    }

    if (!subject || !html) {
      return res.status(400).json({ error: 'Missing required email content: subject or html' });
    }

    const recipients = (Array.isArray(to) ? to : [to])
      .map((e: string) => (e || '').trim().toLowerCase())
      .filter((e: string) => e && e.includes('@'));

    if (recipients.length === 0) {
      return res.status(400).json({ error: 'No valid recipient email address provided.' });
    }

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
