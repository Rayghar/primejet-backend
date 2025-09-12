// File: functions/chat/src/middleware/auth.middleware.js
const jwt = require("jsonwebtoken");

// The middleware is now a function that accepts the secret as a parameter
const authMiddleware = (secret) => {
    // This is the actual middleware that Express will use
    return (req, res, next) => {
        if (!secret || secret === "your-default-insecure-fallback") {
            // This is the error that the logs were showing
            return res.status(500).send({ message: "Server configuration error: JWT secret not set." });
        }

        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).send({ message: "No authorization header provided." });
        }

        const token = authHeader.split(" ")[1];
        if (!token) {
            return res.status(401).send({ message: "No token provided." });
        }

        try {
            const decoded = jwt.verify(token, secret);
            req.user = decoded; // Attach the user payload to the request
            next();
        } catch (error) {
            return res.status(401).send({ message: "Invalid or expired token." });
        }
    };
};

module.exports = authMiddleware;
