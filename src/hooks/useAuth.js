// src/hooks/useAuth.js
import { useContext } from 'react';
import { AuthContext } from '../contexts/AuthContext';

// This custom hook is a shortcut to access the auth context values.
export const useAuth = () => {
  return useContext(AuthContext);
};
