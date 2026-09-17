/**
 * Serverless API handler for dispatching emails directly to real email inboxes.
 * Supports:
 * 1. Resend API (Free 3,000 emails/month, zero credit card)
 * 2. Brevo API (Free 300 emails/day)
 * 3. Fallback and direct health check
 */
export default async function handler(req: any, res: any) {
  // CORS configuration
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Health check endpoint
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'ok',
      service: 'expenses-email-dispatcher',
      supportedProviders: ['resend', 'brevo'],
      hasEnvResendKey: Boolean(process.env.Resend_API_KEY || process.env.RESEND_API_KEY || process.env.resend_api_key || process.env.VITE_RESEND_API_KEY),
      hasEnvBrevoKey: Boolean(process.env.BREVO_API_KEY || process.env.Brevo_API_KEY || process.env.brevo_api_key || process.env.VITE_BREVO_API_KEY),
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
      apiKey,
    } = parsedBody;

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

    // Determine API Key and Provider
    const activeResendKey = (apiKey && apiKey.startsWith('re_') ? apiKey : null) 
      || process.env.Resend_API_KEY 
      || process.env.RESEND_API_KEY 
      || process.env.resend_api_key 
      || process.env.VITE_RESEND_API_KEY;

    const activeBrevoKey = (apiKey && apiKey.startsWith('xkeysib-') ? apiKey : null) 
      || process.env.BREVO_API_KEY 
      || process.env.Brevo_API_KEY 
      || process.env.brevo_api_key 
      || process.env.VITE_BREVO_API_KEY;

    let targetProvider = provider;
    if (targetProvider === 'auto') {
      if (activeResendKey) targetProvider = 'resend';
      else if (activeBrevoKey) targetProvider = 'brevo';
      else if (apiKey) targetProvider = 'resend'; // Default guess
    }

    // -------------------------------------------------------------
    // Provider 1: Resend
    // -------------------------------------------------------------
    if (targetProvider === 'resend') {
      const keyToUse = activeResendKey || apiKey;
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

      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${keyToUse.trim()}`,
          'Content-Type': 'application/json',
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

      return res.status(200).json({
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
      const keyToUse = activeBrevoKey || apiKey;
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

      const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
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

      return res.status(200).json({
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
    return res.status(500).json({
      success: false,
      error: err?.message || 'Internal Server Error',
    });
  }
}
