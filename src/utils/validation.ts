import type { SignupRequest, LoginRequest } from "./types.js";
import { ValidationError } from "./types.js";

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate signup request
 */
export function validateSignupRequest(data: unknown): SignupRequest {
  if (typeof data !== "object" || data === null) {
    throw new ValidationError("Invalid request body");
  }

  const { email, password, name, college, legalConsent } = data as Record<string, unknown>;

  if (!email || typeof email !== "string") {
    throw new ValidationError("Email is required and must be a string");
  }

  if (!isValidEmail(email)) {
    throw new ValidationError("Invalid email format");
  }

  if (!password || typeof password !== "string") {
    throw new ValidationError("Password is required and must be a string");
  }

  if (password.length < 8) {
    throw new ValidationError("Password must be at least 8 characters long");
  }

  if (name !== undefined && typeof name !== "string") {
    throw new ValidationError("Name must be a string");
  }

  if (college !== undefined && typeof college !== "string") {
    throw new ValidationError("College must be a string");
  }

  if (!legalConsent || typeof legalConsent !== "object") {
    throw new ValidationError("Legal policy acceptance is required");
  }

  const result: SignupRequest = {
    email: email.toLowerCase().trim(),
    password,
    legalConsent: legalConsent as SignupRequest["legalConsent"],
  };

  if (name && typeof name === "string") {
    result.name = name;
  }

  if (college && typeof college === "string") {
    result.college = college;
  }

  return result;
}

/**
 * Validate login request
 */
export function validateLoginRequest(data: unknown): LoginRequest {
  if (typeof data !== "object" || data === null) {
    throw new ValidationError("Invalid request body");
  }

  const { email, password, legalConsent } = data as Record<string, unknown>;

  if (!email || typeof email !== "string") {
    throw new ValidationError("Email is required and must be a string");
  }

  if (!isValidEmail(email)) {
    throw new ValidationError("Invalid email format");
  }

  if (!password || typeof password !== "string") {
    throw new ValidationError("Password is required and must be a string");
  }

  const result: LoginRequest = {
    email: email.toLowerCase().trim(),
    password,
  };

  if (legalConsent !== undefined) {
    if (!legalConsent || typeof legalConsent !== "object") {
      throw new ValidationError("Invalid legal policy acknowledgement");
    }
    result.legalConsent = legalConsent as NonNullable<LoginRequest["legalConsent"]>;
  }

  return result;
}

/**
 * Sanitize user input to prevent XSS
 */
export function sanitizeString(input: string): string {
  return input
    .replace(/[<>]/g, "") // Remove < and >
    .trim();
}
