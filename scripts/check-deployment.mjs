import { parseEnv } from 'node:util';
import { readFileSync } from 'node:fs';

export function checkDeployment(env) {
  const errors = [];
  if (env.NODE_ENV !== 'production') errors.push('NODE_ENV must be production');
  for (const key of ['DATABASE_URL', 'REDIS_URL', 'AZURE_STORAGE_CONNECTION_STRING']) {
    if (!env[key]?.trim()) errors.push(`${key} is required`);
  }
  const resendConfigured = Boolean(env.RESEND_API_KEY?.trim());
  const smtpValues = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'].map(key => env[key]?.trim());
  const smtpConfigured = smtpValues.every(Boolean);
  if (!resendConfigured && !smtpConfigured) errors.push('RESEND_API_KEY or a complete SMTP configuration is required');
  if (!resendConfigured && smtpValues.some(Boolean) && !smtpConfigured) errors.push('SMTP_HOST, SMTP_USER and SMTP_PASS must all be set when using SMTP');
  if (resendConfigured && !env.EMAIL_FROM?.trim()) errors.push('EMAIL_FROM is required when using Resend');
  for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'CRON_SECRET']) {
    if ((env[key]?.length ?? 0) < 32 || /your-|change-in-production/i.test(env[key] ?? '')) {
      errors.push(`${key} must contain a non-placeholder secret of at least 32 characters`);
    }
  }
  if (env.JWT_SECRET === env.JWT_REFRESH_SECRET) errors.push('JWT secrets must be different');
  if ((env.AUTH_OTP_SECRET?.length ?? 0) < 32 || /your-|replace-|change-in-production/i.test(env.AUTH_OTP_SECRET ?? '')) {
    errors.push('AUTH_OTP_SECRET must be a non-placeholder random secret of at least 32 characters');
  }
  if (env.AUTH_OTP_SECRET && [env.JWT_SECRET, env.JWT_REFRESH_SECRET].includes(env.AUTH_OTP_SECRET)) {
    errors.push('AUTH_OTP_SECRET must be independent of JWT secrets');
  }
  for (const key of ['FRONTEND_URL', 'ADMIN_FRONTEND_URL', 'BACKEND_PUBLIC_URL']) {
    try {
      const url = new URL(env[key]);
      if (url.protocol !== 'https:' || /(^localhost$|^127\.|\.trycloudflare\.com$|\.example$|\.invalid$)/.test(url.hostname) ||
          url.username || url.password || url.search || url.hash || env[key].endsWith('/')) throw new Error();
    } catch { errors.push(`${key} must be the permanent HTTPS URL, without a trailing slash, query, or credentials`); }
  }
  if (!env.CORS_ALLOWED_ORIGINS?.trim()) errors.push('CORS_ALLOWED_ORIGINS must list the exact frontend and admin origins');
  if (env.CSRF_ENABLED === 'false') errors.push('CSRF_ENABLED must not be false in production');
  for (const provider of ['GOOGLE', 'GITHUB']) {
    if (env[`${provider}_CLIENT_ID`]) {
      if (!env[`${provider}_CLIENT_SECRET`]) errors.push(`${provider}_CLIENT_SECRET is required`);
      const expected = `${env.BACKEND_PUBLIC_URL}/api/auth/${provider.toLowerCase()}/callback`;
      if (env[`${provider}_REDIRECT_URI`] && env[`${provider}_REDIRECT_URI`] !== expected) {
        errors.push(`${provider}_REDIRECT_URI must match BACKEND_PUBLIC_URL plus /api/auth/${provider.toLowerCase()}/callback`);
      }
    }
  }
  if (env.RAZORPAY_KEY_ID || env.RAZORPAY_KEY_SECRET) {
    if (env.RAZORPAY_KEY_ID?.startsWith('rzp_test_')) {
      errors.push('RAZORPAY_KEY_ID is a test key; use live gateway credentials before accepting real payments');
    }
    for (const key of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET']) {
      if (!env[key]) errors.push(`${key} is required when Razorpay is configured`);
    }
  }
  if (env.ZOHO_PAYMENTS_ACCOUNT_ID) {
    for (const suffix of ['CLIENT_ID', 'CLIENT_SECRET', 'REFRESH_TOKEN', 'SIGNING_KEY', 'WEBHOOK_SIGNING_KEY']) {
      if (!env[`ZOHO_PAYMENTS_${suffix}`]) errors.push(`ZOHO_PAYMENTS_${suffix} is required when Zoho Payments is configured`);
    }
  }
  if (env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || env.WHATSAPP_APP_SECRET) {
    for (const key of ['WHATSAPP_WEBHOOK_VERIFY_TOKEN', 'WHATSAPP_APP_SECRET']) {
      if (!env[key]) errors.push(`${key} is required when the WhatsApp webhook is configured`);
    }
  }
  if (env.WHATSAPP_OTP_ENABLED === 'true') {
    if (!env.WHATSAPP_ACCESS_TOKEN?.trim()) errors.push('WHATSAPP_ACCESS_TOKEN is required for OTP');
    if (!/^\d+$/.test(env.WHATSAPP_PHONE_NUMBER_ID ?? '')) errors.push('WHATSAPP_PHONE_NUMBER_ID must be the sending phone-number ID');
    if (!/^v\d+\.\d+$/.test(env.WHATSAPP_API_VERSION ?? '')) errors.push('WHATSAPP_API_VERSION must be an explicit supported Graph API version');
    if (!/^[a-z0-9_]+$/.test(env.WHATSAPP_AUTH_TEMPLATE_NAME ?? '')) errors.push('WHATSAPP_AUTH_TEMPLATE_NAME must be an approved authentication template name');
  }
  return errors;
}

if (process.argv[1]?.endsWith('check-deployment.mjs')) {
  const file = process.argv[2];
  const env = file ? parseEnv(readFileSync(file, 'utf8')) : process.env;
  const errors = checkDeployment(env);
  for (const error of errors) console.error(error);
  if (!errors.length) console.info('Production environment checks passed (credential validity and migrations still require verification).');
  process.exitCode = errors.length ? 1 : 0;
}
