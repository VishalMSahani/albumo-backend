/**
 * Common email wrapper template
 * Provides consistent branding, styling, and layout for all emails
 */

export interface EmailTemplate {
  subject: string;
  html: string;
  text?: string;
}

/**
 * Wraps email content with header, footer, and consistent styling
 */
export function wrapTemplate(content: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RoboRoot</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background-color: #f4f4f7;
      color: #333333;
    }
    .email-container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 30px 20px;
      text-align: center;
    }
    .logo {
      font-size: 32px;
      font-weight: bold;
      color: #ffffff;
      text-decoration: none;
      display: inline-block;
    }
    .content {
      padding: 40px 30px;
      line-height: 1.6;
    }
    .content h1 {
      color: #667eea;
      font-size: 24px;
      margin-top: 0;
      margin-bottom: 20px;
    }
    .content h2 {
      color: #667eea;
      font-size: 20px;
      margin-top: 30px;
      margin-bottom: 15px;
    }
    .content p {
      margin-bottom: 15px;
      color: #555555;
    }
    .button {
      display: inline-block;
      padding: 12px 30px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #ffffff !important;
      text-decoration: none;
      border-radius: 5px;
      margin: 20px 0;
      font-weight: 600;
    }
    .info-box {
      background-color: #f8f9fa;
      border-left: 4px solid #667eea;
      padding: 15px 20px;
      margin: 20px 0;
    }
    .footer {
      background-color: #f4f4f7;
      padding: 30px 20px;
      text-align: center;
      color: #999999;
      font-size: 14px;
    }
    .footer a {
      color: #667eea;
      text-decoration: none;
    }
    .social-links {
      margin: 20px 0;
    }
    .social-links a {
      display: inline-block;
      margin: 0 10px;
      color: #667eea;
      text-decoration: none;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
    }
    th, td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #e0e0e0;
    }
    th {
      background-color: #f8f9fa;
      font-weight: 600;
      color: #667eea;
    }
    .text-center {
      text-align: center;
    }
    .text-muted {
      color: #999999;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <a href="https://roboroot.in" class="logo">⚡ RoboRoot</a>
    </div>
    <div class="content">
      ${content}
    </div>
    <div class="footer">
      <p><strong>RoboRoot</strong> - India's Robotics & Electronics Marketplace</p>
      <div class="social-links">
        <a href="https://twitter.com/roboroot_in">Twitter</a>
        <a href="https://linkedin.com/company/roboroot">LinkedIn</a>
        <a href="https://instagram.com/roboroot_in">Instagram</a>
      </div>
      <p class="text-muted">
        This email was sent to you because you have an account with RoboRoot.<br>
        If you have any questions, contact us at <a href="mailto:support@roboroot.in">support@roboroot.in</a>
      </p>
      <p class="text-muted">
        &copy; ${new Date().getFullYear()} RoboRoot. All rights reserved.
      </p>
    </div>
  </div>
</body>
</html>
  `.trim();
}
