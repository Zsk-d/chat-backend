export const internalTokenMiddleware = (req, res, next) => {
    const token = req.header('X-Internal-Token');
    const expectedToken = process.env.X_INTERNAL_TOKEN;

    if (!token || token !== expectedToken) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    next();
};