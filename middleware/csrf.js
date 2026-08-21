const crypto = require('crypto');

function tokensMatch(a, b) {
    if (!a || !b) return false;
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

function csrfProtection(req, res, next) {
    if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    }
    res.locals.csrfToken = req.session.csrfToken;

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.body && typeof req.body === 'object') {
        const token = req.body._csrf || req.get('X-CSRF-Token');
        if (!tokensMatch(token, req.session.csrfToken)) {
            req.flash('error', 'Session expired. Please refresh and try again.');
            return res.redirect(req.originalUrl || '/');
        }
    }
    next();
}

function validateCsrf(req, res, next) {
    const token = req.body._csrf || req.get('X-CSRF-Token');
    if (!tokensMatch(token, req.session.csrfToken)) {
        req.flash('error', 'Session expired. Please refresh and try again.');
        return res.redirect(req.originalUrl || '/');
    }
    next();
}

module.exports = { csrfProtection, validateCsrf };
