# Devnix — Build Your Discipline

> Track habits · Build wealth · Write journals · Stay consistent

Full-stack web app with a **MongoDB** backend, **Express** REST API, and JWT authentication.

---

## Project structure

```
devnix/
├── backend/                   ← Node.js + Express + MongoDB
│   ├── server.js              ← Entry point (starts the API server)
│   ├── .env.example           ← Copy to .env and fill in your values
│   ├── models/
│   │   └── User.js            ← Mongoose schema (tasks, transactions, journals, goals…)
│   ├── middleware/
│   │   └── auth.js            ← JWT verification middleware
│   └── routes/
│       ├── auth.js            ← POST /api/auth/register|login, GET /api/auth/me
│       └── user.js            ← All /api/user/* data endpoints
│
└── public/                    ← Static frontend (open with Live Server or any HTTP server)
    ├── index.html             ← Main app shell (no framework, no build step)
    ├── css/
    │   └── style.css          ← All styles (light + dark mode, components, animations)
    └── js/
        ├── api.js             ← Frontend API client (fetch wrappers for every endpoint)
        └── app.js             ← All app logic (auth, tasks, finance, journal, analytics)
```

---

## Quick start

### 1. Prerequisites

- **Node.js** v18+ — https://nodejs.org
- **MongoDB** — either:
  - Local: Install MongoDB Community and run `mongod`
  - Cloud: Create a free cluster at https://mongodb.com/cloud/atlas

### 2. Backend setup

```bash
cd backend
npm install
cp .env.example .env
# Edit .env — set MONGO_URI and JWT_SECRET
npm run dev          # uses nodemon for auto-reload
```

The API will start at **http://localhost:3001**

### 3. Frontend setup

Serve the `public/` folder with any static file server.

**Option A — VS Code Live Server** (recommended)
1. Install the "Live Server" extension
2. Right-click `public/index.html` → "Open with Live Server"
3. It opens at http://127.0.0.1:5500

**Option B — npx**
```bash
cd public
npx serve .          # serves on http://localhost:3000
```

**Option C — Python**
```bash
cd public
python3 -m http.server 5500
```

> Make sure `CLIENT_ORIGIN` in your `.env` matches the URL you serve the frontend from.

---

## API endpoints

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Sign in, returns JWT |
| GET | `/api/auth/me` | Fetch current user (requires token) |

### User data (all require `Authorization: Bearer <token>`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/user/data` | Full user snapshot |
| PATCH | `/api/user/settings` | Update dark mode |
| GET/POST | `/api/user/tasks` | List / add task |
| PATCH/DELETE | `/api/user/tasks/:id` | Rename / delete task |
| PATCH | `/api/user/check` | Save done/skipped/notes maps |
| GET/POST | `/api/user/transactions` | List / add transaction |
| PATCH/DELETE | `/api/user/transactions/:id` | Edit / delete one |
| DELETE | `/api/user/transactions` | Bulk delete `{ ids: [...] }` |
| POST | `/api/user/transactions/archive` | Archive past-month transactions |
| GET | `/api/user/monthly-transactions` | List all archived monthly transactions |
| GET/POST | `/api/user/journals` | List / add journal entry |
| PATCH/DELETE | `/api/user/journals/:id` | Edit / delete one |
| GET/POST | `/api/user/goals` | List / add savings goal |
| PATCH/DELETE | `/api/user/goals/:id` | Edit / delete one |
| GET/PATCH | `/api/user/budgets` | List / set category budget |
| DELETE | `/api/user/budgets/:category` | Remove a budget |

---

## Environment variables (`.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| `MONGO_URI` | MongoDB connection string | `mongodb://127.0.0.1:27017/devnix` |
| `JWT_SECRET` | Secret for signing tokens — **change in production!** | — |
| `JWT_EXPIRES_IN` | Token lifetime | `30d` |
| `PORT` | API server port | `3001` |
| `CLIENT_ORIGIN` | Frontend URL for CORS | `http://localhost:5500` |

---

## Production deployment tips

1. **Environment**: Set `NODE_ENV=production` and use a strong `JWT_SECRET`
2. **MongoDB Atlas**: Use a connection string with a dedicated user and IP whitelist
3. **HTTPS**: Put the Express API behind Nginx or use a PaaS like Railway/Render
4. **Frontend**: Deploy the `public/` folder to Vercel, Netlify, or Cloudflare Pages
5. **CORS**: Update `CLIENT_ORIGIN` to your real frontend domain

---

## Features

- 🎯 **Habit tracker** — weekly grid, streaks, skip/done, drag-toggle, notes
- 💰 **Finance** — transactions, live charts (net worth, cash flow, forecast), budgets, savings goals
- 📔 **Journal** — rich entries, mood tracking, tags, word count, analytics
- 📊 **Analytics** — discipline heatmap, moving average, insights
- 🌙 **Dark mode** — persisted per user in MongoDB
- 🔐 **Auth** — bcrypt passwords, JWT sessions, auto-restore on reload
