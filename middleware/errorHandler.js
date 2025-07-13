// Centralized error handler middleware
module.exports = (err, req, res, next) => {
    console.error('❌ Error:', err);
    const status = err.status || 500;
    res.status(status).json({
        status: 'error',
        message: err.message || 'Internal Server Error',
        ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
    });
}; 