import React, { createContext, useEffect, useState } from 'react';
import io from 'socket.io-client';
import { useAuth } from '../hooks/useAuth';
import { BASE_URL } from '../api/apiClient';

export const SocketContext = createContext();

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || BASE_URL;
const transportEnv = String(process.env.REACT_APP_SOCKET_TRANSPORTS || '').trim();
const transports = transportEnv ? transportEnv.split(',').map((x) => x.trim()).filter(Boolean) : ['websocket', 'polling'];

export const SocketProvider = ({ children }) => {
  const { user } = useAuth();
  const [socket, setSocket] = useState(null);
  const [onlineDrivers, setOnlineDrivers] = useState([]);
  const [incomingOrders, setIncomingOrders] = useState([]);
  const [activeChats, setActiveChats] = useState([]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!user || !token) {
      if (socket) {
        socket.disconnect();
        setSocket(null);
      }
      return undefined;
    }

    const newSocket = io(SOCKET_URL, {
      auth: { token },
      query: { userId: user.id, role: user.role || 'admin' },
      transports,
      reconnectionAttempts: 5,
      timeout: Number(process.env.REACT_APP_SOCKET_TIMEOUT_MS || 10000),
    });

    newSocket.on('driver_location_update', (data) => {
      setOnlineDrivers((prev) => {
        const index = prev.findIndex((d) => d.id === data.driverId);
        if (index > -1) {
          const updated = [...prev];
          updated[index] = { ...updated[index], ...data };
          return updated;
        }
        return [...prev, data];
      });
    });

    newSocket.on('order_created', (order) => setIncomingOrders((prev) => [order, ...prev]));
    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
      setSocket(null);
    };
  }, [user?.id, user?.role]);

  return (
    <SocketContext.Provider value={{ socket, onlineDrivers, incomingOrders, activeChats }}>
      {children}
    </SocketContext.Provider>
  );
};
