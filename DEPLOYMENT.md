# Deployment Guide

## 1. Supabase (PostgreSQL)

1. Go to [supabase.com](https://supabase.com) → **New project**
2. Set name: `it-stock-register`, create a strong DB password
3. Wait for provisioning (~1 min)
4. Go to **Project Settings** → **Database** → **Connection string** → copy URI
5. This is your `DATABASE_URL`

## 2. Render (App Hosting)

1. Go to [dashboard.render.com](https://dashboard.render.com) → **New +** → **Web Service**
2. Connect your GitHub repo (`ankurajm/it-stock-register`)
3. Configure:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free
4. Add environment variables (Advanced):

| Variable         | Value                          |
|------------------|---------------------------------|
| `DATABASE_URL`   | Your Supabase connection string |
| `SESSION_SECRET` | Random 64-char string           |
| `NODE_ENV`       | `production`                    |
| `HOST`           | `0.0.0.0`                      |

5. Click **Create Web Service**
6. Wait 2-5 mins for build + deploy

Your app will be at `https://it-stock-register.onrender.com`

## 3. Cloudflare (Custom Domain — Optional)

1. In Cloudflare DNS, add a **CNAME** record pointing your domain to `it-stock-register.onrender.com`
2. In Render → service → **Settings** → **Custom Domain**, add your domain
3. Cloudflare SSL/TLS → **Full (strict)**

## 4. Post-Deployment

- Login at `/login/admin` (default: admin / admin123)
- Change the default password immediately
- Configure school settings (logo, name, etc.) at `/settings`
- Check Render logs for any errors

## 5. Updating

Push to GitHub — Render auto-deploys. Or use **Manual Deploy** → **Deploy latest commit**.
