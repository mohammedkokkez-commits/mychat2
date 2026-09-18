// server.js
require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');

const store = require('./db/database');

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET;
const MAX_USERS = 2; // this app is intentionally for exactly two people
const IS_PROD = process.env.NODE_ENV === 'production';

if (!SESSION_SECRET) {
  console.error(
    'Missing SESSION_SECRET. Set it in your environment (see .env.example) before starting.'
  );
  process.exit(1);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ---------- Security headers ----------
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"]
      }
    },
    hsts: IS_PROD
  })
);

app.set('trust proxy', 1); // Render sits behind a proxy
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Sessions (shared between HTTP and Socket.io) ----------
const sessionMiddleware = session({
  store: new SQLiteStore({ db: 'sessions.db', dir: path.join(__dirname, 'db') }),
  secret: SESSION_SECRET,
  name: 'sid',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: IS_PROD, // requires HTTPS, which Render provides
    maxAge: 1000 * 60 * 60 * 6 // 6 hours
  }
});
app.use(sessionMiddleware);

// ---------- Rate limiting on auth endpoints ----------
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'محاولات كثيرة. حاول بعد شوي.' }
});

// ---------- Auth helpers ----------
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: 'غير مسجل دخول' });
}

function validCreds(username, password) {
  return (
    typeof username === 'string' &&
    typeof password === 'string' &&
    /^[a-zA-Z0-9_]{3,20}$/.test(username) &&
    password.length >= 8 &&
    password.length <= 200
  );
}

// ---------- Routes ----------

// Registration is capped at two accounts total, then closes itself.
app.post('/api/register', authLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!validCreds(username, password)) {
    return res.status(400).json({
      error: 'اسم المستخدم 3-20 حرف/رقم، وكلمة المرور 8 أحرف على الأقل'
    });
  }
  if (store.countUsers() >= MAX_USERS) {
    return res.status(403).json({ error: 'التسجيل مغلق، الحساب معد لشخصين فقط' });
  }
  if (store.getUserByUsername(username)) {
    return res.status(409).json({ error: 'اسم المستخدم مستخدم' });
  }
  const hash = await bcrypt.hash(password, 12);
  store.createUser(username, hash);
  res.json({ ok: true });
});

app.post('/api/login', authLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!validCreds(username, password)) {
    return res.status(400).json({ error: 'بيانات دخول غير صالحة' });
  }
  const user = store.getUserByUsername(username);
  if (!user) return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور خطأ' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور خطأ' });

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'خطأ بالسيرفر' });
    req.session.userId = user.id;
    req.session.username = user.username;
    res.json({ ok: true, username: user.username });
  });
});

app.post('/api/logout', requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('sid');
    res.json({ ok: true });
  });
});

app.get('/api/me', (req, res) => {
  if (req.session && req.session.userId) {
    return res.json({ username: req.session.username });
  }
  res.status(401).json({ error: 'غير مسجل دخول' });
});

app.get('/api/messages', requireAuth, (req, res) => {
  res.json({
    messages: store.getActiveMessages(),
    lifetimeMs: store.MESSAGE_LIFETIME_MS
  });
});

app.get('/chat.html', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// ---------- Socket.io realtime layer ----------
// Reuse the same session middleware so sockets only work when logged in.
io.engine.use(sessionMiddleware);

io.use((socket, next) => {
  const session = socket.request.session;
  if (session && session.userId) {
    socket.username = session.username;
    return next();
  }
  next(new Error('unauthorized'));
});

io.on('connection', (socket) => {
  socket.on('chat:send', (payload) => {
    const text = typeof payload === 'string' ? payload : payload && payload.text;
    if (!text || typeof text !== 'string') return;
    const trimmed = text.trim().slice(0, 2000);
    if (!trimmed) return;

    const msg = store.insertMessage(socket.username, trimmed);
    io.emit('chat:new', msg);
  });
});

server.listen(PORT, () => {
  console.log(`Secure chat running on port ${PORT}`);
});
