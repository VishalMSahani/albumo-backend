import { wrapTemplate, type EmailTemplate } from "./base.js";

export function passwordResetTemplate(data: {
  user: {
    name: string;
  };
  resetLink: string;
  expiresIn?: string;
}): EmailTemplate {
  const content = `
    <h1>Reset Your Password 🔐</h1>
    <p>Hi ${data.user.name || "there"},</p>
    <p>
      We received a request to reset your password. Click the button below to create a new password:
    </p>

    <p class="text-center">
      <a href="${data.resetLink}" class="button">Reset Password</a>
    </p>

    <div class="info-box">
      <p><strong>⏰ This link will expire in ${data.expiresIn || "1 hour"}.</strong></p>
      <p><strong>🔒 Security Tip:</strong> If you didn't request a password reset, please ignore this email. 
         Your password will remain unchanged.</p>
    </div>

    <p>
      If the button doesn't work, copy and paste this link into your browser:
    </p>
    <p style="word-break: break-all; color: #667eea;">
      ${data.resetLink}
    </p>

    <p>
      For security reasons, never share your password or this reset link with anyone.
    </p>

    <p>
      Best regards,<br>
      The RoboRoot Team
    </p>
  `;

  return {
    subject: "Reset Your RoboRoot Password",
    html: wrapTemplate(content),
    text: `Reset Your Password 🔐

Hi ${data.user.name || "there"},

We received a request to reset your password. Use the link below to create a new password:

Reset Link: ${data.resetLink}

⏰ This link will expire in ${data.expiresIn || "1 hour"}.

🔒 Security Tip: If you didn't request a password reset, please ignore this email. Your password will remain unchanged.

For security reasons, never share your password or this reset link with anyone.

Best regards,
The RoboRoot Team`,
  };
}
