# Postman API Testing Guide

## Collections Available

### 1. BuildWise Components & Admin API
**File:** `BuildWise-Components-Admin-API.postman_collection.json`

Complete collection for testing:
- 🔐 Authentication (Signup, Login, Get User)
- 👨‍💼 Admin Management (Promote, Demote, List Admins)
- 📦 Components - Public (Browse, Search, Filter)
- 🛠️ Components - Admin (Create, Update, Delete)
- 📊 Stock Management (Update Stock, Analytics)

---

## 🚀 Quick Start

### Step 1: Import Collection

1. Open Postman
2. Click **Import** button
3. Select `BuildWise-Components-Admin-API.postman_collection.json`
4. Collection will appear in left sidebar

### Step 2: Set Environment Variables

The collection uses these variables (automatically managed):
- `baseUrl` - API base URL (default: http://localhost:4000)
- `accessToken` - Auto-saved after login
- `refreshToken` - Auto-saved after login
- `componentId` - Auto-saved after creating component
- `adminEmail` - Your admin email

**To customize:**
1. Click on collection name
2. Go to **Variables** tab
3. Update `baseUrl` if needed
4. Update `adminEmail` to your email

### Step 3: Run Tests in Order

**First Time Setup:**
1. **Authentication → Signup** (create test account)
2. **Authentication → Login** (with your admin account)
3. Now you can access admin endpoints!

---

## 📋 Testing Workflows

### Workflow 1: Admin Setup & Management

```
1. Authentication → Login (your admin account)
   ✅ Saves accessToken automatically

2. Admin Management → List All Admins
   ✅ Verify your admin role

3. Admin Management → Promote User to Admin
   ✅ Promote a test user

4. Admin Management → List All Admins
   ✅ See the new admin
```

### Workflow 2: Create & Manage Components

```
1. Authentication → Login (admin account)
   ✅ Get access token

2. Components/Admin - Management → Create Component (Arduino)
   ✅ Creates component, saves ID

3. Components/Public - Browse → Get All Components
   ✅ See your created component (no auth needed)

4. Components/Public - Browse → Get Component by ID
   ✅ View component details

5. Components/Admin - Management → Update Component
   ✅ Update price, stock, description

6. Components/Admin - Stock Management → Update Stock - Add Quantity
   ✅ Add 25 units to stock
```

### Workflow 3: Stock Management & Analytics

```
1. Authentication → Login (admin account)

2. Components/Admin - Stock Management → Get Low Stock Components
   ✅ View components below threshold

3. Components/Admin - Stock Management → Get Out of Stock Components
   ✅ View components with 0 stock

4. Components/Admin - Stock Management → Update Stock - Set Quantity
   ✅ Restock a component
```

### Workflow 4: Public User Experience

```
These requests work WITHOUT authentication:

1. Components/Public - Browse → Get All Components
   ✅ Browse catalog with pagination

2. Components/Public - Browse → Search Components
   ✅ Search for "arduino"

3. Components/Public - Browse → Filter by Price Range
   ✅ Find components between ₹500-₹2000

4. Components/Public - Browse → Get Component by ID
   ✅ View product details
```

---

## 🧪 Test Scenarios

### Scenario 1: Complete Product Catalog Setup

**Goal:** Set up a product catalog with multiple components

```bash
Step 1: Login as admin
Step 2: Create Arduino Uno (using "Create Component" request)
Step 3: Create DHT22 Sensor (using "Create Component - Sensor" request)
Step 4: Browse all components (public endpoint)
Step 5: Search for "arduino" (public endpoint)
```

### Scenario 2: Stock Management

**Goal:** Manage inventory levels

```bash
Step 1: Login as admin
Step 2: Create component with initial stock of 50
Step 3: Add 25 units → stock becomes 75
Step 4: Subtract 30 units → stock becomes 45
Step 5: Set stock to 100 → stock becomes 100
Step 6: Check low stock analytics (threshold=20)
```

### Scenario 3: Admin Role Management

**Goal:** Create multiple admins

```bash
Step 1: Create 2 test accounts via Signup
Step 2: Login as your admin account
Step 3: List all admins (should see only you)
Step 4: Promote first test user to admin
Step 5: List all admins (should see 2 admins)
Step 6: Demote second test user (if promoted)
```

---

## 📊 Collection Structure

```
BuildWise Components & Admin API
│
├── 📁 Authentication
│   ├── POST Signup
│   ├── POST Login (⭐ Run this first!)
│   └── GET Get Current User
│
├── 📁 Admin Management
│   ├── GET List All Admins
│   ├── POST Promote User to Admin
│   └── POST Demote Admin to Student
│
├── 📁 Components (Product Catalog)
│   │
│   ├── 📁 Public - Browse (No Auth)
│   │   ├── GET Get All Components
│   │   ├── GET Search Components
│   │   ├── GET Filter by Price Range
│   │   └── GET Get Component by ID
│   │
│   ├── 📁 Admin - Management (Auth Required)
│   │   ├── POST Create Component
│   │   ├── POST Create Component - Sensor
│   │   ├── PATCH Update Component
│   │   └── DELETE Delete Component
│   │
│   └── 📁 Admin - Stock Management (Auth Required)
│       ├── PATCH Update Stock - Set Quantity
│       ├── PATCH Update Stock - Add Quantity
│       ├── PATCH Update Stock - Subtract Quantity
│       ├── GET Get Low Stock Components
│       └── GET Get Out of Stock Components
```

---

## 🔑 Request Details

### Authentication Headers

**Public Endpoints** (No auth needed):
- `GET /api/components`
- `GET /api/components/:id`

**Protected Endpoints** (Requires Bearer token):
- All admin endpoints
- Stock management
- Component create/update/delete

**Token is automatically included** for protected requests!

### Request Bodies

**Create Component Example:**
```json
{
  "name": "Arduino Uno R3",
  "sku": "ARD-UNO-R3",
  "description": "Microcontroller board based on ATmega328P",
  "typicalUseCase": "Great for beginners and prototyping",
  "vendorLink": "https://store.arduino.cc/uno",
  "imageUrl": "https://example.com/arduino-uno.jpg",
  "unitPriceCents": 179900,
  "stockQuantity": 50,
  "isActive": true
}
```

**Update Stock Example:**
```json
{
  "quantity": 25,
  "operation": "add"
}
```
Operations: `"set"`, `"add"`, `"subtract"`

---

## ✅ Auto-Tests Included

Each request includes automatic tests:

**Login Request:**
```javascript
✓ Login successful
✓ Access token saved to variable
✓ User role exists
```

**Create Component:**
```javascript
✓ Component created successfully
✓ Component ID saved to variable
```

**Get Components:**
```javascript
✓ Get components successful
✓ Data is an array
✓ Pagination exists
```

**Stock Management:**
```javascript
✓ Stock updated successfully
✓ New stock quantity is correct
```

---

## 🎯 Common Use Cases

### 1. Adding New Product to Catalog

```
1. Login as admin
2. Use "Create Component" request
3. Fill in product details (name, price, stock)
4. Send request
5. Component ID auto-saved!
```

### 2. Updating Product Price

```
1. Login as admin
2. Use "Update Component" request
3. Change body to: {"unitPriceCents": 249900}
4. Send request
5. Price updated to ₹2499!
```

### 3. Restocking Products

```
1. Login as admin
2. Use "Update Stock - Add Quantity"
3. Set quantity (e.g., 50)
4. Send request
5. Stock increased by 50!
```

### 4. Finding Low Stock Items

```
1. Login as admin
2. Use "Get Low Stock Components"
3. Set threshold query param (e.g., ?threshold=20)
4. Send request
5. See all items with stock ≤ 20
```

---

## 🐛 Troubleshooting

### Issue: "Unauthorized" Error

**Solution:**
1. Go to **Authentication → Login**
2. Make sure your email is admin role
3. Run the login request
4. Check if `accessToken` variable is set
5. Try the protected endpoint again

### Issue: "Component ID not found"

**Solution:**
1. Go to **Components/Public → Get All Components**
2. Copy an ID from the response
3. Set it manually in collection variables
4. Or create a new component first

### Issue: "Forbidden - Access denied"

**Solution:**
1. Your account needs admin role
2. Run: `pnpm run promote-admin your@email.com`
3. Login again to get new token with admin role
4. Try the request again

### Issue: "Invalid role"

**Solution:**
- You need admin role for management endpoints
- Use CLI: `pnpm run promote-admin your@email.com`
- See `ADMIN_ACCESS_GUIDE.md` for details

---

## 📈 Testing Tips

### 1. Use Collection Runner

Run entire collection automatically:
1. Click on collection name
2. Click **Run** button
3. Select all requests
4. Click **Run BuildWise Components & Admin API**
5. Watch all tests execute!

### 2. Save Responses as Examples

After getting good responses:
1. Click **Save Response**
2. Name it (e.g., "Success Response")
3. Helps document expected responses

### 3. Use Pre-request Scripts

Already included to:
- Set timestamps
- Generate unique test data
- Validate request before sending

### 4. Monitor Tests

Check **Test Results** tab after each request:
- ✅ Green = Passed
- ❌ Red = Failed
- See what failed and why

---

## 🔗 Related Documentation

- **API Documentation:** `/backend/src/features/components/README.md`
- **Admin Access Guide:** `/backend/ADMIN_ACCESS_GUIDE.md`
- **Components Complete:** `/COMPONENTS_COMPLETE.md`
- **Authentication Testing:** `/backend/documentation/authentication/TESTING_GUIDE.md`

---

## 📝 Variables Reference

| Variable | Description | Auto-Set | Example |
|----------|-------------|----------|---------|
| `baseUrl` | API base URL | No | `http://localhost:4000` |
| `accessToken` | JWT access token | Yes (login) | `eyJhbGciOiJIUz...` |
| `refreshToken` | JWT refresh token | Yes (login) | `eyJhbGciOiJIUz...` |
| `componentId` | Last created component ID | Yes (create) | `cm4dmnu2a0001i2yk...` |
| `adminEmail` | Your admin email | No | `admin@example.com` |

---

## 🎉 Ready to Test!

**Quick Start Command:**
1. Import collection to Postman
2. Update `adminEmail` variable
3. Run **Authentication → Login**
4. Start testing! 🚀

**Need help?** Check the collection descriptions or API documentation.

Happy Testing! 🎊
