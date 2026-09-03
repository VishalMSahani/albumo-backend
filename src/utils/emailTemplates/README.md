# Email Templates Structure

## 📁 File Organization

All email templates are now organized in separate files for better maintainability:

```
src/utils/emailTemplates/
├── base.ts                     # Common wrapper template & types
├── index.ts                    # Central export & template selector
├── userSignup.ts              # Welcome email
├── emailVerification.ts       # Email verification
├── passwordReset.ts           # Password reset
├── orderCreated.ts            # Order confirmation
├── orderPaid.ts               # Payment confirmation
├── orderShipped.ts            # Shipping notification
├── mentorSessionBooked.ts     # Mentor session booking
└── aiProjectGenerated.ts      # AI project ready
```

## 🎯 Usage

### Import Individual Templates

```typescript
import { userSignupTemplate } from "../utils/emailTemplates/userSignup.js";
import { orderCreatedTemplate } from "../utils/emailTemplates/orderCreated.js";

// Use directly
const email = userSignupTemplate({ user: { name: "John", email: "john@example.com" } });
```

### Use Template Selector

```typescript
import { getEmailTemplate } from "../utils/emailTemplates/index.js";
import { EmailEventType } from "../generated/prisma/client.js";

// Automatically selects correct template
const email = getEmailTemplate(EmailEventType.USER_SIGNUP, {
  user: { name: "John", email: "john@example.com" }
});
```

### Legacy Import (Deprecated)

```typescript
// Still works but deprecated
import { getEmailTemplate } from "../utils/email-templates.js";
```

## 🎨 Creating New Templates

### 1. Create Template File

Create a new file in `src/utils/emailTemplates/` (e.g., `orderDelivered.ts`):

```typescript
import { wrapTemplate, type EmailTemplate } from "./base.js";

export function orderDeliveredTemplate(data: {
  order: {
    orderId: string;
  };
  user?: {
    name: string;
  };
}): EmailTemplate {
  const content = `
    <h1>Order Delivered! 📦</h1>
    <p>Hi ${data.user?.name || "there"},</p>
    <p>Your order ${data.order.orderId} has been delivered!</p>
    
    <div class="info-box">
      <p><strong>Order ID:</strong> ${data.order.orderId}</p>
    </div>

    <p class="text-center">
      <a href="https://buildwise.com/orders/${data.order.orderId}/review" class="button">
        Leave a Review
      </a>
    </p>

    <p>
      Thank you for shopping with BuildWise! 🚀<br>
      The BuildWise Team
    </p>
  `;

  return {
    subject: `Order Delivered - ${data.order.orderId}`,
    html: wrapTemplate(content),
    text: `Order Delivered! Your order ${data.order.orderId} has been delivered.`,
  };
}
```

### 2. Export from Index

Add to `src/utils/emailTemplates/index.ts`:

```typescript
// Add import
import { orderDeliveredTemplate } from "./orderDelivered.js";

// Add to exports
export { orderDeliveredTemplate } from "./orderDelivered.js";

// Add to getEmailTemplate switch
case EmailEventType.ORDER_DELIVERED:
  return orderDeliveredTemplate(data);
```

### 3. Update Prisma Schema (if new event type)

Add to `prisma/schema.prisma`:

```prisma
enum EmailEventType {
  // ... existing types
  ORDER_DELIVERED
}
```

Then run: `pnpm prisma generate`

## 🎨 Template Styling

### Available CSS Classes

The `wrapTemplate()` function provides these CSS classes:

- `.button` - Primary call-to-action button
- `.info-box` - Highlighted information box
- `.text-center` - Center-aligned text
- `.text-muted` - Gray, smaller text
- `h1`, `h2` - Styled headings
- `table`, `th`, `td` - Styled tables

### Example Usage

```typescript
const content = `
  <h1>Welcome! 🎉</h1>
  <p>Regular paragraph text</p>
  
  <div class="info-box">
    <p><strong>Important:</strong> This is highlighted</p>
  </div>

  <p class="text-center">
    <a href="https://example.com" class="button">Click Here</a>
  </p>

  <table>
    <thead>
      <tr>
        <th>Column 1</th>
        <th>Column 2</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Data 1</td>
        <td>Data 2</td>
      </tr>
    </tbody>
  </table>

  <p class="text-muted">Small gray text</p>
`;
```

## 📝 Template Data Types

Each template defines its own data structure. Example:

```typescript
// User Signup
{
  user: {
    name: string;
    email: string;
  }
}

// Order Created
{
  order: {
    orderId: string;
    total: number;
    items: Array<{
      name: string;
      quantity: number;
      price: number;
    }>;
    shippingAddress?: string;
    estimatedDelivery?: string;
  };
  user?: {
    name: string;
  };
}

// Mentor Session
{
  session: {
    mentorName: string;
    mentorTitle?: string;
    date: string;
    time: string;
    duration: string;
    topic: string;
    meetLink?: string;
    sessionId?: string;
  };
  user?: {
    name: string;
  };
}
```

## 🔧 Customization

### Modify Base Template

Edit `src/utils/emailTemplates/base.ts` to change:
- Header logo and styling
- Footer content and links
- Overall color scheme
- Company information

### Modify Individual Templates

Each template file can be edited independently without affecting others.

## ✅ Best Practices

1. **Always use `wrapTemplate()`** - Ensures consistent branding
2. **Include text version** - For email clients that don't support HTML
3. **Test with different data** - Handle missing/optional fields gracefully
4. **Keep it responsive** - Templates work on mobile devices
5. **Use semantic HTML** - `<h1>`, `<h2>`, `<p>`, `<table>`, etc.
6. **Include clear CTAs** - Use `.button` class for primary actions
7. **Handle null/undefined** - Use optional chaining: `data.user?.name || "there"`

## 🧪 Testing Templates

### Preview in Browser

```bash
curl -X GET "http://localhost:4000/api/emails/preview/USER_SIGNUP" \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"user":{"name":"John Doe","email":"john@example.com"}}'
```

### Send Test Email

```bash
curl -X POST http://localhost:4000/api/emails/test \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "eventType": "USER_SIGNUP",
    "metadata": {
      "user": {
        "name": "Test User",
        "email": "test@example.com"
      }
    }
  }'
```

## 📦 Migration from Old System

The old `email-templates.ts` file has been kept for backward compatibility but now simply re-exports from the new modular system. All existing code will continue to work without changes.

To migrate:

```typescript
// Old (still works)
import { getEmailTemplate } from "../utils/email-templates.js";

// New (recommended)
import { getEmailTemplate } from "../utils/emailTemplates/index.js";

// Or import specific templates
import { userSignupTemplate } from "../utils/emailTemplates/userSignup.js";
```

---

**Questions?** Check `EMAIL_SYSTEM.md` for full email system documentation!
