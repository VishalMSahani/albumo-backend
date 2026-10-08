import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { sendWhatsAppOtp, whatsappOtpAvailable } from '../src/features/whatsapp/whatsapp-otp.service.ts';

const originalFetch = globalThis.fetch;
const original = Object.fromEntries(['NODE_ENV', 'VERCEL', 'JWT_REFRESH_SECRET', 'AUTH_OTP_SECRET', 'WHATSAPP_OTP_ENABLED', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_AUTH_TEMPLATE_NAME', 'WHATSAPP_AUTH_TEMPLATE_LANGUAGE', 'WHATSAPP_API_VERSION'].map(key => [key, process.env[key]]));
let request;
before(() => {
  Object.assign(process.env, {
    NODE_ENV: 'test', VERCEL: '', JWT_REFRESH_SECRET: 'test-refresh-secret-'.repeat(4), AUTH_OTP_SECRET: 'test-otp-secret-'.repeat(4),
    WHATSAPP_OTP_ENABLED: 'true', WHATSAPP_ACCESS_TOKEN: 'test-token-never-real', WHATSAPP_PHONE_NUMBER_ID: '123456789',
    WHATSAPP_AUTH_TEMPLATE_NAME: 'roboroot_authentication', WHATSAPP_AUTH_TEMPLATE_LANGUAGE: 'en_US', WHATSAPP_API_VERSION: 'v25.0',
  });
  globalThis.fetch = async (url, options) => { request = { url: String(url), options, body: JSON.parse(options.body) }; return new Response(JSON.stringify({ messages: [{ id: 'wamid.test' }] }), { status: 200 }); };
});
after(() => { globalThis.fetch = originalFetch; for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });

test('availability requires the complete, well-formed backend-only configuration', () => {
  assert.equal(whatsappOtpAvailable(), true);
  for (const [key, invalid] of [['WHATSAPP_OTP_ENABLED', 'false'], ['WHATSAPP_PHONE_NUMBER_ID', '+91123'], ['WHATSAPP_AUTH_TEMPLATE_NAME', 'Bad Name'], ['WHATSAPP_AUTH_TEMPLATE_LANGUAGE', 'english'], ['WHATSAPP_API_VERSION', 'latest']]) {
    const value = process.env[key]; process.env[key] = invalid; assert.equal(whatsappOtpAvailable(), false, key); process.env[key] = value;
  }
});
test('OTP send uses a Meta authentication template and never returns or logs the code', async () => {
  await sendWhatsAppOtp('+919876543210', '429017');
  assert.equal(request.url, 'https://graph.facebook.com/v25.0/123456789/messages');
  assert.equal(request.options.headers.Authorization, 'Bearer test-token-never-real');
  assert.deepEqual(request.body, {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: '919876543210', type: 'template',
    template: { name: 'roboroot_authentication', language: { code: 'en_US' }, components: [
      { type: 'body', parameters: [{ type: 'text', text: '429017' }] },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '429017' }] },
    ] },
  });
});
test('provider rejection returns a generic delivery error without provider body or OTP', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 132001, message: 'secret provider detail' } }), { status: 400 });
  await assert.rejects(sendWhatsAppOtp('+919876543210', '429017'), error => error.code === 'OTP_DELIVERY_FAILED' && !error.message.includes('429017') && !error.message.includes('secret provider detail'));
});
