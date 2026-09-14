import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, randomInt } from 'node:crypto';

// Refuse ambient DATABASE_URL and all non-local databases. No real providers are contacted.
const target = new URL(process.env.AUTH_TEST_DATABASE_URL || 'http://missing.invalid');
assert.equal(target.protocol, 'postgresql:', 'Set AUTH_TEST_DATABASE_URL to an isolated PostgreSQL test database');
assert(['127.0.0.1', 'localhost'].includes(target.hostname));
assert.equal(target.pathname, '/roboroot_auth_test', 'Refusing a database not explicitly named roboroot_auth_test');
Object.assign(process.env, {
  DATABASE_URL: target.href, DOTENV_CONFIG_PATH: '__no_auth_test_env__',
  NODE_ENV: 'test', VERCEL: '', REDIS_URL: '', SENTRY_DSN: '', SMTP_HOST: '', RESEND_API_KEY: '', EMAIL_FROM: '',
  JWT_SECRET: 'test-access-secret-'.repeat(4), JWT_REFRESH_SECRET: 'test-refresh-secret-'.repeat(4),
  AUTH_OTP_SECRET: 'test-otp-secret-'.repeat(4), CSRF_ENABLED: 'true',
  WHATSAPP_OTP_ENABLED: 'true', WHATSAPP_ACCESS_TOKEN: 'test-token-never-real',
  WHATSAPP_PHONE_NUMBER_ID: '123456789', WHATSAPP_AUTH_TEMPLATE_NAME: 'test_auth_code',
  WHATSAPP_API_VERSION: 'v25.0', FRONTEND_URL: 'https://store.example.invalid',
});
const { prisma } = await import('../dist/lib/prisma.js');
const { issueSession, rotateSession, parseRefreshToken, revokeSession, requireRecentAuthentication } = await import('../dist/services/session-auth.service.js');
const { requestPhoneCode, verifyPhoneCode, completePhoneSignup, startPhoneAuth } = await import('../dist/services/phone-auth.service.js');
const { loginWithEmail, signupWithEmail, setBackupPassword } = await import('../dist/services/auth.service.js');
const { requestPasswordReset, resetPassword } = await import('../dist/services/password-reset.service.js');
const { verifyEmailOtp, verifyEmailToken, resendVerificationEmail } = await import('../dist/services/email-verification.service.js');
const { sendEmail } = await import('../dist/services/email.service.js');
const { hashPassword, comparePassword } = await import('../dist/utils/password.js');
const { hashToken, otpDigest, safeRedirect, SESSION_SECONDS, ACCESS_SECONDS } = await import('../dist/utils/auth-security.js');
const { verifyAccessToken } = await import('../dist/utils/jwt.js');
const { sendAuthResponse, cookieOptions } = await import('../dist/utils/auth-cookies.js');
const { phoneSchema, signupSchema, otpVerifySchema } = await import('../dist/validators/auth.validator.js');
const { LEGAL_POLICY_VERSION } = await import('../dist/features/legal/legal.constants.js');
const { limitAuth } = await import('../dist/services/auth-throttle.service.js');
const { authenticate } = await import('../dist/middlewares/auth.middleware.js');
const { beginOAuth, validateOAuthState } = await import('../dist/services/oauth.service.js');
const { csrfTokenHandler, csrfProtection } = await import('../dist/middlewares/csrf.middleware.js');
const { default: authRoutes } = await import('../dist/routes/authRoutes.js');
const { errorHandler } = await import('../dist/middlewares/error.middleware.js');
const { default: express } = await import('express');
const { default: cookieParser } = await import('cookie-parser');

const legal = { accepted: true, policyVersion: LEGAL_POLICY_VERSION };
const password = 'Test-only-password-93!';
const passwordHash = await hashPassword(password);
const audit = () => ({ ipAddress: 'test-' + randomUUID(), userAgent: 'isolated-auth-test' });
let phoneCounter = randomInt(6000000000, 8999999000);
const phone = () => '+91' + (++phoneCounter);
const user = (data = {}) => prisma.user.create({ data: {
  email: randomUUID() + '@example.invalid', emailVerified: true, name: 'Auth Test',
  credential: { create: { passwordHash } }, ...data,
} });
async function challenge(number, data = {}) {
  const id = randomUUID(), code = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
  await prisma.authChallenge.create({ data: { id, phone: number, purpose: 'login', codeHash: otpDigest(id, code), deliveredAt: new Date(), expiresAt: new Date(Date.now() + 300000), ...data } });
  return { id, code };
}
const sent = [];
const sentEmails = [];
let rejectProvider = false;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const dest = new URL(String(url));
  if (dest.hostname === '127.0.0.1') return originalFetch(url, options);
  if (dest.origin === 'https://api.resend.com') {
    sentEmails.push({ headers: options.headers, payload: JSON.parse(options.body) });
    return new Response(JSON.stringify({ id: 'resend-test-message' }), { status: 200 });
  }
  assert.equal(dest.origin, 'https://graph.facebook.com', 'Unexpected external request blocked');
  const payload = JSON.parse(options.body);
  sent.push(payload);
  return new Response(JSON.stringify(rejectProvider ? { error: { code: 132001 } } : { messages: [{ id: 'wamid.test' }] }), { status: rejectProvider ? 400 : 200 });
};
after(async () => { globalThis.fetch = originalFetch; await prisma.$disconnect(); });

test('validators normalize Indian phone numbers, require legal acceptance and exactly six OTP digits', () => {
  for (const input of ['9000000000', '+91 90000 00000', '919000000000']) assert.equal(phoneSchema.parse(input), '+919000000000');
  for (const input of ['123', '+12025550123', 'abc9000000000']) assert.equal(phoneSchema.safeParse(input).success, false);
  assert.equal(signupSchema.safeParse({ email: 'test@example.invalid', password }).success, false);
  assert.equal(otpVerifySchema.safeParse({ challengeId: randomUUID(), code: '1e0000', legalConsent: legal }).success, false);
});
test('redirects cannot leave the storefront origin', () => {
  for (const value of ['https://evil.invalid', '//evil.invalid', '/\\evil.invalid', '/\nevil.invalid']) assert.equal(safeRedirect(value), '/');
  assert.equal(safeRedirect('/checkout?source=cart'), '/checkout?source=cart');
});
test('15-day absolute sessions, short access tokens, hashed refresh storage and concurrent rotation', async () => {
  const auth = await issueSession(await user(), audit());
  const decoded = verifyAccessToken(auth.accessToken);
  const claims = JSON.parse(Buffer.from(auth.accessToken.split('.')[1], 'base64url').toString());
  assert.equal(claims.exp - claims.iat, ACCESS_SECONDS);
  assert(Math.abs(Date.parse(auth.sessionExpiresAt) - Date.now() - SESSION_SECONDS * 1000) < 3000);
  const stored = await prisma.session.findUniqueOrThrow({ where: { id: decoded.sessionId } });
  assert.equal(stored.token, hashToken(auth.refreshToken));
  const rotations = await Promise.all(Array.from({ length: 6 }, () => rotateSession(auth.refreshToken)));
  assert.equal(new Set(rotations.map(value => value.refreshToken)).size, 1);
  assert.equal(rotations[0].sessionExpiresAt, auth.sessionExpiresAt);
  assert.notEqual(rotations[0].refreshToken, auth.refreshToken);
});
test('refresh replay outside the concurrency grace period revokes the session family', async () => {
  const auth = await issueSession(await user());
  const next = await rotateSession(auth.refreshToken);
  const { id } = parseRefreshToken(auth.refreshToken);
  await prisma.session.update({ where: { id }, data: { rotatedAt: new Date(Date.now() - 11000) } });
  await assert.rejects(rotateSession(auth.refreshToken), /Session expired/);
  assert((await prisma.session.findUniqueOrThrow({ where: { id } })).revokedAt);
  await assert.rejects(rotateSession(next.refreshToken));
});
test('tampered, expired and disabled-account sessions are rejected', async () => {
  const account = await user(), auth = await issueSession(account);
  const { id } = parseRefreshToken(auth.refreshToken);
  await assert.rejects(rotateSession(auth.refreshToken + 'x'));
  await prisma.user.update({ where: { id: account.id }, data: { isActive: false } });
  await assert.rejects(rotateSession(auth.refreshToken));
  await prisma.user.update({ where: { id: account.id }, data: { isActive: true } });
  await prisma.session.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1) } });
  await assert.rejects(rotateSession(auth.refreshToken));
});
test('revoked sessions fail access-token middleware immediately', async () => {
  const auth = await issueSession(await user());
  await revokeSession(auth.refreshToken);
  let status, passed = false;
  await authenticate({ headers: {}, cookies: { accessToken: auth.accessToken } },
    { status(value) { status = value; return this; }, json() {} }, () => { passed = true; });
  assert.equal(status, 401); assert.equal(passed, false);
});
test('responses expose no bearer secrets and production cookies are Secure and HttpOnly', async () => {
  const auth = await issueSession(await user()), cookies = [];
  let body;
  process.env.VERCEL = '1';
  const res = { clearCookie() {}, cookie(name, value, options) { cookies.push({ name, value, options }); },
    status() { return this; }, json(value) { body = value; } };
  sendAuthResponse(res, auth);
  assert.equal(body.data.accessToken, undefined); assert.equal(body.data.refreshToken, undefined);
  for (const item of cookies) { assert.equal(item.options.secure, true); assert.equal(item.options.httpOnly, true); assert.equal(item.options.domain, undefined); }
  assert.equal(cookies.find(c => c.name === 'refreshToken').options.path, '/api/auth');
  process.env.VERCEL = '';
  assert.equal(cookieOptions().secure, false);
});
test('WhatsApp requests use approved authentication template parameters without disclosing the OTP', async () => {
  const number = phone(), response = await requestPhoneCode(number, audit()), payload = sent.at(-1);
  assert.equal(response.code, undefined);
  assert.equal(payload.template.name, 'test_auth_code');
  assert.equal(payload.to, number.slice(1));
  assert.equal(payload.template.components[0].parameters[0].text, payload.template.components[1].parameters[0].text);
  const stored = await prisma.authChallenge.findUniqueOrThrow({ where: { id: response.challengeId } });
  assert.equal(stored.codeHash, otpDigest(response.challengeId, payload.template.components[0].parameters[0].text));
  await assert.rejects(requestPhoneCode(number, audit()), /Too many/);
});
test('unconfigured/rejected WhatsApp delivery fails closed with no usable challenge', async () => {
  process.env.WHATSAPP_OTP_ENABLED = 'false';
  await assert.rejects(requestPhoneCode(phone(), audit()), /not available/);
  process.env.WHATSAPP_OTP_ENABLED = 'true';
  rejectProvider = true;
  const number = phone();
  await assert.rejects(requestPhoneCode(number, audit()), /could not send/);
  rejectProvider = false;
  const stored = await prisma.authChallenge.findFirstOrThrow({ where: { phone: number } });
  assert(stored.consumedAt); assert.equal(stored.deliveredAt, null);
});
test('mobile start uses password/signup fallback only while WhatsApp OTP is unavailable', async () => {
  const existingPhone = phone();
  await user({ phone: existingPhone, phoneVerifiedAt: new Date() });
  process.env.WHATSAPP_OTP_ENABLED = 'false';
  assert.equal((await startPhoneAuth(existingPhone, audit())).kind, 'password');
  assert.equal((await startPhoneAuth(phone(), audit())).kind, 'signup');
  process.env.WHATSAPP_OTP_ENABLED = 'true';
  assert.equal((await startPhoneAuth(phone(), audit())).kind, 'otp');
});
test('a registered pending mobile uses password fallback and is promoted after WhatsApp verification', async () => {
  const pendingPhone = phone();
  const account = await user({ pendingPhone });
  process.env.WHATSAPP_OTP_ENABLED = 'false';
  assert.equal((await startPhoneAuth(pendingPhone, audit())).kind, 'password');
  assert.equal((await loginWithEmail({ email: pendingPhone, password }, audit())).user.id, account.id);
  process.env.WHATSAPP_OTP_ENABLED = 'true';
  const started = await startPhoneAuth(pendingPhone, audit());
  assert.equal(started.kind, 'otp');
  const whatsappCode = sent.at(-1).template.components[0].parameters[0].text;
  const verified = await verifyPhoneCode(started.challengeId, whatsappCode, legal, audit());
  assert.equal(verified.kind, 'authenticated');
  const updated = await prisma.user.findUniqueOrThrow({ where: { id: account.id } });
  assert.equal(updated.phone, pendingPhone);
  assert.equal(updated.pendingPhone, null);
  assert(updated.phoneVerifiedAt);
});
test('WhatsApp provider downtime sends registered users to password login and never back to signup', async () => {
  const number = phone();
  await user({ pendingPhone: number });
  rejectProvider = true;
  try {
    assert.equal((await startPhoneAuth(number, audit())).kind, 'password');
    assert.equal((await startPhoneAuth(phone(), audit())).kind, 'signup');
  } finally { rejectProvider = false; }
});
test('a disabled registered mobile is not offered signup and cannot log in', async () => {
  const number = phone();
  await user({ pendingPhone: number, isActive: false });
  process.env.WHATSAPP_OTP_ENABLED = 'false';
  try {
    assert.equal((await startPhoneAuth(number, audit())).kind, 'password');
    await assert.rejects(loginWithEmail({ email: number, password }, audit()));
  } finally { process.env.WHATSAPP_OTP_ENABLED = 'true'; }
});
test('a mobile login reveals the email-verification step only after the correct password', async () => {
  const number = phone(), account = await user({ pendingPhone: number, emailVerified: false });
  await assert.rejects(loginWithEmail({ email: number, password: 'wrong' }, audit()), error => {
    assert.equal(error.statusCode, 401); assert.equal(error.email, undefined); return true;
  });
  await assert.rejects(loginWithEmail({ email: number, password }, audit()), error => {
    assert.equal(error.code, 'VERIFICATION_REQUIRED'); assert.equal(error.email, account.email); return true;
  });
});
test('OTP wrong attempts are persisted and a locked code cannot be used even with the correct digits', async () => {
  const c = await challenge(phone()), wrong = c.code === '000000' ? '111111' : '000000', context = audit();
  for (let i = 0; i < 5; i++) await assert.rejects(verifyPhoneCode(c.id, wrong, legal, context), /incorrect or expired/);
  assert.equal((await prisma.authChallenge.findUniqueOrThrow({ where: { id: c.id } })).attempts, 5);
  await assert.rejects(verifyPhoneCode(c.id, c.code, legal, context));
});
test('expired and undelivered OTPs cannot authenticate', async () => {
  for (const data of [{ expiresAt: new Date(Date.now() - 1) }, { deliveredAt: null }]) {
    const c = await challenge(phone(), data);
    await assert.rejects(verifyPhoneCode(c.id, c.code, legal, audit()));
  }
});
test('concurrent OTP verification creates one session, and replay fails', async () => {
  const number = phone(), account = await user({ phone: number, phoneVerifiedAt: new Date() }), c = await challenge(number);
  const results = await Promise.allSettled([1, 2].map(() => verifyPhoneCode(c.id, c.code, legal, audit())));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(await prisma.session.count({ where: { userId: account.id } }), 1);
});
test('new phone signup requires one-time phone proof and verifies email ownership separately', async () => {
  const number = phone(), c = await challenge(number);
  const proof = await verifyPhoneCode(c.id, c.code, legal, audit());
  assert.equal(proof.kind, 'signup');
  const input = { registrationToken: proof.registrationToken, name: 'New Shopper', email: randomUUID() + '@example.invalid', password, legalConsent: legal };
  const auth = await completePhoneSignup(input, audit());
  assert.equal(auth.user.phoneVerified, true); assert.equal(auth.user.emailVerified, false);
  assert(await prisma.emailCredential.findUnique({ where: { userId: auth.user.id } }));
  await assert.rejects(completePhoneSignup(input, audit()));
});
test('phone proof never silently takes over an existing email account', async () => {
  const existing = await user(), c = await challenge(phone()), proof = await verifyPhoneCode(c.id, c.code, legal, audit());
  await assert.rejects(completePhoneSignup({ registrationToken: proof.registrationToken, email: existing.email, name: 'Attacker', password, legalConsent: legal }, audit()), /existing account/);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: existing.id } })).phone, null);
});
test('phone linking is account-bound and changing another verified number is rejected', async () => {
  const account = await user(), another = await user(), number = phone(), c = await challenge(number, { purpose: 'link', userId: account.id });
  await assert.rejects(verifyPhoneCode(c.id, c.code, legal, audit(), another.id));
  const linked = await verifyPhoneCode(c.id, c.code, legal, audit(), account.id);
  assert.equal(linked.kind, 'linked'); assert.equal(linked.user.phoneVerified, true);
  const c2 = await challenge(phone(), { purpose: 'link', userId: account.id });
  await assert.rejects(verifyPhoneCode(c2.id, c2.code, legal, audit(), account.id), /support/);
});
test('admin accounts cannot be authenticated by WhatsApp alone', async () => {
  const number = phone(); await user({ phone: number, phoneVerifiedAt: new Date(), role: 'ADMIN' });
  const c = await challenge(number);
  await assert.rejects(verifyPhoneCode(c.id, c.code, legal, audit()), /admin password/);
});
test('email signup grants no session until a short-lived email OTP unlocks password login', async () => {
  const email = randomUUID() + '@example.invalid';
  const pending = await signupWithEmail({ name: 'Email Test', email, password, legalConsent: legal }, audit());
  assert.equal(pending.verificationRequired, true);
  const account = await prisma.user.findUniqueOrThrow({ where: { email } });
  assert.equal(await prisma.session.count({ where: { userId: account.id } }), 0);
  await assert.rejects(loginWithEmail({ email, password }, audit()), /Verify your email/);
  assert.equal(await prisma.emailNotification.count({ where: { userId: account.id, eventType: 'USER_EMAIL_VERIFICATION' } }), 0);
  process.env.RESEND_API_KEY = 're_test_never_real';
  process.env.EMAIL_FROM = 'noreply@mail.roboroot.in';
  try { await resendVerificationEmail(email); }
  finally { process.env.RESEND_API_KEY = ''; process.env.EMAIL_FROM = ''; }
  const notification = await prisma.emailNotification.findFirstOrThrow({ where: { userId: account.id, eventType: 'USER_EMAIL_VERIFICATION' } });
  const emailCode = sentEmails.at(-1).payload.text.match(/\b\d{6}\b/)[0];
  const challenged = await prisma.user.findUniqueOrThrow({ where: { id: account.id } });
  assert.equal(challenged.emailVerifyToken, otpDigest(account.id, emailCode));
  assert.deepEqual(notification.metadata, {});
  assert.equal(notification.subject.includes(emailCode), false);
  assert.equal(notification.body, 'Authentication email delivered.');
  await verifyEmailOtp(email, emailCode);
  assert.equal((await loginWithEmail({ email, password }, audit())).user.emailVerified, true);
  await assert.rejects(signupWithEmail({ name: 'Duplicate', email, password, legalConsent: legal }, audit()), /already exists/);
});
test('a stored email OTP digest cannot be used as a legacy verification link', async () => {
  const account = await user({ emailVerified: false });
  const digest = otpDigest(account.id, '123456');
  await prisma.user.update({ where: { id: account.id }, data: { emailVerifyToken: digest, emailVerifyExpiry: new Date(Date.now() + 600000) } });
  await assert.rejects(verifyEmailToken(digest));
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: account.id } })).emailVerified, false);
  await verifyEmailOtp(account.email, '123456');
});
test('five incorrect email OTP attempts lock the challenge even if the correct code is later supplied', async () => {
  const account = await user({ emailVerified: false });
  process.env.RESEND_API_KEY = 're_test_never_real';
  process.env.EMAIL_FROM = 'noreply@mail.roboroot.in';
  try { await resendVerificationEmail(account.email); }
  finally { process.env.RESEND_API_KEY = ''; process.env.EMAIL_FROM = ''; }
  const emailCode = sentEmails.at(-1).payload.text.match(/\b\d{6}\b/)[0];
  const wrong = emailCode === '000000' ? '111111' : '000000';
  for (let attempt = 0; attempt < 5; attempt++) await assert.rejects(verifyEmailOtp(account.email, wrong), /incorrect or expired/);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: account.id } })).emailVerifyAttempts, 5);
  await assert.rejects(verifyEmailOtp(account.email, emailCode), /incorrect or expired/);
});
test('Resend delivery uses the configured RoboRoot sender without exposing the API key in content', async () => {
  process.env.RESEND_API_KEY = 're_test_never_real';
  process.env.EMAIL_FROM = 'noreply@mail.roboroot.in';
  try {
    const result = await sendEmail('shopper@example.invalid', 'Verify', '<p>Verify</p>', 'Verify');
    assert.equal(result.messageId, 'resend-test-message');
    const request = sentEmails.at(-1);
    assert.equal(request.payload.from, 'RoboRoot <noreply@mail.roboroot.in>');
    assert.deepEqual(request.payload.to, ['shopper@example.invalid']);
    assert.equal(request.headers.Authorization, 'Bearer re_test_never_real');
    assert.equal(JSON.stringify(request.payload).includes('re_test_never_real'), false);
  } finally {
    process.env.RESEND_API_KEY = '';
    process.env.EMAIL_FROM = '';
  }
});
test('OTP-unavailable signup remembers a pending phone without treating it as verified', async () => {
  const email = randomUUID() + '@example.invalid', pendingPhone = phone();
  await signupWithEmail({ name: 'Pending Phone', email, phone: pendingPhone, password, legalConsent: legal }, audit());
  const account = await prisma.user.findUniqueOrThrow({ where: { email } });
  assert.equal(account.pendingPhone, pendingPhone);
  assert.equal(account.phone, null);
  assert.equal(account.phoneVerifiedAt, null);
});
test('password recovery ignores unverified email and consumes verified-email reset links atomically', async () => {
  const unverified = await user({ emailVerified: false });
  await requestPasswordReset(unverified.email);
  assert.equal(await prisma.passwordResetToken.count({ where: { userId: unverified.id } }), 0);
  const account = await user({ credential: undefined }), auth = await issueSession(account);
  const raw = randomBytes(32).toString('hex');
  await prisma.passwordResetToken.create({ data: { userId: account.id, token: hashToken(raw), expiresAt: new Date(Date.now() + 100000) } });
  const results = await Promise.allSettled([1, 2].map(() => resetPassword(raw, password)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert(await comparePassword(password, (await prisma.emailCredential.findUniqueOrThrow({ where: { userId: account.id } })).passwordHash));
  await assert.rejects(rotateSession(auth.refreshToken));
});
test('backup password changes require the current password and revoke other sessions', async () => {
  const account = await user(), current = await issueSession(account), other = await issueSession(account);
  const { id } = parseRefreshToken(current.refreshToken);
  await assert.rejects(setBackupPassword(account.id, id, 'replacement-password', 'wrong'));
  await setBackupPassword(account.id, id, 'replacement-password', password);
  await assert.rejects(rotateSession(other.refreshToken));
  await rotateSession(current.refreshToken);
});
test('adding a first password and linking a phone require recent authentication', async () => {
  const account = await user({ credential: undefined }), auth = await issueSession(account), { id } = parseRefreshToken(auth.refreshToken);
  await prisma.session.update({ where: { id }, data: { createdAt: new Date(Date.now() - 601000) } });
  await assert.rejects(setBackupPassword(account.id, id, password), /Sign in again/);
  await assert.rejects(requireRecentAuthentication(account.id, id), /sign in again/);
});
test('shared database throttling is atomic under concurrency', async () => {
  const subject = randomUUID();
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => limitAuth('test', subject, 3, 60)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 3);
});
test('OAuth state is signed, cookie-bound, provider-specific and rejects unsafe redirect destinations', () => {
  process.env.GITHUB_CLIENT_ID = 'test-client'; process.env.GITHUB_CLIENT_SECRET = 'test-secret';
  let state;
  const res = { cookie(name, value) { state = value; }, clearCookie() {} };
  beginOAuth({ query: { redirect: '//evil.invalid' } }, res, 'github');
  assert.equal(validateOAuthState({ query: { state }, cookies: { oauth_github: state } }, res, 'github'), '/');
  assert.throws(() => validateOAuthState({ query: { state }, cookies: {} }, res, 'github'));
  assert.throws(() => validateOAuthState({ query: { state }, cookies: { oauth_google: state } }, res, 'google'));
});
test('HTTP login/refresh/logout requires CSRF, returns cookies only, and logout revokes the session', async () => {
  const app = express();
  app.use(express.json()); app.use(cookieParser());
  app.get('/api/auth/csrf-token', csrfTokenHandler); app.use(csrfProtection); app.use('/api/auth', authRoutes); app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const jar = {};
  function absorb(response) {
    for (const cookie of response.headers.getSetCookie()) {
      const [name, ...value] = cookie.split(';')[0].split('=');
      if (value.join('=')) jar[name] = value.join('='); else delete jar[name];
    }
  }
  const cookies = () => Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ');
  try {
    const account = await user();
    let response = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: account.email, password }) });
    assert.equal(response.status, 403);
    response = await fetch(base + '/api/auth/csrf-token'); absorb(response);
    const csrf = (await response.json()).data.csrfToken;
    const post = path => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookies(), 'x-csrf-token': csrf }, body: JSON.stringify(path.endsWith('login') ? { email: account.email, password } : {}) });
    response = await post('/api/auth/login'); assert.equal(response.status, 200); absorb(response);
    const body = await response.json(); assert.equal(body.data.accessToken, undefined); assert.equal(response.headers.get('cache-control'), 'no-store');
    const originalRefresh = jar.refreshToken;
    response = await post('/api/auth/refresh'); assert.equal(response.status, 200); absorb(response); assert.notEqual(jar.refreshToken, originalRefresh);
    response = await fetch(base + '/api/auth/me', { headers: { Cookie: cookies() } }); assert.equal(response.status, 200);
    const activeRefresh = jar.refreshToken;
    response = await post('/api/auth/logout'); assert.equal(response.status, 200); absorb(response);
    assert.equal(jar.accessToken, undefined); assert.equal(jar.refreshToken, undefined);
    await assert.rejects(rotateSession(decodeURIComponent(activeRefresh)));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('HTTP mobile signup, email OTP, password login and browser restart keep one 15-day session', async () => {
  const app = express();
  app.use(express.json()); app.use(cookieParser());
  app.get('/api/auth/csrf-token', csrfTokenHandler); app.use(csrfProtection); app.use('/api/auth', authRoutes); app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const jar = {};
  let csrf;
  const absorb = response => {
    for (const cookie of response.headers.getSetCookie()) {
      const [name, ...parts] = cookie.split(';')[0].split('=');
      const value = parts.join('=');
      if (value) jar[name] = value; else delete jar[name];
    }
  };
  async function request(path, body) {
    const response = await fetch(base + '/api/auth/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(csrf ? { 'x-csrf-token': csrf } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    absorb(response);
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  const number = phone(), email = randomUUID() + '@example.invalid';
  process.env.WHATSAPP_OTP_ENABLED = 'false';
  process.env.RESEND_API_KEY = 're_test_never_real';
  try {
    csrf = (await request('csrf-token')).body.data.csrfToken;
    assert.equal((await request('phone/start', { phone: number, legalConsent: legal })).body.data.kind, 'signup');
    assert.equal((await request('signup', { phone: number, email, name: 'End to End Shopper', password, legalConsent: legal })).status, 202);
    assert.equal(jar.refreshToken, undefined);
    assert.equal((await request('phone/start', { phone: number, legalConsent: legal })).body.data.kind, 'password');
    const unverified = await request('login', { email: number, password, legalConsent: legal });
    assert.equal(unverified.status, 403);
    assert.equal(unverified.body.data.email, email);
    assert.equal((await request('resend-verification', { email })).status, 200);
    const code = sentEmails.at(-1).payload.text.match(/\b\d{6}\b/)[0];
    assert.equal((await request('verify-email', { email, code })).status, 200);
    const login = await request('login', { email: number, password, legalConsent: legal });
    assert.equal(login.status, 200);
    assert.equal(login.body.data.user.emailVerified, true);
    assert.equal(login.body.data.accessToken, undefined);
    assert.equal(login.body.data.refreshToken, undefined);
    const sessionExpiry = login.body.data.sessionExpiresAt;
    assert(Math.abs(Date.parse(sessionExpiry) - Date.now() - 15 * 86400000) < 3000);
    const refreshCookie = login.headers.getSetCookie().find(cookie => cookie.startsWith('refreshToken=') && !cookie.startsWith('refreshToken=;'));
    assert.match(refreshCookie, /HttpOnly/i);
    assert.match(refreshCookie, /SameSite=Lax/i);
    assert.match(refreshCookie, /Path=\/api\/auth/);
    assert.match(refreshCookie, /Max-Age=129\d{4}/);
    // Browser memory and the short access cookie are gone; the persistent refresh cookie remains.
    const beforeRestart = jar.refreshToken;
    delete jar.accessToken;
    assert.equal((await request('me')).status, 401);
    const restored = await request('refresh', {});
    assert.equal(restored.status, 200);
    assert.equal(restored.body.data.sessionExpiresAt, sessionExpiry);
    assert.notEqual(jar.refreshToken, beforeRestart);
    assert.equal((await request('me')).body.data.email, email);
    const { id } = parseRefreshToken(decodeURIComponent(jar.refreshToken));
    // Approaching day 15 must not reset the original session deadline.
    await prisma.session.update({ where: { id }, data: { createdAt: new Date(Date.now() - 14 * 86400000), expiresAt: new Date(Date.now() + 86400000) } });
    const nearExpiry = await request('refresh', {});
    assert.equal(nearExpiry.status, 200);
    assert(Math.abs(Date.parse(nearExpiry.body.data.sessionExpiresAt) - Date.now() - 86400000) < 3000);
    await prisma.session.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1) } });
    assert.equal((await request('refresh', {})).status, 401);
    assert.equal((await request('me')).status, 401);
  } finally {
    process.env.WHATSAPP_OTP_ENABLED = 'true'; process.env.RESEND_API_KEY = '';
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});
