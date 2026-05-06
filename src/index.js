// src/index.js
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app';
import './index.css';
// CORRECTED: Commented out the missing CSS file to allow compilation.
// You can create this file later to add your Tailwind directives.
// import './assets/styles/index.css'; 

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
