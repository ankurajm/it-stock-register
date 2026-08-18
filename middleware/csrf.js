const crypto = require('crypto');

function csrfProtection(req, res, next) {
    if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    }
    res.locals.csrfToken = req.session.csrfToken;

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.body && typeof req.body === 'object') {
        const token = req.body._csrf || req.get('X-CSRF-Token');
        if (!token || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(req.session.csrfToken))) {
            req.flash('error', 'Session expired. Please refresh and try again.');
            return res.redirect(req.originalUrl || '/');
        }
    }
    next();
}

function validateCsrf(req, res, next) {
    const token = req.body._csrf || req.get('X-CSRF-Token');
    if (!token || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(req.session.csrfToken))) {
        req.flash('error', 'Session expired. Please refresh and try again.');
        return res.redirect(req.originalUrl || '/');
    }
    next();
}

module.exports = { csrfProtection, validateCsrf };
