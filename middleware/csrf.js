const crypto = require('crypto');

function tokensMatch(a, b) {
    if (!a || !b) return false;
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

function csrfProtection(req, res, next) {
    let csrfToken = req.cookies && req.cookies._csrf;
    if (!csrfToken) {
        csrfToken = crypto.randomBytes(32).toString('hex');
    }
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie('_csrf', csrfToken, { httpOnly: false, sameSite: 'lax', secure: isProd, maxAge: 3600000 });
    res.locals.csrfToken = csrfToken;

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        const token = req.body && req.body._csrf || req.get('X-CSRF-Token');
        if (!tokensMatch(token, csrfToken)) {
            req.flash('error', 'Session expired. Please refresh and try again.');
            return res.redirect(req.originalUrl || '/');
        }
    }
    next();
}

function validateCsrf(req, res, next) {
    const csrfFromCookie = req.cookies && req.cookies._csrf;
    const token = req.body && req.body._csrf || req.get('X-CSRF-Token');
    if (!tokensMatch(token, csrfFromCookie)) {
        req.flash('error', 'Session expired. Please refresh and try again.');
        return res.redirect(req.originalUrl || '/');
    }
    next();
}

module.exports = { csrfProtection, validateCsrf };
