# PublicBoard — Backend API

> Express.js + MongoDB REST API powering the PublicBoard community platform.

---

## 🚀 Quick Start

```bash
cd server
cp .env.example .env   # or use the provided .env
npm install
npm run dev            # nodemon — auto-restarts on change
# Server runs on http://localhost:5000
```

---

## 📁 Project Structure

```
server/
├── index.js                  # App entry — Express setup, DB connect, routes
├── .env                      # Environment variables (gitignore this!)
├── .env.example              # Template
├── package.json
├── models/
│   ├── Issue.js              # Issue schema & model
│   ├── User.js               # User schema + password hashing
│   └── Donation.js           # Donation schema
├── routes/
│   ├── auth.js               # POST /register, POST /login, GET /me
│   ├── issues.js             # Full CRUD + support + status update
│   ├── donations.js          # Donation CRUD + stats
│   └── admin.js              # Protected admin-only routes
└── middleware/
    └── auth.js               # JWT protect + adminOnly guards
```

---

## ⚙️ Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `MONGODB_URI` | MongoDB connection string | `mongodb+srv://user:pass@cluster.mongodb.net/` |
| `JWT_SECRET` | Secret key for signing JWTs | Long random string |
| `PORT` | Port to run the server on | `5000` |
| `STRIPE_SECRET_KEY` | Stripe secret for payments | `sk_test_...` or `rk_test_...` |

> ⚠️ **Never commit your `.env` file.** It contains secrets.

---

## 🔌 API Reference

### Authentication — `/api/auth`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register` | Public | Register new user |
| POST | `/api/auth/login` | Public | Login and receive JWT |
| GET | `/api/auth/me` | JWT | Get current user profile |

**Register body:**
```json
{ "name": "Jane Doe", "email": "jane@example.com", "password": "secret123" }
```

**Login response:**
```json
{ "token": "eyJ...", "user": { "id": "...", "name": "Jane", "email": "...", "role": "user" } }
```

**Using the token:** Add `Authorization: Bearer <token>` header to protected requests.

---

### Issues — `/api/issues`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/issues` | Public | List all issues (filterable) |
| GET | `/api/issues/stats` | Public | Issue count by status |
| GET | `/api/issues/:id` | Public | Get single issue |
| POST | `/api/issues` | Public | Create new issue |
| POST | `/api/issues/:id/support` | JWT | Toggle support (upvote) |
| PATCH | `/api/issues/:id/status` | JWT | Update status + add message |
| DELETE | `/api/issues/:id` | Admin | Delete issue |

**Query parameters for GET /api/issues:**
| Param | Type | Description |
|-------|------|-------------|
| `status` | string | Filter: `Open`, `In Progress`, `Pending Review`, `Resolved` |
| `category` | string | Filter by category |
| `search` | string | Full-text search (title, description, location) |
| `sort` | string | Sort field. Default: `-createdAt` (newest first) |

**Create issue body:**
```json
{
  "title": "Broken streetlight on Oak Ave",
  "description": "The streetlight has been out for 3 days...",
  "category": "Infrastructure",
  "location": "Oak Ave & 5th St",
  "reporter": { "name": "John Smith", "email": "john@example.com", "userId": null }
}
```

**Update status body:**
```json
{ "status": "In Progress", "message": "City crew dispatched, expected repair Friday." }
```

**Issue Categories:**
`Infrastructure` | `Safety` | `Sanitation` | `Community Resources` | `Environment` | `Transportation` | `Other`

**Issue Statuses:**
`Open` → `In Progress` → `Pending Review` → `Resolved`

---

### Donations — `/api/donations`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/donations` | Public | List completed donations (anonymous names hidden) |
| GET | `/api/donations/stats` | Public | Total raised + donation count |
| POST | `/api/donations` | Public | Submit a donation |

**Create donation body:**
```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "amount": 25,
  "message": "Happy to help!",
  "isAnonymous": false,
  "relatedIssue": null
}
```

> **Note:** Stripe integration is Stripe-ready. The `stripePaymentIntentId` field stores the payment reference. In demo mode, donations are marked `completed` immediately without Stripe verification.

---

### Admin — `/api/admin` (Admin JWT required)

All routes require a valid JWT **and** `role: "admin"`.

#### Overview
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/overview` | Full dashboard stats, recent activity, category/status breakdown |

#### User Management
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/users` | List users (search, role filter, pagination) |
| GET | `/api/admin/users/:id` | User profile + their issues |
| PATCH | `/api/admin/users/:id/role` | Promote/demote user role |
| DELETE | `/api/admin/users/:id` | Delete user account |

#### Issue Management
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/issues` | List all issues (full filter + pagination) |
| PATCH | `/api/admin/issues/:id` | Update status + add admin note |
| DELETE | `/api/admin/issues/:id` | Delete single issue |
| POST | `/api/admin/issues/bulk-status` | Bulk status update: `{ ids: [...], status: "Resolved" }` |
| POST | `/api/admin/issues/bulk-delete` | Bulk delete: `{ ids: [...] }` |

#### Donation Management
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/donations` | List all donations with status filter + pagination |

---

## 🔐 Authentication & Authorization

The API uses **JWT (JSON Web Tokens)**:

1. User registers or logs in → receives a JWT (7-day expiry)
2. Client stores token in `localStorage` as `pb_token`
3. Protected requests include `Authorization: Bearer <token>` header
4. `protect` middleware validates the token
5. `adminOnly` middleware additionally checks `user.role === 'admin'`

**Making an admin:** Update a user document in MongoDB:
```javascript
db.users.updateOne(
  { email: "youremail@example.com" },
  { $set: { role: "admin" } }
)
```
Then log out and log back in to refresh your token.

---

## 📊 Data Models

### Issue
```
title         String (required, max 200)
description   String (required, max 2000)
category      Enum (7 options)
location      String (required)
status        Enum: Open | In Progress | Pending Review | Resolved
reporter      { name, email, userId }
supporters    [ObjectId refs]
supportCount  Number
updates       [{ message, status, updatedBy, updatedAt }]
resolvedAt    Date
timestamps    createdAt, updatedAt
```

### User
```
name          String (required)
email         String (unique, required)
password      String (bcrypt hashed)
role          Enum: user | admin
timestamps    createdAt, updatedAt
```

### Donation
```
donor         { name, email, userId }
amount        Number (min: 1)
currency      String (default: usd)
message       String (max 500)
isAnonymous   Boolean
status        Enum: pending | completed | failed | refunded
stripePaymentIntentId  String
relatedIssue  ObjectId ref (optional)
timestamps    createdAt, updatedAt
```

---

## 🛠️ Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `express` | ^4.18 | HTTP server framework |
| `mongoose` | ^7.3 | MongoDB ODM |
| `bcryptjs` | ^2.4 | Password hashing |
| `jsonwebtoken` | ^9.0 | JWT auth tokens |
| `cors` | ^2.8 | Cross-origin requests |
| `dotenv` | ^16.0 | Environment variable loading |
| `stripe` | ^12.9 | Payment processing (Stripe-ready) |
| `nodemon` | ^3.0 | Dev auto-restart (devDependency) |

---

## 🌐 Deployment

### Environment
Set all variables from `.env` in your host's environment config.

### MongoDB Atlas
Use the Atlas connection string:
```
mongodb+srv://<user>:<password>@cluster.mongodb.net/<dbname>?retryWrites=true&w=majority
```

### Production Start
```bash
NODE_ENV=production node index.js
```

### Process Manager (recommended)
```bash
npm install -g pm2
pm2 start index.js --name publicboard-api
pm2 save
```

---

## 🐛 Error Handling

All endpoints return consistent error shapes:
```json
{ "message": "Human-readable error description" }
```

HTTP Status codes:
- `200` — Success
- `201` — Created
- `400` — Bad request / validation error
- `401` — Not authenticated
- `403` — Forbidden (not admin)
- `404` — Not found
- `500` — Server error
