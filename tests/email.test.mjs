import { test, after } from 'node:test';
import assert from 'node:assert/strict';

Object.assign(process.env, {
  NODE_ENV: 'test',
  RESEND_API_KEY: 're_test_never_real',
  EMAIL_FROM: 'noreply@mail.roboroot.in',
  EMAIL_FROM_NAME: 'RoboRoot',
});

const requests = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  assert.equal(String(url), 'https://api.resend.com/emails');
  requests.push({ headers: options.headers, payload: JSON.parse(options.body) });
  return new Response(JSON.stringify({ id: 'resend-test-message' }), { status: 200 });
};

const { sendEmail, emailDeliveryConfigured } = await import('../dist/services/email.service.js');
const { getEmailTemplate } = await import('../dist/utils/email-templates.js');

after(() => {
  globalThis.fetch = originalFetch;
});

test('Resend delivery uses the configured RoboRoot sender and keeps the credential out of content', async () => {
  assert.equal(emailDeliveryConfigured(), true);
  const result = await sendEmail('shopper@example.invalid', 'Verify', '<p>Verify</p>', 'Verify');
  assert.equal(result.messageId, 'resend-test-message');
  const request = requests.at(-1);
  assert.equal(request.payload.from, 'RoboRoot <noreply@mail.roboroot.in>');
  assert.deepEqual(request.payload.to, ['shopper@example.invalid']);
  assert.equal(request.headers.Authorization, 'Bearer re_test_never_real');
  assert.equal(JSON.stringify(request.payload).includes('re_test_never_real'), false);
});

test('verification template renders a six-digit code without a verification link', () => {
  const template = getEmailTemplate('USER_EMAIL_VERIFICATION', {
    user: { name: 'shopper@example.invalid' },
    verificationCode: '482913',
    expiresIn: '10 minutes',
  });
  assert(template.html.includes('482913'));
  assert(template.text.includes('482913'));
  assert(template.text.includes('10 minutes'));
  assert.equal(template.html.includes('/verify-email?token='), false);
});
