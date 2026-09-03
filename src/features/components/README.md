# Components Feature

The Components feature module manages the product catalog for BuildWise platform. Components are hardware parts (Arduino boards, sensors, motors, etc.) that admins can manage and users can browse and purchase.

## Structure

```
features/components/
├── types/
│   └── component.types.ts       # TypeScript interfaces
├── validators/
│   └── component.validator.ts   # Input validation
├── services/
│   └── component.service.ts     # Business logic
├── controllers/
│   └── component.controller.ts  # Request handlers
└── routes/
    └── component.routes.ts      # API routes
```

## API Endpoints

### Public Endpoints (No Auth Required)

#### GET /api/components
Get all components with filtering, pagination, and sorting.

**Query Parameters:**
- `search` (string) - Search by name, description, or SKU
- `isActive` (boolean) - Filter by active status
- `minPrice` (number) - Minimum price in paise
- `maxPrice` (number) - Maximum price in paise
- `inStock` (boolean) - Filter components in stock
- `page` (number, default: 1) - Page number
- `limit` (number, default: 20, max: 100) - Items per page
- `sortBy` (string: name|price|stock|createdAt, default: createdAt) - Sort field
- `sortOrder` (string: asc|desc, default: desc) - Sort order

**Example Request:**
```bash
GET /api/components?search=arduino&isActive=true&inStock=true&page=1&limit=10&sortBy=price&sortOrder=asc
```

**Example Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "cm4dmnu2a0001i2ykzr3qlc7c",
      "name": "Arduino Uno R3",
      "sku": "ARD-UNO-R3",
      "description": "Microcontroller board based on ATmega328P",
      "typicalUseCase": "Great for beginners and basic projects",
      "vendorLink": "https://store.arduino.cc/uno",
      "imageUrl": "https://example.com/arduino-uno.jpg",
      "unitPriceCents": 179900,
      "unitPrice": 1799,
      "stockQuantity": 50,
      "isActive": true,
      "createdAt": "2024-12-09T00:00:00.000Z",
      "updatedAt": "2024-12-09T00:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 42,
    "totalPages": 5,
    "hasMore": true
  }
}
```

#### GET /api/components/:id
Get a single component by ID.

**Example Request:**
```bash
GET /api/components/cm4dmnu2a0001i2ykzr3qlc7c
```

**Example Response:**
```json
{
  "success": true,
  "data": {
    "id": "cm4dmnu2a0001i2ykzr3qlc7c",
    "name": "Arduino Uno R3",
    "sku": "ARD-UNO-R3",
    "description": "Microcontroller board based on ATmega328P",
    "typicalUseCase": "Great for beginners and basic projects",
    "vendorLink": "https://store.arduino.cc/uno",
    "imageUrl": "https://example.com/arduino-uno.jpg",
    "unitPriceCents": 179900,
    "unitPrice": 1799,
    "stockQuantity": 50,
    "isActive": true,
    "createdAt": "2024-12-09T00:00:00.000Z",
    "updatedAt": "2024-12-09T00:00:00.000Z"
  }
}
```

### Admin Endpoints (Auth + Admin Role Required)

All admin endpoints require:
- `Authorization: Bearer <access_token>` header
- User role must be `admin`

#### POST /api/components
Create a new component.

**Request Body:**
```json
{
  "name": "Arduino Uno R3",
  "sku": "ARD-UNO-R3",
  "description": "Microcontroller board based on ATmega328P",
  "typicalUseCase": "Great for beginners and basic projects",
  "vendorLink": "https://store.arduino.cc/uno",
  "imageUrl": "https://example.com/arduino-uno.jpg",
  "unitPriceCents": 179900,
  "stockQuantity": 50,
  "isActive": true
}
```

**Validation Rules:**
- `name` (required): 3-200 characters
- `sku` (optional): Max 50 characters, must be unique
- `description` (optional): Max 5000 characters
- `typicalUseCase` (optional): Max 500 characters
- `vendorLink` (optional): Valid URL
- `imageUrl` (optional): Valid URL
- `unitPriceCents` (required): 0-100,000,000 (₹0 - ₹10,00,000)
- `stockQuantity` (optional): Non-negative integer, default: 0
- `isActive` (optional): Boolean, default: true

**Example Response:**
```json
{
  "success": true,
  "data": {
    "id": "cm4dmnu2a0001i2ykzr3qlc7c",
    "name": "Arduino Uno R3",
    "sku": "ARD-UNO-R3",
    "unitPriceCents": 179900,
    "unitPrice": 1799,
    "stockQuantity": 50,
    "isActive": true,
    "createdAt": "2024-12-09T00:00:00.000Z",
    "updatedAt": "2024-12-09T00:00:00.000Z"
  }
}
```

#### PATCH /api/components/:id
Update a component. All fields are optional.

**Request Body:**
```json
{
  "name": "Arduino Uno R4",
  "unitPriceCents": 249900,
  "stockQuantity": 75,
  "isActive": true
}
```

**Example Response:**
```json
{
  "success": true,
  "data": {
    "id": "cm4dmnu2a0001i2ykzr3qlc7c",
    "name": "Arduino Uno R4",
    "unitPriceCents": 249900,
    "unitPrice": 2499,
    "stockQuantity": 75,
    "isActive": true,
    "updatedAt": "2024-12-09T01:00:00.000Z"
  }
}
```

#### DELETE /api/components/:id
Soft delete a component (sets `isActive` to false).

**Example Response:**
```json
{
  "success": true,
  "message": "Component deleted successfully"
}
```

#### PATCH /api/components/:id/stock
Update component stock quantity.

**Request Body:**
```json
{
  "quantity": 25,
  "operation": "add"
}
```

**Operations:**
- `set` (default) - Set stock to exact quantity
- `add` - Add quantity to current stock
- `subtract` - Subtract quantity from current stock (min: 0)

**Example Response:**
```json
{
  "success": true,
  "data": {
    "id": "cm4dmnu2a0001i2ykzr3qlc7c",
    "name": "Arduino Uno R3",
    "stockQuantity": 75,
    "unitPrice": 1799
  }
}
```

#### GET /api/components/analytics/low-stock
Get components with low stock (below threshold).

**Query Parameters:**
- `threshold` (number, default: 10) - Stock threshold

**Example Request:**
```bash
GET /api/components/analytics/low-stock?threshold=20
```

**Example Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "cm4dmnu2a0001i2ykzr3qlc7c",
      "name": "Arduino Uno R3",
      "sku": "ARD-UNO-R3",
      "stockQuantity": 5,
      "unitPrice": 1799
    }
  ],
  "count": 1
}
```

#### GET /api/components/analytics/out-of-stock
Get all out of stock components (stock = 0).

**Example Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "cm4dmnu2a0002i2ykabcdefgh",
      "name": "DHT22 Temperature Sensor",
      "sku": "SENS-DHT22",
      "stockQuantity": 0,
      "unitPrice": 299
    }
  ],
  "count": 1
}
```

## Error Responses

All errors follow this format:
```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

**Common Error Codes:**
- `400` - Validation error
- `401` - Unauthorized (missing/invalid token)
- `403` - Forbidden (insufficient permissions)
- `404` - Component not found
- `409` - Conflict (duplicate SKU)
- `500` - Internal server error

## Testing with curl

### Public Endpoints

```bash
# Get all components
curl http://localhost:4000/api/components

# Get components with filters
curl "http://localhost:4000/api/components?search=arduino&isActive=true&page=1&limit=10"

# Get single component
curl http://localhost:4000/api/components/COMPONENT_ID
```

### Admin Endpoints (requires auth token)

```bash
# Create component
curl -X POST http://localhost:4000/api/components \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Arduino Uno R3",
    "sku": "ARD-UNO-R3",
    "unitPriceCents": 179900,
    "stockQuantity": 50
  }'

# Update component
curl -X PATCH http://localhost:4000/api/components/COMPONENT_ID \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "unitPriceCents": 199900,
    "stockQuantity": 75
  }'

# Delete component
curl -X DELETE http://localhost:4000/api/components/COMPONENT_ID \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"

# Update stock
curl -X PATCH http://localhost:4000/api/components/COMPONENT_ID/stock \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "quantity": 25,
    "operation": "add"
  }'

# Get low stock components
curl http://localhost:4000/api/components/analytics/low-stock?threshold=20 \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"

# Get out of stock components
curl http://localhost:4000/api/components/analytics/out-of-stock \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## Notes

- All prices are stored in paise (1 rupee = 100 paise)
- Component deletion is soft delete (sets `isActive` to false)
- SKU must be unique if provided
- Image URLs should point to Azure Blob Storage in production
- Stock updates are atomic and prevent negative values
