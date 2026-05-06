import React, { createContext, useState, useEffect, useCallback } from 'react';
import { getCurrentUser, hydrateCurrentUser, logoutUser, signInUser } from '../api/authService';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    const hydrated = await hydrateCurrentUser();
    setUser(hydrated);
    return hydrated;
  }, []);

  useEffect(() => {
    let mounted = true;
    const boot = async () => {
      const storedUser = getCurrentUser();
      if (storedUser && mounted) setUser(storedUser);
      if (localStorage.getItem('token')) {
        try {
          const hydrated = await hydrateCurrentUser();
          if (mounted) setUser(hydrated);
        } catch (err) {
          const status = err?.response?.status;
          if (status === 401 || status === 403) {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            if (mounted) setUser(null);
          } else if (mounted && storedUser) {
            // Preserve the last known session during transient network/backend outages.
            setUser(storedUser);
          }
        }
      }
      if (mounted) setLoading(false);
    };
    boot();
    return () => { mounted = false; };
  }, []);

  const login = async (email, password) => {
    const data = await signInUser(email, password);
    setUser(data.user);
    return data;
  };

  const logout = () => {
    logoutUser();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
};
