# 🚀 Import & Test in 60 Seconds

## Step 1: Import (10 seconds)
```
1. Open Postman
2. Click "Import" 
3. Drag & drop: BuildWise-Components-Admin-API.postman_collection.json
4. Done! ✅
```

## Step 2: Login (10 seconds)
```
1. Open: Authentication → Login
2. Click "Send"
3. Token auto-saved! ✅
```

## Step 3: Test (40 seconds)

### Public Endpoint (No Auth)
```
Components/Public → Get All Components
Click "Send" 
✅ See all components!
```

### Admin Endpoint (Auth Required)
```
Components/Admin → Create Component
Click "Send"
✅ Component created!
```

### Stock Management
```
Components/Stock → Get Low Stock Components
Click "Send"
✅ See inventory alerts!
```

---

## 🎯 Your First Test

**Create Your First Component:**

1. **Login**
   ```
   Authentication → Login → Send
   ✅ Token saved!
   ```

2. **Create Component**
   ```
   Components/Admin → Create Component → Send
   ✅ Arduino Uno created!
   ```

3. **View Component**
   ```
   Components/Public → Get All Components → Send
   ✅ See your component!
   ```

**Done in 60 seconds! 🎉**

---

## 📝 Request Body Already Filled!

All requests have **example data pre-filled**:

### Login
```json
{
  "email": "kingofmonster7@gmail.com",
  "password": "Monster75!"
}
```

### Create Component
```json
{
  "name": "Arduino Uno R3",
  "sku": "ARD-UNO-R3",
  "unitPriceCents": 179900,
  "stockQuantity": 50
}
```

**Just click Send!** 🚀

---

## ✅ What Works Out of the Box

- ✅ All requests have example data
- ✅ Token auto-saves after login
- ✅ Component ID auto-saves
- ✅ Tests run automatically
- ✅ Variables managed for you

**Zero configuration needed!**

---

## 🎮 Quick Commands

| Action | Request to Run |
|--------|---------------|
| Login | `Authentication → Login` |
| Browse Products | `Public → Get All Components` |
| Create Product | `Admin → Create Component` |
| Search | `Public → Search Components` |
| Update Stock | `Stock → Update Stock - Add Quantity` |
| Check Alerts | `Stock → Get Low Stock` |

---

## 🆘 Need Help?

**See detailed guides:**
- `README.md` - Full testing guide
- `QUICK_START.md` - Visual overview
- `POSTMAN_COLLECTION_SUMMARY.md` - Complete details

**Or just start testing!** Everything works out of the box. 🎊
