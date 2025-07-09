// tests/unit/api/v1/auth/auth.service.test.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
// HttpError, User, and authService will be imported after mocks

// 1. Define the core mock functions that will be controlled in tests.
const mockSaveImpl = jest.fn();
const mockFindOneImpl = jest.fn();
const mockUuidV4Impl = jest.fn();

// 2. Mock 'uuid' to use our specific mock function.
jest.mock('uuid', () => ({
  v4: mockUuidV4Impl,
}));

// 3. Mock the User model.
// Use a string literal for the path.
// Please ENSURE this relative path is correct from the location of this test file
// to your user.model.js file.
// Assuming tests/unit/api/v1/auth/auth.service.test.js to src/models/user.model.js:
const userModelPathForMock = '../../src/models/user.model'; // Path for require later
jest.mock('../../src/models/user.model', () => {
  // The factory function for User model mock
  const MockedUserConstructor = jest.fn().mockImplementation(data => {
    const instance = { ...data };
    if (data && data.id) {
      instance.id = data.id;
    } else {
      // Directly use the already mocked mockUuidV4Impl from the outer scope
      // It's accessible here because its definition is hoisted with `const`
      // but the jest.mock factory has a special scope.
      // A safer way is to require('uuid').v4 inside, which gets the mocked version.
      const { v4: effectivelyMockedUuidV4 } = require('uuid');
      instance.id = effectivelyMockedUuidV4();
    }
    instance.save = mockSaveImpl;
    return instance;
  });

  MockedUserConstructor.findOne = mockFindOneImpl;
  return MockedUserConstructor;
});

// 4. Mock other dependencies
jest.mock('bcryptjs');
jest.mock('jsonwebtoken');

// 5. Now import the service under test, the (now mocked) User model, and HttpError
const authService = require('../../src/api/v1/auth/auth.service'); // Ensure path is correct
const User = require(userModelPathForMock); // Use the variable for the require statement
const HttpError = require('../../src/utils/HttpError'); // Ensure path is correct

describe('Auth Service', () => {
  const mockUserData = {
    name: 'Test User',
    email: 'test@example.com',
    phone: '+12345678901',
    password: 'password123',
  };

  const mockDriverData = {
    ...mockUserData,
    email: 'driver@example.com',
    bankDetails: {
      bankCode: '011',
      accountNumber: '1234567890',
      accountName: 'Test User Driver',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSaveImpl.mockReset();
    mockFindOneImpl.mockReset();
    mockUuidV4Impl.mockReset();

    if (bcrypt.hash && typeof bcrypt.hash.mockReset === 'function') bcrypt.hash.mockReset();
    if (bcrypt.compare && typeof bcrypt.compare.mockReset === 'function') bcrypt.compare.mockReset();
    if (jwt.sign && typeof jwt.sign.mockReset === 'function') jwt.sign.mockReset();
  });

  describe('registerCustomer', () => {
    it('should register a new customer successfully', async () => {
      mockUuidV4Impl.mockReturnValue('mock-uuid');
      mockFindOneImpl.mockResolvedValue(null);
      bcrypt.hash.mockResolvedValue('hashedPassword');
      mockSaveImpl.mockResolvedValue(true);

      const result = await authService.registerCustomer(mockUserData);

      expect(mockFindOneImpl).toHaveBeenCalledWith({ email: mockUserData.email.toLowerCase() });
      expect(bcrypt.hash).toHaveBeenCalledWith(mockUserData.password, 10);
      expect(User).toHaveBeenCalledWith(expect.objectContaining({
        name: mockUserData.name,
      }));
      expect(mockSaveImpl).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ userId: 'mock-uuid', message: 'Customer registered successfully.' });
    });

    it('should use provided id if available for customer', async () => {
      const customerDataWithId = { ...mockUserData, id: 'custom-id-123' };
      mockFindOneImpl.mockResolvedValue(null);
      bcrypt.hash.mockResolvedValue('hashedPassword');
      mockSaveImpl.mockResolvedValue(true);

      const result = await authService.registerCustomer(customerDataWithId);
      
      expect(User).toHaveBeenCalledWith(expect.objectContaining({ id: 'custom-id-123' }));
      expect(mockSaveImpl).toHaveBeenCalledTimes(1);
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
      mockFindOneImpl.mockResolvedValue({ email: mockUserData.email });
      await expect(authService.registerCustomer(mockUserData))
        .rejects.toThrow(new HttpError(409, 'Email already exists.'));
    });

    it('should throw HttpError 500 if saving user fails (generic error)', async () => {
      mockUuidV4Impl.mockReturnValue('mock-uuid');
      mockFindOneImpl.mockResolvedValue(null);
      bcrypt.hash.mockResolvedValue('hashedPassword');
      mockSaveImpl.mockRejectedValueOnce(new Error('DB save error'));

      await expect(authService.registerCustomer(mockUserData))
        .rejects.toThrow(new HttpError(500, 'Customer registration failed due to an unexpected error.'));
    });

    it('should throw HttpError 500 if User.findOne fails (generic error)', async () => {
      mockFindOneImpl.mockRejectedValueOnce(new Error('DB findOne error'));

      await expect(authService.registerCustomer(mockUserData))
        .rejects.toThrow(new HttpError(500, 'Customer registration failed due to an unexpected error.'));
    });
  });

  describe('registerDriver', () => {
    it('should register a new driver successfully', async () => {
      mockUuidV4Impl.mockReturnValue('mock-driver-uuid');
      mockFindOneImpl.mockResolvedValue(null);
      bcrypt.hash.mockResolvedValue('hashedPassword');
      mockSaveImpl.mockResolvedValue(true);

      const result = await authService.registerDriver(mockDriverData);
      expect(mockFindOneImpl).toHaveBeenCalledWith({ email: mockDriverData.email.toLowerCase() });
      expect(bcrypt.hash).toHaveBeenCalledWith(mockDriverData.password, 10);
      expect(User).toHaveBeenCalledWith(expect.objectContaining({
        bankDetails: mockDriverData.bankDetails,
        role: 'driver'
      }));
      expect(mockSaveImpl).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ userId: 'mock-driver-uuid', message: 'Driver registered successfully.' });
    });

    it('should throw HttpError 400 if bank details are incomplete', async () => {
      const incompleteDriverData = { ...mockDriverData, bankDetails: { bankCode: '011' } };
      await expect(authService.registerDriver(incompleteDriverData))
        .rejects.toThrow(new HttpError(400, 'Invalid bank details provided.'));
    });

    it('should throw HttpError 409 if driver email already exists', async () => {
      mockFindOneImpl.mockResolvedValue({ email: mockDriverData.email });
      await expect(authService.registerDriver(mockDriverData))
        .rejects.toThrow(new HttpError(409, 'Email already exists.'));
    });

    it('should throw HttpError 500 if saving driver fails (generic error)', async () => {
      mockUuidV4Impl.mockReturnValue('mock-driver-uuid');
      mockFindOneImpl.mockResolvedValue(null);
      bcrypt.hash.mockResolvedValue('hashedPassword');
      mockSaveImpl.mockRejectedValueOnce(new Error('DB save error for driver'));

      await expect(authService.registerDriver(mockDriverData))
        .rejects.toThrow(new HttpError(500, 'Driver registration failed due to an unexpected error.'));
    });
    
    it('should throw HttpError 500 if User.findOne fails for driver (generic error)', async () => {
        mockFindOneImpl.mockRejectedValueOnce(new Error('DB findOne error for driver'));
  
        await expect(authService.registerDriver(mockDriverData))
          .rejects.toThrow(new HttpError(500, 'Driver registration failed due to an unexpected error.'));
      });
  });

  describe('login', () => {
    const mockExistingUser = {
      id: 'user-123',
      email: mockUserData.email.toLowerCase(),
      password: 'hashedPasswordFromDB',
      role: 'customer',
      name: 'Test User'
    };

    it('should login successfully and return token, userId, and role', async () => {
      mockFindOneImpl.mockResolvedValue(mockExistingUser);
      bcrypt.compare.mockResolvedValue(true);
      jwt.sign.mockReturnValue('mock-jwt-token');

      const result = await authService.login(mockUserData.email, mockUserData.password);
      expect(mockFindOneImpl).toHaveBeenCalledWith({ email: mockUserData.email.toLowerCase() });
      expect(bcrypt.compare).toHaveBeenCalledWith(mockUserData.password, 'hashedPasswordFromDB');
      expect(jwt.sign).toHaveBeenCalledWith(
        { id: 'user-123', role: 'customer' },
        process.env.JWT_SECRET || 'your-default-super-secret-key-for-dev',
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
      mockFindOneImpl.mockResolvedValue(null);
      await expect(authService.login(mockUserData.email, mockUserData.password))
        .rejects.toThrow(new HttpError(401, 'Invalid email or password.'));
    });

    it('should throw HttpError 401 if password does not match', async () => {
      mockFindOneImpl.mockResolvedValue(mockExistingUser);
      bcrypt.compare.mockResolvedValue(false);
      await expect(authService.login(mockUserData.email, mockUserData.password))
        .rejects.toThrow(new HttpError(401, 'Invalid email or password.'));
    });

    it('should throw HttpError 500 if User.findOne fails with generic error', async () => {
        mockFindOneImpl.mockRejectedValue(new Error('DB error'));
        await expect(authService.login(mockUserData.email, mockUserData.password))
            .rejects.toThrow(new HttpError(500, 'Login failed due to an unexpected error.'));
    });

    it('should throw HttpError 500 if bcrypt.compare fails with generic error', async () => {
        mockFindOneImpl.mockResolvedValue(mockExistingUser);
        bcrypt.compare.mockRejectedValue(new Error('bcrypt error'));
        await expect(authService.login(mockUserData.email, mockUserData.password))
            .rejects.toThrow(new HttpError(500, 'Login failed due to an unexpected error.'));
    });
  });

  describe('requestPasswordReset', () => {
    it('should return success message if user exists', async () => {
      mockFindOneImpl.mockResolvedValue({ email: mockUserData.email, id: 'user-123' });
      const result = await authService.requestPasswordReset(mockUserData.email);
      expect(mockFindOneImpl).toHaveBeenCalledWith({ email: mockUserData.email.toLowerCase() });
      expect(result).toEqual({ message: 'If your email is registered, you will receive a password reset link shortly.' });
    });

    it('should throw HttpError 400 for invalid email format', async () => {
      await expect(authService.requestPasswordReset('invalid-email'))
        .rejects.toThrow(new HttpError(400, 'Invalid email format.'));
    });

    it('should throw HttpError 404 if user not found', async () => {
      mockFindOneImpl.mockResolvedValue(null);
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
  });
});