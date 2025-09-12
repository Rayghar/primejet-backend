// File: functions/chat/src/middleware/auth.middleware.js
const jwt = require("jsonwebtoken");
const HttpError = require('../utils/HttpError'); // Ensure this path is correct

// This middleware no longer needs the secret passed in. It reads it from the environment.
const auth = () => (req, res, next) => {
    const secret = process.env.JWT_SECRET;

    if (!secret) {
        console.error("Server configuration error: JWT_SECRET environment variable not set.");
        return next(new HttpError(500, "Server configuration error."));
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return next(new HttpError(401, "No authorization header provided or is not Bearer type."));
    }

    const token = authHeader.split(" ")[1];
    if (!token) {
        return next(new HttpError(401, "No token provided."));
    }

    try {
        const decoded = jwt.verify(token, secret);
        req.user = decoded; // Attach the user payload to the request
        next();
    } catch (error) {
        return next(new HttpError(401, "Invalid or expired token."));
    }
};

module.exports = auth;