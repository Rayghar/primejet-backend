// tests/unit/api/v1/auth/auth.service.test.js
// Or src/api/v1/auth/auth.service.test.js

const authService = require('../../../../../src/api/v1/auth/auth.service'); // Adjust path as needed
const User = require('../../../../../src/models/user.model'); // Adjust path
const HttpError = require('../../../../../src/utils/HttpError'); // Adjust path
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

// Mock dependencies
jest.mock('../../../../../src/models/user.model'); // Mock User model
jest.mock('bcryptjs');
jest.mock('jsonwebtoken');
jest.mock('uuid', () => ({
  v4: jest.fn(),
}));

// Regexes from auth.service.js (can be imported if exported from there, or redefined for test scope)
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phoneRegex = /^\+?\d{10,15}$/;

describe('Auth Service', () => {
  const mockUserData = {
    name: 'Test User',
    email: 'test@example.com',
    phone: '+12345678901',
    password: 'password123',
  };

  const mockDriverData = {
    ...mockUserData,
    bankDetails: {
      bankCode: '011',
      accountNumber: '1234567890',
      accountName: 'Test User Driver',
    },
  };

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    User.findOne.mockReset();
    User.prototype.save.mockReset(); // For `new User().save()`
  });

  describe('registerCustomer', () => {
    it('should register a new customer successfully', async () => {
      uuidv4.mockReturnValue('mock-uuid');
      User.findOne.mockResolvedValue(null); // No existing user
      bcrypt.hash.mockResolvedValue('hashedPassword');
      User.prototype.save.mockResolvedValueOnce(); // Mongoose save is successful

      const result = await authService.registerCustomer(mockUserData);

      expect(User.findOne).toHaveBeenCalledWith({ email: mockUserData.email.toLowerCase() });
      expect(bcrypt.hash).toHaveBeenCalledWith(mockUserData.password, 10);
      expect(User.prototype.save).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ userId: 'mock-uuid', message: 'Customer registered successfully.' });
    });

    it('should use provided id if available for customer', async () => {
        const customerDataWithId = { ...mockUserData, id: 'custom-id-123' };
        User.findOne.mockResolvedValue(null);
        bcrypt.hash.mockResolvedValue('hashedPassword');
        User.prototype.save.mockResolvedValueOnce();

        const result = await authService.registerCustomer(customerDataWithId);
        expect(User).toHaveBeenCalledWith(expect.objectContaining({ id: 'custom-id-123' }));
        expect(result).toEqual({ userId: 'custom-id-123', message: 'Customer registered successfully.' });
    });


    it('should throw HttpError 400 if required fields are missing', async () => {
      const incompleteData = { ...mockUserData, email: undefined };
      await expect(authService.registerCustomer(incompleteData))
        .rejects.toThrow(new HttpError(400, 'Missing required fields for customer registration.'));
    });

    it('should throw HttpError 400 for invalid email format', async () => {
      await expect(authService.registerCustomer({ ...mockUserData, email: 'invalid-email' }))
        .rejects.toThrow(new HttpError(400, 'Invalid email format.'));
    });
    
    it('should throw HttpError 400 for invalid phone format', async () => {
      await expect(authService.registerCustomer({ ...mockUserData, phone: '123' }))
        .rejects.toThrow(new HttpError(400, 'Invalid phone format.'));
    });

    it('should throw HttpError 400 if password is too short', async () => {
      await expect(authService.registerCustomer({ ...mockUserData, password: '123' }))
        .rejects.toThrow(new HttpError(400, 'Password must be at least 6 characters long.'));
    });

    it('should throw HttpError 409 if email already exists', async () => {
      User.findOne.mockResolvedValue({ email: mockUserData.email }); // User exists
      await expect(authService.registerCustomer(mockUserData))
        .rejects.toThrow(new HttpError(409, 'Email already exists.'));
    });

    it('should throw HttpError 500 if saving user fails', async () => {
      User.findOne.mockResolvedValue(null);
      bcrypt.hash.mockResolvedValue('hashedPassword');
      User.prototype.save.mockRejectedValueOnce(new Error('DB save error'));

      await expect(authService.registerCustomer(mockUserData))
        .rejects.toThrow(new HttpError(500, 'Customer registration failed due to an unexpected error.'));
    });
  });

  describe('registerDriver', () => {
    it('should register a new driver successfully', async () => {
      uuidv4.mockReturnValue('mock-driver-uuid');
      User.findOne.mockResolvedValue(null);
      bcrypt.hash.mockResolvedValue('hashedPassword');
      User.prototype.save.mockResolvedValueOnce();

      const result = await authService.registerDriver(mockDriverData);
      expect(User.findOne).toHaveBeenCalledWith({ email: mockDriverData.email.toLowerCase() });
      expect(bcrypt.hash).toHaveBeenCalledWith(mockDriverData.password, 10);
      expect(User.prototype.save).toHaveBeenCalledTimes(1);
      expect(User).toHaveBeenCalledWith(expect.objectContaining({
        bankDetails: mockDriverData.bankDetails,
        role: 'driver'
      }));
      expect(result).toEqual({ userId: 'mock-driver-uuid', message: 'Driver registered successfully.' });
    });

    it('should throw HttpError 400 if bank details are incomplete', async () => {
      const incompleteDriverData = { ...mockDriverData, bankDetails: { bankCode: '011' } }; // Missing accountNumber, accountName
      await expect(authService.registerDriver(incompleteDriverData))
        .rejects.toThrow(new HttpError(400, 'Invalid bank details provided.'));
    });

    // Other failure cases for registerDriver (email exists, save error, missing fields) are similar to registerCustomer
    // and can be added for completeness.
    it('should throw HttpError 409 if driver email already exists', async () => {
      User.findOne.mockResolvedValue({ email: mockDriverData.email }); // User exists
      await expect(authService.registerDriver(mockDriverData))
        .rejects.toThrow(new HttpError(409, 'Email already exists.'));
    });
  });

  describe('login', () => {
    const mockExistingUser = {
      id: 'user-123',
      email: mockUserData.email.toLowerCase(),
      password: 'hashedPassword', // This is what bcrypt.compare would get from DB
      role: 'customer',
      name: 'Test User'
    };

    it('should login successfully and return token, userId, and role', async () => {
      User.findOne.mockResolvedValue(mockExistingUser);
      bcrypt.compare.mockResolvedValue(true); // Password matches
      jwt.sign.mockReturnValue('mock-jwt-token');

      const result = await authService.login(mockUserData.email, mockUserData.password);
      expect(User.findOne).toHaveBeenCalledWith({ email: mockUserData.email.toLowerCase() });
      expect(bcrypt.compare).toHaveBeenCalledWith(mockUserData.password, 'hashedPassword');
      expect(jwt.sign).toHaveBeenCalledWith(
        { id: 'user-123', role: 'customer' },
        process.env.JWT_SECRET || 'your-default-super-secret-key-for-dev', // Ensure this matches service
        { expiresIn: process.env.JWT_EXPIRES_IN || '1d' }
      );
      expect(result).toEqual({
        token: 'mock-jwt-token',
        userId: 'user-123',
        role: 'customer',
        name: 'Test User',
        message: 'Login successful.'
      });
    });

    it('should throw HttpError 400 if email or password is not provided', async () => {
      await expect(authService.login(null, 'password'))
        .rejects.toThrow(new HttpError(400, 'Email and password are required.'));
      await expect(authService.login('email@example.com', null))
        .rejects.toThrow(new HttpError(400, 'Email and password are required.'));
    });

    it('should throw HttpError 401 if user not found', async () => {
      User.findOne.mockResolvedValue(null);
      await expect(authService.login(mockUserData.email, mockUserData.password))
        .rejects.toThrow(new HttpError(401, 'Invalid email or password.'));
    });

    it('should throw HttpError 401 if password does not match', async () => {
      User.findOne.mockResolvedValue(mockExistingUser);
      bcrypt.compare.mockResolvedValue(false); // Password does not match
      await expect(authService.login(mockUserData.email, mockUserData.password))
        .rejects.toThrow(new HttpError(401, 'Invalid email or password.'));
    });

    it('should throw HttpError 500 if User.findOne fails', async () => {
        User.findOne.mockRejectedValue(new Error('DB error'));
        await expect(authService.login(mockUserData.email, mockUserData.password))
            .rejects.toThrow(new HttpError(500, 'Login failed due to an unexpected error.'));
    });
  });

  describe('requestPasswordReset', () => {
    it('should return success message if user exists', async () => {
      User.findOne.mockResolvedValue({ email: mockUserData.email });
      const result = await authService.requestPasswordReset(mockUserData.email);
      expect(User.findOne).toHaveBeenCalledWith({ email: mockUserData.email.toLowerCase() });
      expect(result).toEqual({ message: 'If your email is registered, you will receive a password reset link shortly.' });
      // Test for actual token generation and email sending would require more complex mocking
      // or integration with a mocked email service.
    });

    it('should throw HttpError 400 for invalid email format', async () => {
      await expect(authService.requestPasswordReset('invalid-email'))
        .rejects.toThrow(new HttpError(400, 'Invalid email format.'));
    });

    it('should throw HttpError 404 if user not found', async () => {
      User.findOne.mockResolvedValue(null);
      await expect(authService.requestPasswordReset(mockUserData.email))
        .rejects.toThrow(new HttpError(404, 'User with this email not found.'));
    });
  });

  describe('resetPassword', () => {
    it('should throw HttpError 501 as it is not implemented', async () => {
      await expect(authService.resetPassword('anytoken', 'newPassword123'))
        .rejects.toThrow(new HttpError(501, 'Password reset functionality is not yet fully implemented in the service.'));
    });
    
    it('should throw HttpError 400 if token or new password is not provided', async () => {
        await expect(authService.resetPassword(null, 'newPassword123'))
          .rejects.toThrow(new HttpError(400, 'Reset token and new password are required.'));
        await expect(authService.resetPassword('anytoken', null))
          .rejects.toThrow(new HttpError(400, 'Reset token and new password are required.'));
    });

    it('should throw HttpError 400 if new password is too short', async () => {
        await expect(authService.resetPassword('anytoken', '123'))
            .rejects.toThrow(new HttpError(400, 'New password must be at least 6 characters long.'));
    });
    // Further tests would be needed when this function is implemented:
    // - Test with valid token and password change
    // - Test with expired token
    // - Test with invalid token
  });
});