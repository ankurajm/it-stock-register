# IT Stock Register

Complete IT Asset Management System for schools and institutions. Built with Node.js, Express, EJS, and PostgreSQL.

## Features

- **Asset Lifecycle** — Add, track, allocate, and retire IT assets (laptops, desktops, printers, etc.)
- **Employee Management** — Employee records with auto-generated employee IDs, initials, and user accounts
- **Allocations** — Assign items to employees with date tracking and history
- **Maintenance** — Log repairs, track maintenance history, resolve issues
- **Role-Based Access** — Admin, Principal, Vice Principal, Headmaster/Headmistress, and regular user roles
- **Bulk Operations** — CSV import/export for items, employees, and users
- **QR Codes** — Auto-generated QR codes for each asset
- **Reports** — PDF (with school branding/custom fonts) and Excel exports
  - Item reports, allocation reports
  - My Items Record (employee's assigned items)
  - No-Dues Certificate (admin)
  - Employee credentials export
- **School Settings** — Customize school name, logo, sub-heading, academic session, contact info
- **Profile Management** — Users can update name/email/phone
- **Mobile-Responsive** — Works on desktops, tablets, and phones
- **PostgreSQL Ready** — Built for production deployment (Supabase/Render)

## Tech Stack

| Layer    | Technology                             |
| -------- | -------------------------------------- |
| Backend  | Node.js, Express                       |
| Database | PostgreSQL (pg) / SQLite (better-sqlite3) |
| Views    | EJS, express-ejs-layouts, Bootstrap 5  |
| Auth     | bcryptjs, express-session, connect-flash |
| Reports  | PDFKit, ExcelJS                        |
| Security | Helmet, CSRF protection, rate limiting |
| Storage  | Multer (file uploads)                  |

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL (for production) or SQLite (local dev)

### Installation

```bash
# Clone the repo
git clone https://github.com/ankurajm/it-stock-register.git
cd it-stock-register

# Install dependencies
npm install

# Set up environment
copy .env.example .env
```

Edit `.env` and set at minimum:

```env
SESSION_SECRET=your-secret-key
PORT=4050
```

### Run Locally (SQLite)

```bash
# Seed default data (admin/user accounts, categories, school settings)
npm run seed

# Start the server
npm start
```

### Run with PostgreSQL

```bash
# Set DATABASE_URL in .env
DATABASE_URL=postgresql://user:password@host:5432/it_stock

# Start (schema auto-initializes)
npm start
```

## Usage

### Admin Panel
1. Login at `/login/admin`
2. Dashboard shows summary stats, pending maintenance, recent allocations
3. Manage items, employees, allocations, maintenance, categories, users
4. Generate reports and certificates
5. Configure school settings with logo upload

### User Portal
1. Login at `/login`
2. View personal dashboard with assigned items
3. Update profile at `/profile`
4. Download Items Record PDF at Reports

## Deployment

### Render + Supabase

1. Create a Supabase project and copy the connection string
2. Deploy on Render (Web Service)
   - Build command: `npm install`
   - Start command: `npm start`
3. Set environment variables on Render:
   - `DATABASE_URL` — Supabase PostgreSQL connection string
   - `SESSION_SECRET` — strong random string
   - `NODE_ENV=production`

## Project Structure

```
├── config/          # App config & database wrapper (pg/SQLite)
├── database/        # Schema files (.sql), seed script
├── fonts/           # Custom PDF fonts (Olde English)
├── middleware/       # Auth guards, CSRF protection
├── public/          # Static assets (css, js, images, favicon)
├── routes/          # Express route handlers
├── uploads/         # Uploaded files (logo, images)
├── utils/           # Helpers (initials, fonts, backup)
├── views/           # EJS templates
├── server.js        # Entry point
└── package.json
```

## License

ISC
