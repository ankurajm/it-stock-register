require('dotenv').config();
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const path = require('path');
const layouts = require('express-ejs-layouts');
const os = require('os');
const cron = require('node-cron');
const helmet = require('helmet');
const { spawn } = require('child_process');
const config = require('./config/app');
const { initSchema } = require('./config/db');
const { csrfProtection } = require('./middleware/csrf');

const app = express();
const PORT = config.port;
const HOST = process.env.HOST || '127.0.0.1';

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layout');
app.set('trust proxy', 1);
app.use(layouts);

app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '1mb' }));

if (!config.sessionSecret) {
    console.error('FATAL: SESSION_SECRET not set in .env');
    process.exit(1);
}

app.use(session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 3600000,
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        rolling: true
    }
}));

app.use(flash());

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.use(csrfProtection);

app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.path = req.path;
    res.locals.success_msg = req.flash('success');
    res.locals.error_msg = req.flash('error');
    next();
});

(async () => {
    try {
        await initSchema();
        console.log('Database schema initialized');
    } catch (err) {
        console.error('Schema initialization failed:', err.message);
    }
})();

app.use('/', require('./routes/auth'));
app.use('/', require('./routes/dashboard'));
app.use('/items', require('./routes/items'));
app.use('/employees', require('./routes/employees'));
app.use('/allocations', require('./routes/allocations'));
app.use('/maintenance', require('./routes/maintenance'));
app.use('/reports', require('./routes/reports'));
app.use('/categories', require('./routes/categories'));
app.use('/bulk', require('./routes/bulk'));
app.use('/users', require('./routes/users'));
app.use('/profile', require('./routes/profile'));
app.use('/settings', require('./routes/settings'));

app.use((req, res) => {
    res.status(404).render('error', { layout: false,
        message: 'Page not found',
        error: { status: 404 }
    });
});

app.use((err, req, res, next) => {
    console.error('Server Error:', err.stack || err.message);
    res.status(err.status || 500).render('error', { layout: false,
        message: err.message || 'Something went wrong',
        error: process.env.NODE_ENV === 'development' ? err : {}
    });
});

function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

function openBrowser(url) {
    try {
        const platform = process.platform;
        if (platform === 'win32') {
            spawn('cmd', ['/c', 'start', url], { detached: true, stdio: 'ignore' }).unref();
        } else if (platform === 'darwin') {
            spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
        } else {
            spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
        }
    } catch (err) {
        console.log(`Could not auto-open browser: ${err.message}`);
    }
}

if (config.backupCron && process.env.DATABASE_URL) {
    cron.schedule(config.backupCron, async () => {
        console.log('Running scheduled backup...');
        try {
            const { execSync } = require('child_process');
            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            const file = path.join(config.backupDir, `backup-${ts}.sql`);
            execSync(`pg_dump "${process.env.DATABASE_URL}" > "${file}"`, { stdio: 'ignore' });
            console.log('Backup saved:', file);
        } catch (err) {
            console.error('Scheduled backup failed:', err.message);
        }
    });
}

const server = app.listen(PORT, HOST, () => {
    const localIP = getLocalIP();
    const localUrl = `http://localhost:${PORT}`;
    const networkUrl = `http://${localIP}:${PORT}`;

    console.log('');
    console.log('='.repeat(50));
    console.log('      IT STOCK REGISTER v1.0');
    console.log('      Complete Asset Management System');
    console.log('='.repeat(50));
    console.log('');
    console.log(`  Local:    ${localUrl}`);
    console.log(`  Network:  ${networkUrl}`);
    console.log(`  DB:       PostgreSQL (Supabase)`);
    console.log(`  Backup:   ${config.backupCron}`);
    console.log('');
    console.log('='.repeat(50));
    console.log('  Press Ctrl+C to stop the server');
    console.log('='.repeat(50));
    console.log('');

    setTimeout(() => openBrowser(localUrl), 2000);
});

function gracefulShutdown(signal) {
    console.log(`\nReceived ${signal}. Shutting down gracefully...`);
    server.close(() => {
        console.log('Server closed. Goodbye!');
        process.exit(0);
    });

    setTimeout(() => {
        console.log('Forced shutdown after 10s timeout');
        process.exit(1);
    }, 10000);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err.message);
    gracefulShutdown('uncaughtException');
});

module.exports = app;
