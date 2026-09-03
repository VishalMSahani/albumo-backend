export const LEGAL_POLICY_VERSION = "2026-09-02";
export const LEGAL_LAST_UPDATED = "September 2, 2026";

export const LEGAL_POLICY_VERSIONS = {
  termsAndConditions: LEGAL_POLICY_VERSION,
  privacyPolicy: LEGAL_POLICY_VERSION,
  refundPolicy: LEGAL_POLICY_VERSION,
  shippingPolicy: LEGAL_POLICY_VERSION,
  cancellationPolicy: LEGAL_POLICY_VERSION,
  disclaimer: LEGAL_POLICY_VERSION,
  cookiePolicy: LEGAL_POLICY_VERSION,
} as const;

export const LEGAL_POLICY_LINKS = {
  termsAndConditions: "/terms-and-conditions",
  privacyPolicy: "/privacy-policy",
  refundPolicy: "/refund-policy",
  shippingPolicy: "/shipping-policy",
  cancellationPolicy: "/cancellation-policy",
  disclaimer: "/disclaimer",
  cookiePolicy: "/cookie-policy",
} as const;
