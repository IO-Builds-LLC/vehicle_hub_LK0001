# Vercel Deployment Guidelines - Vehicle Registration Hub

This guide details instructions and best practices for deploying the **Vehicle Registration Hub** node application.

---

## ⚠️ Important Serverless Limitations (SQLite)

> [!WARNING]
> **Vercel has a serverless read-only file system.**
> The current setup uses a local SQLite database (`db/database.sqlite`). Vercel runs backend code in temporary, stateless serverless functions.
> - Any registrations written to SQLite **will not persist** and will be lost when the function container recycles.
> - The application will fail to write data if it tries to write to the read-only deployment directory.

### Recommended Database Alternatives for Vercel
If deploying to Vercel, it is highly recommended to migrate the SQLite driver to a serverless relational database like:
1. **Neon Postgres** (Serverless Postgres with a free tier)
2. **Supabase** (Hosted Postgres)
3. **Vercel Postgres** (Integrated Serverless database)

To migrate, you can replace the `sqlite3` dependency in `server.js` with a Postgres driver (e.g. `pg` or `postgres`) and configure a database connection string.

### Alternative Persistent Hosts
If you want to keep using the current **SQLite setup** without migrating to Postgres, consider deploying to:
- **Render** (using a persistent Disk mount)
- **Railway** (using a persistent Volume)
- **Fly.io** (using a persistent Volume mount)

---

## 🛠️ Deploying to Vercel

If you choose to deploy to Vercel, follow these setup parameters:

### 1. Project Configuration
Create a `vercel.json` file in the root directory to route requests to the Node.js server:
```json
{
  "version": 2,
  "builds": [
    {
      "src": "server.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/api/(.*)",
      "dest": "server.js"
    },
    {
      "src": "/(.*)",
      "dest": "public/$1"
    }
  ]
}
```

### 2. Environment Variables
Configure the following Environment Variables in the Vercel dashboard:

| Variable | Description | Default (Fallback) |
| :--- | :--- | :--- |
| `SESSION_SECRET` | Secret key used for signing session cookies | `vehicle-registration-hub-secret-key-12345` |
| `ADMIN_USERNAME` | Username for dashboard logins | `admin` |
| `ADMIN_PASSWORD` | Password for dashboard logins | `admin123` |
| `PORT` | Local runtime port | `3000` |

---

## 🔗 Google Form Auto-Configuration & Prefill Setup

When running the application on staging or production:
1. Go to the **Google Form Setup** tab in the Admin Dashboard.
2. Click **Connect Google Account** to link your profile and select your form, OR paste the public Google Form URL (`.../viewform`).
3. Click **Auto-Configure Mappings**. The server will fetch and automatically parse the entry IDs (e.g., `entry.1000001` matching the fields Name, Phone, Address, etc.).
4. Click **Save Configurations** at the bottom to write settings.
5. In **Manage Registrations**, click **Autofill** on any user profile. It will redirect to the Google Form with all fields automatically prefilled with that user's information.
