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

## 🔗 Google Form Auto-Configuration & OAuth2 Setup

To connect a real Google account and sync forms:

### 1. Configure Google Cloud Developer Project
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project.
3. Search for and enable the **Google Drive API** and **Google Forms API**.
4. Go to **OAuth Consent Screen**:
   - Set User Type to **External** (or **Internal** if using Google Workspace).
   - Add scopes: `https://www.googleapis.com/auth/drive.readonly` and `https://www.googleapis.com/auth/forms.body.readonly`.
5. Go to **Credentials**:
   - Click **Create Credentials** > **OAuth Client ID**.
   - Set Application Type to **Web application**.
   - Under **Authorized redirect URIs**, add the callback endpoint of your deployment:
     - Local: `http://localhost:3000/api/admin/google-oauth-callback`
     - Production: `https://your-domain.com/api/admin/google-oauth-callback`
   - Click Save to get your **Client ID** and **Client Secret**.

### 2. Connect Your Account in the Admin Panel
1. Access the Admin Panel and open the **Google Form Setup** tab.
2. In the **Google API OAuth Configurations** box, enter your Client ID and Client Secret, then click **Save Client Credentials**.
3. Under **Google API OAuth Connection**, click **Connect Google Account**.
4. Complete the authentication flow in the popup window and approve permissions.
5. Select a form from the **Link Google Form from Google Drive** dropdown and click **Link & Auto-Configure Fields**.
6. Save the settings.

*(Note: If you do not have Google Developer keys, you can bypass OAuth by pasting the public Google Form URL and clicking **Scrap Mappings (Fallback)**).*
