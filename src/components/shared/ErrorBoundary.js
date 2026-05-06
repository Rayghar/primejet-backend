// src/components/shared/ErrorBoundary.js
import React from 'react';
// Removed: import { logAppEvent } from '../../services/loggingService'; // This service is no longer used directly

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true };
    }

    componentDidCatch(error, errorInfo) {
        // console.error is sufficient for client-side errors in production,
        // or integrate with a dedicated error logging service like Sentry (backend-side).
        console.error('Uncaught application error:', error, errorInfo);
        // If you want to send this to your backend, you'd make an API call here.
        // E.g., if you had a logService.logClientError function:
        // logService.logClientError('Uncaught Frontend Error', { message: error.message, stack: error.stack, componentStack: errorInfo.componentStack });
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="flex items-center justify-center h-screen bg-gray-100 text-center">
                    <div>
                        <h1 className="text-2xl font-bold text-red-600">Something went wrong.</h1>
                        <p className="text-gray-700 mt-2">
                            An unexpected error has occurred. The development team has been notified.
                        </p>
                        <button
                            onClick={() => window.location.reload()}
                            className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                        >
                            Reload Page
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;