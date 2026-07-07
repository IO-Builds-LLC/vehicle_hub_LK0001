require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure database directory exists
const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir);
}

const dbPath = path.join(dbDir, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to the SQLite database.');
    initializeDatabase();
  }
});

// Initialize database tables
function initializeDatabase() {
  db.serialize(() => {
    // Create profiles table
    db.run(`CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      address TEXT NOT NULL,
      vehicle_number TEXT UNIQUE NOT NULL,
      vehicle_type TEXT NOT NULL,
      chassis_number TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Create settings table for Google Form mapping
    db.run(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )`);
  });
}

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'vehicle-registration-hub-secret-key-12345',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 } // 24 hours
}));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Admin authentication middleware helper
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized. Admin access required.' });
  }
}

// ----------------------------------------------------
// Public APIs
// ----------------------------------------------------

// Register a new vehicle profile
app.post('/api/register', (req, res) => {
  const { name, phone, address, vehicle_number, vehicle_type, chassis_number } = req.body;

  if (!name || !phone || !address || !vehicle_number || !vehicle_type || !chassis_number) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  // Clean the vehicle number for consistency (uppercase, trim)
  const cleanedVehicleNo = vehicle_number.trim().toUpperCase();

  // Check if duplicate vehicle number exists
  db.get('SELECT id FROM profiles WHERE vehicle_number = ?', [cleanedVehicleNo], (err, row) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Database query error.' });
    }

    if (row) {
      return res.status(400).json({ error: 'This vehicle is already registered in the system.' });
    }

    // Insert new profile
    const stmt = db.prepare(`INSERT INTO profiles 
      (name, phone, address, vehicle_number, vehicle_type, chassis_number) 
      VALUES (?, ?, ?, ?, ?, ?)`
    );

    stmt.run(name.trim(), phone.trim(), address.trim(), cleanedVehicleNo, vehicle_type.trim(), chassis_number.trim(), function(err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to create profile.' });
      }
      res.status(201).json({ success: true, profileId: this.lastID });
    });
    stmt.finalize();
  });
});

// View a profile by vehicle number
app.get('/api/profile/:vehicle_number', (req, res) => {
  const vehicleNumber = req.params.vehicle_number.trim().toUpperCase();

  db.get('SELECT name, phone, address, vehicle_number, vehicle_type, chassis_number, created_at FROM profiles WHERE vehicle_number = ?', [vehicleNumber], (err, row) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Database query error.' });
    }

    if (!row) {
      return res.status(404).json({ error: 'Profile not found. Please check your vehicle number.' });
    }

    res.json(row);
  });
});

// ----------------------------------------------------
// Admin APIs & Real Google OAuth2 Setup
// ----------------------------------------------------

// Admin login
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

  if (username === adminUsername && password === adminPassword) {
    req.session.isAdmin = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid username or password.' });
  }
});

// Admin logout
app.post('/api/admin/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed.' });
    }
    res.json({ success: true });
  });
});

// Check if current user is admin
app.get('/api/admin/check-session', (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

// Retrieve all user profiles
app.get('/api/admin/profiles', requireAdmin, (req, res) => {
  db.all('SELECT * FROM profiles ORDER BY created_at DESC', [], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to retrieve profiles.' });
    }
    res.json(rows);
  });
});

// Update a user profile
app.put('/api/admin/profile/:id', requireAdmin, (req, res) => {
  const profileId = req.params.id;
  const { name, phone, address, vehicle_number, vehicle_type, chassis_number } = req.body;

  if (!name || !phone || !address || !vehicle_number || !vehicle_type || !chassis_number) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  const cleanedVehicleNo = vehicle_number.trim().toUpperCase();

  // Make sure new vehicle number is not duplicate with another profile
  db.get('SELECT id FROM profiles WHERE vehicle_number = ? AND id != ?', [cleanedVehicleNo, profileId], (err, row) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Database check error.' });
    }

    if (row) {
      return res.status(400).json({ error: 'This vehicle number is already registered to another profile.' });
    }

    db.run(
      `UPDATE profiles SET 
        name = ?, phone = ?, address = ?, vehicle_number = ?, vehicle_type = ?, chassis_number = ? 
        WHERE id = ?`,
      [name.trim(), phone.trim(), address.trim(), cleanedVehicleNo, vehicle_type.trim(), chassis_number.trim(), profileId],
      function(err) {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: 'Failed to update profile.' });
        }
        res.json({ success: true });
      }
    );
  });
});

// Delete a user profile
app.delete('/api/admin/profile/:id', requireAdmin, (req, res) => {
  const profileId = req.params.id;

  db.run('DELETE FROM profiles WHERE id = ?', [profileId], function(err) {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to delete profile.' });
    }
    res.json({ success: true });
  });
});

// Get admin settings (Google Form parameters)
app.get('/api/admin/settings', requireAdmin, (req, res) => {
  db.all('SELECT key, value FROM settings', [], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to retrieve settings.' });
    }

    const settingsObj = {};
    rows.forEach(row => {
      settingsObj[row.key] = row.value;
    });

    // Provide defaults if not setup yet
    res.json({
      google_form_url: settingsObj.google_form_url || '',
      form_mappings: settingsObj.form_mappings ? JSON.parse(settingsObj.form_mappings) : {
        name: '',
        phone: '',
        address: '',
        vehicle_number: '',
        vehicle_type: '',
        chassis_number: ''
      }
    });
  });
});

// Update settings
app.post('/api/admin/settings', requireAdmin, (req, res) => {
  const { google_form_url, form_mappings } = req.body;

  if (google_form_url === undefined || !form_mappings) {
    return res.status(400).json({ error: 'google_form_url and form_mappings are required.' });
  }

  const serializedMappings = JSON.stringify(form_mappings);

  db.serialize(() => {
    db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', ['google_form_url', google_form_url]);
    db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', ['form_mappings', serializedMappings], (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to save settings.' });
      }
      res.json({ success: true });
    });
  });
});

// ----------------------------------------------------
// Google API Standard HTTPS Requests Helpers
// ----------------------------------------------------

function googleApiRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (res.statusCode >= 400) {
            reject(new Error(parsed.error_description || parsed.error?.message || `Google API status: ${res.statusCode}`));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error(`Failed to parse response: ${body}`));
        }
      });
    });

    req.on('error', err => reject(err));

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

function getGoogleSettings(db) {
  return new Promise((resolve, reject) => {
    db.all('SELECT key, value FROM settings WHERE key IN ("google_client_id", "google_client_secret", "google_access_token", "google_refresh_token", "google_connected_email")', [], (err, rows) => {
      if (err) return reject(err);
      const s = {};
      rows.forEach(r => s[r.key] = r.value);
      resolve(s);
    });
  });
}

function refreshGoogleAccessToken(clientId, clientSecret, refreshToken) {
  const postData = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  }).toString();

  const options = {
    hostname: 'oauth2.googleapis.com',
    path: '/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  return googleApiRequest(options, postData);
}

async function executeGoogleRequest(db, settings, options, retry = true) {
  const reqOptions = { ...options };
  reqOptions.headers = {
    ...reqOptions.headers,
    'Authorization': `Bearer ${settings.google_access_token}`
  };

  try {
    return await googleApiRequest(reqOptions);
  } catch (err) {
    if (err.message.includes('401') && settings.google_refresh_token && retry) {
      console.log('Access token expired. Refreshing token...');
      try {
        const refreshRes = await refreshGoogleAccessToken(
          settings.google_client_id,
          settings.google_client_secret,
          settings.google_refresh_token
        );
        
        await new Promise((resolve, reject) => {
          db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', ['google_access_token', refreshRes.access_token], (saveErr) => {
            if (saveErr) reject(saveErr);
            else resolve();
          });
        });

        settings.google_access_token = refreshRes.access_token;
        return await executeGoogleRequest(db, settings, options, false);
      } catch (refreshErr) {
        console.error('Failed to refresh access token:', refreshErr);
        throw refreshErr;
      }
    } else {
      throw err;
    }
  }
}

// ----------------------------------------------------
// Google API Endpoints
// ----------------------------------------------------

// Retrieve current credentials and connection status
app.get('/api/admin/google-status', requireAdmin, async (req, res) => {
  try {
    const settings = await getGoogleSettings(db);
    res.json({
      isConfigured: !!(settings.google_client_id && settings.google_client_secret),
      clientId: settings.google_client_id || '',
      connectedEmail: settings.google_connected_email || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update credentials (Client ID and Secret)
app.post('/api/admin/google-credentials', requireAdmin, (req, res) => {
  const { google_client_id, google_client_secret } = req.body;

  if (!google_client_id || !google_client_secret) {
    return res.status(400).json({ error: 'Client ID and Client Secret are required.' });
  }

  db.serialize(() => {
    db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', ['google_client_id', google_client_id.trim()]);
    db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', ['google_client_secret', google_client_secret.trim()], (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to save Google developer credentials.' });
      }
      res.json({ success: true });
    });
  });
});

// Disconnect google account
app.post('/api/admin/google-disconnect', requireAdmin, (req, res) => {
  db.serialize(() => {
    db.run('DELETE FROM settings WHERE key IN ("google_access_token", "google_refresh_token", "google_connected_email")', (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to disconnect account.' });
      }
      res.json({ success: true });
    });
  });
});

// Generate redirect OAuth URL
app.get('/api/admin/google-oauth-url', requireAdmin, async (req, res) => {
  try {
    const settings = await getGoogleSettings(db);
    if (!settings.google_client_id) {
      return res.status(400).json({ error: 'Google Client ID is not configured.' });
    }

    const redirectUri = `${req.protocol}://${req.get('host')}/api/admin/google-oauth-callback`;
    const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + new URLSearchParams({
      response_type: 'code',
      client_id: settings.google_client_id,
      redirect_uri: redirectUri,
      scope: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/forms.body.readonly email',
      access_type: 'offline',
      prompt: 'consent'
    }).toString();

    res.json({ url: oauthUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// OAuth Callback handler
app.get('/api/admin/google-oauth-callback', (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.send(`
      <html>
        <body>
          <script>
            window.opener.onGoogleConnectionFailed(${JSON.stringify(error)});
            window.close();
          </script>
        </body>
      </html>
    `);
  }

  db.all('SELECT key, value FROM settings WHERE key IN ("google_client_id", "google_client_secret")', [], async (dbErr, rows) => {
    if (dbErr) {
      return res.status(500).send('Database lookup error during OAuth callback.');
    }

    const settings = {};
    rows.forEach(r => settings[r.key] = r.value);

    if (!settings.google_client_id || !settings.google_client_secret) {
      return res.status(400).send('Google Developer Client ID and Secret are not configured in settings.');
    }

    const redirectUri = `${req.protocol}://${req.get('host')}/api/admin/google-oauth-callback`;

    const postData = new URLSearchParams({
      code: code,
      client_id: settings.google_client_id,
      client_secret: settings.google_client_secret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    }).toString();

    const options = {
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    try {
      const tokenRes = await googleApiRequest(options, postData);
      
      const userInfoOptions = {
        hostname: 'www.googleapis.com',
        path: '/oauth2/v3/userinfo',
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${tokenRes.access_token}`
        }
      };
      
      const userInfo = await googleApiRequest(userInfoOptions);
      const email = userInfo.email || 'Connected Account';

      db.serialize(() => {
        db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', ['google_access_token', tokenRes.access_token]);
        if (tokenRes.refresh_token) {
          db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', ['google_refresh_token', tokenRes.refresh_token]);
        }
        db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', ['google_connected_email', email], (saveErr) => {
          if (saveErr) {
            console.error(saveErr);
            return res.status(500).send('Failed to save Google account connection info.');
          }

          res.send(`
            <html>
              <body>
                <script>
                  window.opener.onGoogleConnected(${JSON.stringify(email)});
                  window.close();
                </script>
              </body>
            </html>
          `);
        });
      });

    } catch (err) {
      console.error(err);
      res.status(500).send(`OAuth code exchange failed: ${err.message}`);
    }
  });
});

// Retrieve Forms listing from the connected Google Drive account
app.get('/api/admin/google-forms', requireAdmin, async (req, res) => {
  try {
    const settings = await getGoogleSettings(db);
    if (!settings.google_access_token) {
      return res.status(400).json({ error: 'No Google account connected.' });
    }

    const driveOptions = {
      hostname: 'www.googleapis.com',
      path: `/drive/v3/files?q=mimeType%3D'application/vnd.google-apps.form'+and+trashed%3Dfalse&pageSize=50&fields=files(id,name)`,
      method: 'GET'
    };

    const driveRes = await executeGoogleRequest(db, settings, driveOptions);
    res.json(driveRes.files || []);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: `Failed to retrieve forms from Google Drive: ${err.message}` });
  }
});

// Retrieve Questions structure using Google Forms API for auto-configuration
app.get('/api/admin/google-form-structure/:formId', requireAdmin, async (req, res) => {
  const { formId } = req.params;

  try {
    const settings = await getGoogleSettings(db);
    if (!settings.google_access_token) {
      return res.status(400).json({ error: 'No Google account connected.' });
    }

    const formsOptions = {
      hostname: 'forms.googleapis.com',
      path: `/v1/forms/${formId}`,
      method: 'GET'
    };

    const formStructure = await executeGoogleRequest(db, settings, formsOptions);
    const items = formStructure.items || [];
    
    const mappings = {
      name: '',
      phone: '',
      address: '',
      vehicle_number: '',
      vehicle_type: '',
      chassis_number: ''
    };

    const responderUri = formStructure.responderUri || `https://docs.google.com/forms/d/${formId}/viewform`;

    items.forEach(item => {
      if (item.questionItem && item.questionItem.question) {
        const label = (item.title || '').toLowerCase();
        const questionId = item.questionItem.question.questionId;
        const entryId = 'entry.' + questionId;

        if (label.includes('name')) {
          mappings.name = entryId;
        } else if (label.includes('phone') || label.includes('contact') || label.includes('mobile') || label.includes('tel')) {
          mappings.phone = entryId;
        } else if (label.includes('address') || label.includes('residence') || label.includes('location')) {
          mappings.address = entryId;
        } else if (label.includes('plate') || label.includes('vehicle number') || (label.includes('vehicle') && label.includes('number')) || label.includes('reg') || label.includes('license')) {
          mappings.vehicle_number = entryId;
        } else if (label.includes('type') || label.includes('category') || label.includes('model')) {
          mappings.vehicle_type = entryId;
        } else if (label.includes('chassis') || label.includes('vin') || label.includes('serial')) {
          mappings.chassis_number = entryId;
        }
      }
    });

    res.json({
      success: true,
      google_form_url: responderUri,
      mappings
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: `Failed to retrieve form structure: ${err.message}` });
  }
});

// HTML scraper route as fallback if user has no Google Console Client credentials
app.post('/api/admin/auto-configure-form', requireAdmin, (req, res) => {
  const { google_form_url } = req.body;

  if (!google_form_url) {
    return res.status(400).json({ error: 'google_form_url is required.' });
  }

  try {
    const urlParts = new URL(google_form_url);
    const options = {
      hostname: urlParts.hostname,
      path: urlParts.pathname + urlParts.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    };

    https.get(options, (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        return res.status(400).json({ error: `Failed to load form. HTTP Status: ${response.statusCode}` });
      }

      let body = '';
      response.on('data', chunk => body += chunk);
      response.on('end', () => {
        try {
          const match = body.match(/FB_PUBLIC_LOAD_DATA_\s*=\s*([\s\S]*?);/);
          if (!match) {
            return res.status(400).json({ error: 'Could not parse form configurations. Ensure it is a valid public "viewform" URL.' });
          }

          const dataText = match[1].trim();
          let data = JSON.parse(dataText);
          const items = data[1] || [];
          
          const mappings = {
            name: '',
            phone: '',
            address: '',
            vehicle_number: '',
            vehicle_type: '',
            chassis_number: ''
          };

          items.forEach(item => {
            const label = (item[1] || '').toLowerCase();
            const entryData = item[4];
            if (entryData && entryData[0] && entryData[0][0]) {
              const entryId = 'entry.' + entryData[0][0];
              
              if (label.includes('name')) {
                mappings.name = entryId;
              } else if (label.includes('phone') || label.includes('contact') || label.includes('mobile') || label.includes('tel')) {
                mappings.phone = entryId;
              } else if (label.includes('address') || label.includes('residence') || label.includes('location')) {
                mappings.address = entryId;
              } else if (label.includes('plate') || label.includes('vehicle number') || (label.includes('vehicle') && label.includes('number')) || label.includes('reg') || label.includes('license')) {
                mappings.vehicle_number = entryId;
              } else if (label.includes('type') || label.includes('category') || label.includes('model')) {
                mappings.vehicle_type = entryId;
              } else if (label.includes('chassis') || label.includes('vin') || label.includes('serial')) {
                mappings.chassis_number = entryId;
              }
            }
          });

          res.json({ success: true, mappings });
        } catch (err) {
          console.error(err);
          res.status(500).json({ error: 'Failed to process Google Form configuration structure.' });
        }
      });
    }).on('error', (err) => {
      console.error(err);
      res.status(500).json({ error: 'Failed to connect to Google Form. Verify connection and URL.' });
    });
  } catch (urlErr) {
    res.status(400).json({ error: 'Invalid Google Form URL format.' });
  }
});

// Fallback to serving the landing page
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
