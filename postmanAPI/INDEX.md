# 📚 Postman API Collections - Index

## 🎯 Start Here

**New to Postman?** → Read `IMPORT_GUIDE.md` (60-second setup)  
**Quick Reference?** → Read `QUICK_START.md` (visual guide)  
**Detailed Testing?** → Read `README.md` (complete guide)  
**Full Overview?** → Read `POSTMAN_COLLECTION_SUMMARY.md`

---

## 📁 Files in This Directory

### 🎯 Collection File
**`BuildWise-Components-Admin-API.postman_collection.json`**
- Main Postman collection
- 19 requests total
- 4 main sections
- Auto-tests included
- Variables pre-configured

### 📖 Documentation

1. **`IMPORT_GUIDE.md`** ⚡ START HERE
   - 60-second quick start
   - Import instructions
   - First test walkthrough
   - Zero configuration needed

2. **`QUICK_START.md`** 📊 Visual Guide
   - Collection structure diagram
   - Common workflows
   - Request statistics
   - Quick troubleshooting
   - Pro tips

3. **`README.md`** 📚 Complete Guide
   - Detailed testing workflows
   - All request examples
   - Test scenarios
   - Variables reference
   - Advanced usage

4. **`POSTMAN_COLLECTION_SUMMARY.md`** 📋 Overview
   - What was created
   - Key features
   - Coverage statistics
   - Next steps
   - Learning resources

5. **`INDEX.md`** 🗂️ This File
   - Directory overview
   - Quick navigation
   - File descriptions

---

## 🚀 Quick Start (60 seconds)

```bash
1. Open Postman
2. Import: BuildWise-Components-Admin-API.postman_collection.json
3. Run: Authentication → Login
4. Test any endpoint!
```

**That's it!** Everything is pre-configured. ✅

---

## 📦 Collection Overview

### What's Included:

```
BuildWise Components & Admin API (19 requests)
│
├── 🔐 Authentication (3)
│   ├── Signup
│   ├── Login ⭐ Run this first!
│   └── Get Current User
│
├── 👨‍💼 Admin Management (3)
│   ├── List All Admins
│   ├── Promote User to Admin
│   └── Demote Admin to Student
│
└── 📦 Components - Product Catalog (13)
    │
    ├── Public - Browse (4) [No Auth]
    │   ├── Get All Components
    │   ├── Search Components
    │   ├── Filter by Price Range
    │   └── Get Component by ID
    │
    ├── Admin - Management (4) [Auth Required]
    │   ├── Create Component
    │   ├── Create Component - Sensor
    │   ├── Update Component
    │   └── Delete Component
    │
    └── Admin - Stock Management (5) [Auth Required]
        ├── Update Stock - Set
        ├── Update Stock - Add
        ├── Update Stock - Subtract
        ├── Get Low Stock
        └── Get Out of Stock
```

---

## 🎯 Test by User Role

### As Public User (No Login)
```
✓ Browse all components
✓ Search products
✓ Filter by price
✓ View product details
```

### As Admin User (Login Required)
```
✓ All public features +
✓ Create components
✓ Update components
✓ Manage stock
✓ View analytics
✓ Promote users
```

---

## 📊 Statistics

| Metric | Count |
|--------|-------|
| Total Requests | 19 |
| Public Endpoints | 4 |
| Protected Endpoints | 15 |
| Automatic Tests | 57 |
| Variables | 5 |
| Documentation Files | 5 |

---

## 🔗 Related Documentation

### API Documentation
- Components API: `/backend/src/features/components/README.md`
- Admin Management: `/backend/ADMIN_ACCESS_GUIDE.md`
- Authentication: `/backend/documentation/authentication/TESTING_GUIDE.md`

### Project Documentation
- Components Complete: `/COMPONENTS_COMPLETE.md`
- Admin Setup: `/ADMIN_TEST.md`
- Database Schema: `/backend/database-schema.txt`

---

## 💡 Tips

### First Time?
1. Start with `IMPORT_GUIDE.md`
2. Import collection
3. Run Login
4. Test public endpoints first
5. Then try admin endpoints

### Need Details?
- Check `README.md` for complete workflows
- See `QUICK_START.md` for visual overview
- Read `POSTMAN_COLLECTION_SUMMARY.md` for everything

### Advanced Usage?
- Collection Runner for batch testing
- Newman CLI for automation
- Environment variables for dev/prod
- Custom scripts for complex workflows

---

## 🆘 Troubleshooting

**Problem: Can't import collection**
- Solution: See `IMPORT_GUIDE.md`

**Problem: Unauthorized errors**
- Solution: Run Login request first

**Problem: Forbidden errors**
- Solution: Need admin role, see `ADMIN_ACCESS_GUIDE.md`

**Problem: Need more help?**
- Solution: Check `README.md` troubleshooting section

---

## 📂 Directory Structure

```
postmanAPI/
├── INDEX.md                              # This file - Navigation
├── IMPORT_GUIDE.md                       # Quick start (60 sec)
├── QUICK_START.md                        # Visual guide
├── README.md                             # Complete guide
├── POSTMAN_COLLECTION_SUMMARY.md         # Full overview
├── BuildWise-Components-Admin-API.postman_collection.json  # THE COLLECTION
└── auth/                                 # Auth-related collections
```

---

## 🎓 Learning Path

**Level 1: Beginner**
1. Read `IMPORT_GUIDE.md`
2. Import collection
3. Run Login
4. Try public endpoints

**Level 2: Intermediate**
5. Read `QUICK_START.md`
6. Test admin endpoints
7. Create components
8. Manage stock

**Level 3: Advanced**
9. Read `README.md`
10. Use Collection Runner
11. Write custom tests
12. Automate with Newman

---

## ✅ Quick Checklist

Before Testing:
- [ ] Postman installed
- [ ] Server running (`pnpm dev`)
- [ ] Database connected
- [ ] Admin account created

Import Collection:
- [ ] Collection imported
- [ ] Variables checked
- [ ] Login successful
- [ ] Token saved

Start Testing:
- [ ] Public endpoint tested
- [ ] Admin endpoint tested
- [ ] Stock management tested
- [ ] All tests passing

---

## 🎉 You're Ready!

**Everything you need is here:**
- ✅ Complete collection
- ✅ 5 documentation files
- ✅ 19 ready-to-use requests
- ✅ 57 automatic tests
- ✅ Pre-configured variables

**Start with:** `IMPORT_GUIDE.md` → 60 seconds to first test! 🚀

---

*Last Updated: December 9, 2024*  
*Collections: BuildWise Components & Admin API v1.0.0*
