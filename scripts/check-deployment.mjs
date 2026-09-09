import { parseEnv } from 'node:util';
import { readFileSync } from 'node:fs';

export function checkDeployment(env) {
  const errors = [];
  if (env.NODE_ENV !== 'production') errors.push('NODE_ENV must be production');
  for (const key of ['DATABASE_URL', 'REDIS_URL', 'AZURE_STORAGE_CONNECTION_STRING', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']) {
    if (!env[key]?.trim()) errors.push(`${key} is required`);
  }
  for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'CRON_SECRET']) {
    if ((env[key]?.length ?? 0) < 32 || /your-|change-in-production/i.test(env[key] ?? '')) {
      errors.push(`${key} must contain a non-placeholder secret of at least 32 characters`);
    }
  }
  if (env.JWT_SECRET === env.JWT_REFRESH_SECRET) errors.push('JWT secrets must be different');
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
