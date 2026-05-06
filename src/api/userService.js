// src/api/userService.js
import httpClient from './httpClient';

const getUsers = async () => {
  const { data } = await httpClient.get('/users/admin');
  return data.users;
};

const inviteUser = async (email, role) => {
  // For admin creation, we send a temporary password and name.
  // The backend's registerUser service will handle hashing and default name if not provided.
  const { data } = await httpClient.post('/users/admin', { email, role, password: 'temporary_password', name: 'New User' });
  return data;
};

const updateUserRole = async (userId, role) => {
  const { data } = await httpClient.put(`/users/admin/${userId}/role`, { role });
  return data;
};

// NEW: Get a single user's detailed profile
const getSingleUser = async (userId) => {
  const { data } = await httpClient.get(`/users/admin/${userId}`);
  return data;
};

// NEW: Update a user's general details
const updateUser = async (userId, updateData) => {
  const { data } = await httpClient.put(`/users/admin/${userId}`, updateData);
  return data;
};

// NEW: Delete a user
const deleteUser = async (userId) => {
  const { data } = await httpClient.delete(`/users/admin/${userId}`);
  return data;
};

/**
 * Fetches driver statistics from the backend.
 * @param {string} driverId - The ID of the driver.
 * @param {string} period - The period for stats ('weekly', 'monthly', 'allTime').
 * @returns {Promise<object>} Driver statistics.
 */
const getDriverStats = async (driverId, period = 'allTime') => {
  const { data } = await httpClient.get(`/users/drivers/${driverId}/stats`, { params: { period } });
  return data;
};

export { getUsers, inviteUser, updateUserRole, getSingleUser, updateUser, deleteUser, getDriverStats };