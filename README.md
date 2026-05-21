# Subscription Tracker API

A REST API for tracking recurring subscriptions, managing user accounts, and sending automated renewal reminder emails. Built with Express, MongoDB, Arcjet rate limiting, and Upstash Workflow for durable scheduled reminders.

## Features

- **User authentication** — Register, login, and logout with JWT (Bearer token or HTTP-only cookie)
- **Subscription management** — Create, list, update, and delete subscriptions with filtering by status and category
- **Automatic renewal tracking** — Computes `renewalDate` from `startDate` and billing frequency; flags overdue active subscriptions
- **Email reminders** — Upstash Workflow schedules upcoming reminders (7, 5, 2, and 1 days before renewal by default) and an overdue notification
- **Rate limiting** — Arcjet sliding-window protection per client IP
- **Role-based access** — User and admin roles with scoped profile and user-management endpoints

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 20+ |
| Language | TypeScript |
| Framework | Express 5 |
| Database | MongoDB (Mongoose) |
| Auth | JWT + bcrypt |
| Validation | Zod |
| Rate limiting | [Arcjet](https://arcjet.com) |
| Scheduled workflows | [Upstash QStash / Workflow](https://upstash.com/docs/workflow) |
| Email | Nodemailer (SMTP) |

## Project Structure

```
src/
├── index.ts                    # App entry point, middleware, route mounting
├── loadEnv.ts                  # Loads .env then .env.local (overrides)
├── db.ts                       # MongoDB connection
├── accessAuthCookie.ts         # JWT cookie configuration
├── config/
│   ├── upstash.ts              # QStash / workflow client and reminder config
│   └── nodemailer.ts           # SMTP transporter
├── controllers/
│   ├── authController.ts       # Register, login, logout
│   ├── subscriptionController.ts
│   └── userController.ts
├── middleware/
│   ├── auth.ts                 # JWT verification
│   ├── loadUser.ts             # Load current user + admin guard
│   └── arcjetRateLimit.ts      # IP-based rate limiting
├── models/
│   ├── User.ts
│   ├── Subscription.ts
│   └── Reminder.ts
├── routes/
│   ├── auth.ts
│   ├── subscriptions.ts
│   └── users.ts
├── services/
│   ├── reminderScheduleService.ts   # Trigger / cancel workflow runs
│   └── reminderWorkflowService.ts   # Process reminder phases + send email
├── templates/
│   └── emailTemplate.ts        # HTML/text reminder emails
├── utils/
│   └── sendEmail.ts
└── workflows/
    └── reminderWorkflow.ts     # Upstash Workflow handler
```

## Prerequisites

- **Node.js** 20 or later
- **MongoDB** (local or Atlas)
- **Arcjet** API key — [app.arcjet.com](https://app.arcjet.com)
- **Upstash QStash** (optional but required for reminders) — [console.upstash.com/qstash](https://console.upstash.com/qstash)
- **SMTP credentials** (optional but required for reminder emails)

## Getting Started

### 1. Clone and install

```bash
git clone https://github.com/Thatguyy-Jt/subscription-tracker.git
cd subscription-tracker
npm install
```

### 2. Configure environment

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

For local QStash development, also copy the local overrides template:

```bash
cp .env.local.example .env.local
```

`.env.local` is loaded after `.env` and overrides matching keys — useful for `qstash-cli dev` credentials without changing production values.

### 3. Start MongoDB

Ensure MongoDB is running and `MONGODB_URI` in `.env` points to your instance.

### 4. Run the API

**Development** (with hot reload):

```bash
npm run dev
```

**Production build:**

```bash
npm run build
npm start
```

The server listens on `http://127.0.0.1:3000` by default (`PORT` env var).

## Environment Variables

See [`.env.example`](.env.example) for the full list. Key variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGODB_URI` | Yes | MongoDB connection string |
| `JWT_SECRET` | Yes | Secret for signing JWTs |
| `JWT_EXPIRES_IN` | No | Token lifetime (default `7d`) |
| `ARCJET_KEY` | Yes | Arcjet API key for rate limiting |
| `QSTASH_TOKEN` | For reminders | Upstash QStash token |
| `QSTASH_URL` | No | QStash base URL (default cloud; use local dev server URL for local dev) |
| `QSTASH_CURRENT_SIGNING_KEY` | Production | Workflow request verification |
| `QSTASH_NEXT_SIGNING_KEY` | Production | Workflow request verification |
| `UPSTASH_WORKFLOW_URL` | Cloud dev | Public HTTPS URL (e.g. ngrok) so QStash can reach your API |
| `SMTP_*` / `EMAIL_FROM` | For emails | SMTP settings for reminder delivery |
| `REMINDER_UPCOMING_DAYS_BEFORE` | No | Comma-separated days before renewal (default `7,5,2,1`) |

### Local reminder workflow setup

Cloud QStash cannot call `localhost`. Choose one approach:

**Option A — QStash dev server (recommended for local dev)**

```bash
npx @upstash/qstash-cli dev
```

Paste the printed `QSTASH_*` values into `.env.local` and restart the API.

**Option B — Public tunnel**

1. Start the API: `npm run dev`
2. Expose it: `ngrok http 3000`
3. Set `UPSTASH_WORKFLOW_URL` to the HTTPS forwarding URL (no trailing slash)

## Authentication

Protected routes accept either:

- **Bearer token** — `Authorization: Bearer <token>` (returned in login/register JSON)
- **HTTP-only cookie** — Set automatically on login/register (`accessToken` by default)

### Auth endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/auth/register` | No | Create account |
| `POST` | `/auth/login` | No | Sign in |
| `POST` | `/auth/logout` | No | Clear session cookie |

**Register example:**

```json
POST /auth/register
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "password": "securepass123"
}
```

## API Reference

All `/api/*` routes require authentication unless noted.

### Subscriptions — `/api/subscriptions`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/subscriptions` | List your subscriptions (optional `?status=` and `?category=` filters) |
| `POST` | `/api/subscriptions` | Create a subscription |
| `GET` | `/api/subscriptions/:id` | Get one subscription |
| `PATCH` | `/api/subscriptions/:id` | Update a subscription |
| `DELETE` | `/api/subscriptions/:id` | Delete a subscription |

**Subscription fields:**

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | Service name (1–200 chars) |
| `price` | number | Non-negative |
| `currency` | enum | `NGN`, `USD`, `GBP` |
| `frequency` | enum | `daily`, `weekly`, `monthly`, `yearly` |
| `category` | enum | `sport`, `news`, `finance`, `entertainment`, `others` |
| `paymentMethod` | string | e.g. card nickname |
| `status` | enum | `active`, `cancelled`, `paused` (default `active`) |
| `startDate` | ISO date | Billing start; `renewalDate` is computed automatically |
| `notes` | string | Optional (max 2000 chars) |

**Create example:**

```json
POST /api/subscriptions
Authorization: Bearer <token>

{
  "name": "Netflix",
  "price": 15.99,
  "currency": "USD",
  "frequency": "monthly",
  "category": "entertainment",
  "paymentMethod": "Visa •••• 4242",
  "startDate": "2026-01-15"
}
```

When a subscription is created or updated to `active`, the API schedules an Upstash Workflow run that sends reminder emails at configured intervals and marks the subscription overdue after the renewal date passes.

### Users — `/api/users`

| Method | Path | Access | Description |
|--------|------|--------|-------------|
| `GET` | `/api/users/me` | Authenticated | Current user profile |
| `GET` | `/api/users` | Admin | List all users |
| `POST` | `/api/users` | Admin | Create a user |
| `GET` | `/api/users/:id` | Self or admin | Get user by ID |
| `PATCH` | `/api/users/:id` | Self or admin | Update user (role changes require admin) |
| `DELETE` | `/api/users/:id` | Self or admin | Delete user |

### Health check

```
GET /
```

Returns a welcome message when the API is running.

## Reminder Workflow

When QStash is configured, creating or updating an active subscription triggers a durable workflow at `POST /api/workflows/reminders`. The workflow:

1. Validates the subscription is still active and the renewal cycle matches
2. Sleeps until each upcoming reminder window (default: 7, 5, 2, 1 days before renewal)
3. Sends an email at each window via SMTP
4. Sleeps until the renewal date, then sends an overdue reminder and sets `isOverdue: true`

Cancelling, pausing, deleting, or rescheduling a subscription cancels the existing workflow run.

Reminder records are stored in MongoDB to prevent duplicate sends for the same subscription, renewal date, and reminder kind.

## Admin Setup

New accounts default to the `user` role. To promote an account to admin, update MongoDB directly after registration:

```javascript
db.users.updateOne(
  { email: "you@example.com" },
  { $set: { role: "admin" } }
)
```

## Rate Limiting

All routes (except the Upstash workflow endpoint, which is mounted before the rate limiter) are protected by Arcjet sliding-window rate limiting — **200 requests per client IP per minute** by default.

Override with `ARCJET_RATE_LIMIT_MAX`. When exceeded, the API returns `429 Too Many Requests` with `Retry-After` and `X-RateLimit-*` headers.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload (`tsx watch`) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled production build |

## License

Private project — all rights reserved.
