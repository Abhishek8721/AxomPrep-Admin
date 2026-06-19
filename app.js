require('dotenv').config();

const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const path = require('path');
const { initFirebase } = require('./config/firebase');
const apiRoutes = require('./routes/api');

const app = express();

try {
  initFirebase();
  console.log('Firebase Admin initialized');
} catch (err) {
  console.error('Firebase Admin failed:', err.message);
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

function getJwtSecret() {
  return process.env.SESSION_SECRET || 'axomprep-dev-secret-change-me';
}

/** POST /api/login */
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const validUser = username === (process.env.ADMIN_USERNAME || 'admin');
  const validPass = password === (process.env.ADMIN_PASSWORD || 'axomprep2024');

  if (!validUser || !validPass) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = jwt.sign({ username }, getJwtSecret(), { expiresIn: '24h' });
  res.cookie('auth_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
  });
  res.json({ success: true });
});

/** POST /api/logout */
app.post('/api/logout', (_req, res) => {
  res.clearCookie('auth_token');
  res.json({ success: true });
});

/** GET /api/session */
app.get('/api/session', (req, res) => {
  const token = req.cookies.auth_token;
  if (!token) {
    return res.json({ authenticated: false });
  }
  try {
    const payload = jwt.verify(token, getJwtSecret());
    res.json({ authenticated: true, username: payload.username });
  } catch {
    res.json({ authenticated: false });
  }
});

app.use('/api', apiRoutes);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

module.exports = app;
