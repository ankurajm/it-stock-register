function requireAuth(req, res, next) {
    if (!req.session.user) return res.redirect('/login');
    res.locals.user = req.session.user;
    next();
}

function requireAdmin(req, res, next) {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).send('Access denied. Admin only.');
    }
    next();
}

function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.session.user || !roles.includes(req.session.user.role)) {
            return res.status(403).send('Access denied.');
        }
        next();
    };
}

module.exports = { requireAuth, requireAdmin, requireRole };
