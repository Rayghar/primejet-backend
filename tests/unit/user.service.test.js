// tests/unit/api/v1/users/user.service.test.js
// Or src/api/v1/users/user.service.test.js

const userService = require('../../src/api/v1/users/user.service'); // Adjust path
const User = require('../../src/models/user.model'); // Adjust path
const HttpError = require('../../src/utils/HttpError'); // Adjust path
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

// Mock dependencies
jest.mock('../../src/models/user.model');
jest.mock('bcryptjs');
jest.mock('uuid', () => ({
  v4: jest.fn(),
}));

describe('User Service', () => {
  const mockUserId = 'user-id-123';
  const mockAdminId = 'admin-id-123';
  const mockDriverId = 'driver-id-123';

  const mockUser = {
    id: mockUserId,
    name: 'Test User',
    email: 'test@example.com',
    phone: '+1234567890',
    role: 'customer',
    walletBalance: 100,
    notificationPreferences: { orderUpdates: true, promotions: true },
    toObject: jest.fn().mockReturnThis(), // Common for Mongoose docs
    save: jest.fn().mockResolvedValue(this), // For instance saves
    select: jest.fn().mockReturnThis(), // For .select('-password')
  };

  const mockAdminUser = { ...mockUser, id: mockAdminId, role: 'admin' };
  const mockDriverUser = { ...mockUser, id: mockDriverId, role: 'driver', isAvailableOnline: false };


  beforeEach(() => {
    jest.clearAllMocks();
    // Reset specific mock implementations if they are changed in tests
    User.findOne.mockReset().mockResolvedValue(null); // Default to user not found
    User.findOneAndUpdate.mockReset().mockResolvedValue(null);
    User.find.mockReset().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        sort: jest.fn().mockResolvedValue([]),
    });
    User.countDocuments.mockReset().mockResolvedValue(0);
    User.findOneAndDelete.mockReset().mockResolvedValue(null);
    // User.prototype.save can be complex if new User().save() is used extensively.
    // The refactored service uses findOneAndUpdate or direct save on found doc.
  });

  describe('getProfile', () => {
    it('should return user profile if user is found', async () => {
      User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(mockUser) });
      const profile = await userService.getProfile(mockUserId);
      expect(User.findOne).toHaveBeenCalledWith({ id: mockUserId });
      expect(profile).toEqual(mockUser);
    });

    it('should throw HttpError 404 if user not found', async () => {
      User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
      await expect(userService.getProfile(mockUserId))
        .rejects.toThrow(new HttpError(404, 'User profile not found.'));
    });

    it('should throw HttpError 500 on database error', async () => {
      User.findOne.mockReturnValue({ select: jest.fn().mockRejectedValue(new Error('DB Read Error')) });
      await expect(userService.getProfile(mockUserId))
        .rejects.toThrow(new HttpError(500, 'Failed to retrieve profile due to an unexpected error.'));
    });
  });

  describe('updateProfile', () => {
    const updateData = { name: 'Updated Name', phone: '+9876543210' };
    const passwordUpdateData = { password: 'newPassword123' };

    it('should update profile successfully', async () => {
      const updatedUserMock = { ...mockUser, ...updateData, toObject: () => ({...mockUser, ...updateData}) };
      User.findOneAndUpdate.mockReturnValue({ select: jest.fn().mockResolvedValue(updatedUserMock) });

      const result = await userService.updateProfile(mockUserId, updateData);
      expect(User.findOneAndUpdate).toHaveBeenCalledWith(
        { id: mockUserId },
        { $set: updateData },
        expect.objectContaining({ new: true, runValidators: true })
      );
      expect(result).toEqual({ message: 'Profile updated successfully.', user: updatedUserMock });
    });

    it('should hash password if provided', async () => {
      bcrypt.hash.mockResolvedValue('hashedNewPassword');
      const updatedUserWithNewPass = { ...mockUser, password: 'hashedNewPassword', toObject: () => ({...mockUser, password: 'hashedNewPassword'}) };
      User.findOneAndUpdate.mockReturnValue({ select: jest.fn().mockResolvedValue(updatedUserWithNewPass) });

      await userService.updateProfile(mockUserId, passwordUpdateData);
      expect(bcrypt.hash).toHaveBeenCalledWith(passwordUpdateData.password, 10);
      expect(User.findOneAndUpdate).toHaveBeenCalledWith(
        { id: mockUserId },
        { $set: { password: 'hashedNewPassword' } },
        expect.anything()
      );
    });

    it('should throw HttpError 400 if no valid fields provided for update', async () => {
      await expect(userService.updateProfile(mockUserId, {}))
        .rejects.toThrow(new HttpError(400, 'No valid fields provided for update.'));
    });

    it('should throw HttpError 404 if user to update not found', async () => {
      User.findOneAndUpdate.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
      await expect(userService.updateProfile(mockUserId, updateData))
        .rejects.toThrow(new HttpError(404, 'User not found for update.'));
    });
  });

  describe('getNotificationPreferences', () => {
    it('should return notification preferences if user is found', async () => {
        User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(mockUser) });
        const prefs = await userService.getNotificationPreferences(mockUserId);
        expect(User.findOne).toHaveBeenCalledWith({ id: mockUserId });
        expect(prefs).toEqual(mockUser.notificationPreferences);
    });

    it('should return default preferences if not set on user', async () => {
        const userWithoutPrefs = { ...mockUser, notificationPreferences: undefined, toObject: () => ({...mockUser, notificationPreferences: undefined}) };
        User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(userWithoutPrefs) });
        const prefs = await userService.getNotificationPreferences(mockUserId);
        expect(prefs).toEqual({ orderUpdates: true, promotions: true }); // As per service default
    });


    it('should throw 404 if user not found', async () => {
        User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
        await expect(userService.getNotificationPreferences(mockUserId))
            .rejects.toThrow(new HttpError(404, 'User not found when fetching notification preferences.'));
    });
  });

  describe('updateNotificationPreferences', () => {
    const prefUpdate = { orderUpdates: false };
    it('should update notification preferences', async () => {
        const updatedUserPrefs = { ...mockUser, notificationPreferences: prefUpdate, toObject: () => ({...mockUser, notificationPreferences: prefUpdate}) };
        User.findOneAndUpdate.mockReturnValue({ select: jest.fn().mockResolvedValue(updatedUserPrefs) });
        
        const result = await userService.updateNotificationPreferences(mockUserId, prefUpdate);
        expect(User.findOneAndUpdate).toHaveBeenCalledWith(
            { id: mockUserId },
            { $set: { 'notificationPreferences.orderUpdates': false } },
            expect.anything()
        );
        expect(result.preferences).toEqual(prefUpdate);
    });

    it('should throw 400 if no valid preferences provided', async () => {
        await expect(userService.updateNotificationPreferences(mockUserId, {}))
            .rejects.toThrow(new HttpError(400, 'No valid notification preferences provided for update.'));
    });
  });


  describe('adminCreateUser', () => {
    const newAdminCreatedUserData = {
        name: 'New Admin User',
        email: 'newadmin@example.com',
        phone: '+234000000000',
        password: 'password123',
        role: 'admin',
    };

    it('should create a user successfully by admin', async () => {
        uuidv4.mockReturnValue('new-admin-user-uuid');
        User.findOne.mockResolvedValue(null); // No existing user with this email
        bcrypt.hash.mockResolvedValue('hashedPasswordForNewAdmin');
        const mockSavedUserInstance = {
            ...newAdminCreatedUserData,
            id: 'new-admin-user-uuid',
            password: 'hashedPasswordForNewAdmin',
            toObject: function() { return { ...this }; } // Simple toObject for testing
        };
        // Mock the constructor and save
        User.mockImplementation(() => ({
            ...mockSavedUserInstance,
            save: jest.fn().mockResolvedValue(mockSavedUserInstance),
        }));


        const result = await userService.adminCreateUser(newAdminCreatedUserData);

        expect(User.findOne).toHaveBeenCalledWith({ email: newAdminCreatedUserData.email.toLowerCase() });
        expect(bcrypt.hash).toHaveBeenCalledWith(newAdminCreatedUserData.password, 10);
        expect(User).toHaveBeenCalledWith(expect.objectContaining({
            id: 'new-admin-user-uuid',
            email: newAdminCreatedUserData.email.toLowerCase(),
            role: 'admin',
        }));
        expect(result.id).toBe('new-admin-user-uuid');
        expect(result.password).toBeUndefined(); // Ensure password is not returned
    });

    it('should throw 409 if email already exists during admin creation', async () => {
        User.findOne.mockResolvedValue({ email: newAdminCreatedUserData.email });
        await expect(userService.adminCreateUser(newAdminCreatedUserData))
            .rejects.toThrow(new HttpError(409, 'Email already exists for admin user creation.'));
    });
  });

  describe('adminUpdateUser', () => {
    const adminUpdateData = { name: 'Admin Updated Name', role: 'driver' };
    it('should update user successfully by admin', async () => {
        const updatedUserByAdmin = { ...mockUser, ...adminUpdateData, toObject: () => ({...mockUser, ...adminUpdateData}) };
        User.findOneAndUpdate.mockReturnValue({ select: jest.fn().mockResolvedValue(updatedUserByAdmin) });
        User.findOne.mockResolvedValue(null); // For email uniqueness check

        const result = await userService.adminUpdateUser(mockUserId, adminUpdateData);
        expect(User.findOneAndUpdate).toHaveBeenCalledWith(
            { id: mockUserId },
            { $set: adminUpdateData },
            expect.anything()
        );
        expect(result.user).toEqual(updatedUserByAdmin);
    });

    it('should throw 409 if updated email already exists for another user', async () => {
        User.findOne.mockResolvedValue({ id: 'another-user-id', email: 'newemail@example.com' }); // Simulates email conflict
        await expect(userService.adminUpdateUser(mockUserId, { email: 'newemail@example.com' }))
            .rejects.toThrow(new HttpError(409, 'Email address is already in use by another account.'));
    });
  });

  describe('deleteUserById', () => {
    it('should delete user successfully', async () => {
        User.findOneAndDelete.mockResolvedValue(mockUser); // Simulate user found and deleted
        const result = await userService.deleteUserById(mockUserId);
        expect(User.findOneAndDelete).toHaveBeenCalledWith({ id: mockUserId });
        expect(result.message).toContain('deleted successfully');
    });

    it('should throw 404 if user to delete not found', async () => {
        User.findOneAndDelete.mockResolvedValue(null);
        await expect(userService.deleteUserById(mockUserId))
            .rejects.toThrow(new HttpError(404, 'User not found for deletion.'));
    });
  });

  describe('updateDriverAvailability', () => {
    it('should update driver availability', async () => {
        const availableDriver = { ...mockDriverUser, isAvailableOnline: true, toObject: () => ({...mockDriverUser, isAvailableOnline: true}) };
        User.findOneAndUpdate.mockReturnValue({ select: jest.fn().mockResolvedValue(availableDriver) });
        
        const result = await userService.updateDriverAvailability(mockDriverId, true);
        expect(User.findOneAndUpdate).toHaveBeenCalledWith(
            { id: mockDriverId, role: 'driver' },
            { $set: { isAvailableOnline: true } },
            expect.anything()
        );
        expect(result.driver.isAvailableOnline).toBe(true);
    });

    it('should throw 404 if driver not found or user is not a driver', async () => {
        User.findOneAndUpdate.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
        await expect(userService.updateDriverAvailability(mockDriverId, true))
            .rejects.toThrow(new HttpError(404, 'Driver not found or user is not a driver.'));
    });
  });

  // Add tests for adminGetUsers, adminGetUser, adminUpdateUserStatus similarly,
  // mocking User.find, User.countDocuments, User.findOneAndUpdate as needed.
  describe('adminGetUsers', () => {
    it('should return a paginated list of users', async () => {
        const usersList = [mockUser, mockAdminUser];
        User.find.mockReturnValue({
            select: jest.fn().mockReturnThis(),
            skip: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            sort: jest.fn().mockResolvedValue(usersList),
        });
        User.countDocuments.mockResolvedValue(2);

        const result = await userService.adminGetUsers({ page: 1, limit: 10 });
        expect(result.users).toEqual(usersList);
        expect(result.totalUsers).toBe(2);
        expect(result.totalPages).toBe(1);
    });
  });

});