const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

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
// Admin APIs
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

// Fallback to serving the landing page
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
