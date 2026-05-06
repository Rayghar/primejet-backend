// src/views/NotFound.js
import React from 'react';
import PageTitle from '../components/shared/PageTitle';
import { AlertTriangle } from 'lucide-react';

export default function NotFound() {
    return (
        <div className="text-center">
            <AlertTriangle className="mx-auto text-yellow-500" size={64} />
            <PageTitle title="404 - Page Not Found" subtitle="The page you are looking for does not exist." />
        </div>
    );
}