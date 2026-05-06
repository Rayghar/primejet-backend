import apiClient from './apiClient';

const normalizeUser = (user = {}, fallbackEmail = '') => ({
  id: user.id || user.userId || user._id,
  name: user.name || user.fullName || user.email || fallbackEmail,
  email: user.email || fallbackEmail,
  phone: user.phone,
  role: user.role,
  status: user.status,
  photoUrl: user.photoUrl,
  branchScope: user.branchScope || 'all',
  allowedBranches: Array.isArray(user.allowedBranches) ? user.allowedBranches : [],
  permissions: Array.isArray(user.permissions) ? user.permissions : [],
  permissionOverrides: user.permissionOverrides || { add: [], remove: [] },
  effectivePermissions: Array.isArray(user.effectivePermissions) ? user.effectivePermissions : [],
  mustChangePassword: Boolean(user.mustChangePassword),
});

export const hydrateCurrentUser = async () => {
  const token = localStorage.getItem('token');
  if (!token) return null;
  const response = await apiClient.get('/api/v2/users/me');
  const user = normalizeUser(response.data || {});
  localStorage.setItem('user', JSON.stringify(user));
  return user;
};

export const signInUser = async (email, password) => {
  const response = await apiClient.post('/api/v2/auth/login', { email, password });
  const data = response.data || {};
  const token = data.token || data.data?.token;
  let user = data.user || data.data?.user;

  if (!user && data.userId) {
    user = { id: data.userId, name: data.name, role: data.role, email, photoUrl: data.photoUrl };
  }

  if (!token || !user) throw new Error('Login failed: Invalid server response format.');

  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(normalizeUser(user, email)));

  // Canonical admin/BMA session hydration. This keeps branch scope, permissions,
  // status and mustChangePassword aligned with the database after login.
  try {
    user = await hydrateCurrentUser();
  } catch (_) {
    user = normalizeUser(user, email);
    localStorage.setItem('user', JSON.stringify(user));
  }

  return { token, user };
};

export const logoutUser = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/';
};

export const getCurrentUser = () => {
  const userStr = localStorage.getItem('user');
  try { return userStr ? JSON.parse(userStr) : null; } catch (_) { return null; }
};
