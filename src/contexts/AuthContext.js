// src/contexts/AuthContext.js
/*import React, { createContext, useState, useEffect } from 'react';
import { loginUser, getMyProfile, logoutUser } from '../api/authService';

const AuthContext = createContext();

const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAuthStatus = async () => {
      const token = localStorage.getItem('token');
      if (token) {
        try {
          const profile = await getMyProfile();
          setUser(profile);
        } catch (error) {
          // Token is invalid or expired, log out user
          logoutUser();
        }
      }
      setLoading(false);
    };

    checkAuthStatus();
  }, []);

  const login = async (email, password) => {
    setLoading(true);
    try {
      const { token, user: userData } = await loginUser(email, password);
      localStorage.setItem('token', token);
      setUser(userData);
      setLoading(false);
    } catch (error) {
      setLoading(false);
      throw error;
    }
  };

  const logout = () => {
    logoutUser();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export { AuthProvider, AuthContext };

*/