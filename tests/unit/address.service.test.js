// tests/unit/address.service.test.js

// 0. Define ALL jest.fn() implementations that will be used by mocks or in tests at the VERY TOP.
const mockAddressSaveImpl = jest.fn();
const mockAddressFindOneImpl = jest.fn();
const mockAddressFindChainedSort = jest.fn().mockResolvedValue([]); // For the .sort().exec() part
const mockAddressFindChained = {
    sort: mockAddressFindChainedSort,
};
const mockAddressFindImpl = jest.fn(() => mockAddressFindChained);
const mockAddressUpdateManyImpl = jest.fn();
const mockAddressDeleteOneImpl = jest.fn();

const mockUserSaveImpl = jest.fn();
const mockUserFindOneImpl = jest.fn();
const mockUserUpdateOneImpl = jest.fn();

const mockUuidV4Impl = jest.fn(); // This is the one causing the current error

// --- 1. Mock Dependencies ---
// Now, when jest.mock('uuid',...) is hoisted, its factory can reference mockUuidV4Impl
// because mockUuidV4Impl's declaration (as a jest.fn()) is also effectively at the top.
jest.mock('uuid', () => ({
  v4: mockUuidV4Impl,
}));

// Use the paths as you had them in your test file, assuming they are correct for your setup.
// If your test file is at `tests/unit/address.service.test.js` and `src` is a sibling of `tests`,
// then `../../src/...` is correct.
const addressModelPath = '../../src/models/address.model';
const userModelPath = '../../src/models/user.model';
const servicePath = '../../src/api/v1/users/address.service';
const httpErrorPath = '../../src/utils/HttpError';


jest.mock(addressModelPath, () => {
  // This factory can now safely reference mockUuidV4Impl because it's defined above
  // and its definition as jest.fn() is available due to hoisting/evaluation order.
  const MockAddress = jest.fn().mockImplementation(data => {
    const instance = { ...data };
    instance.id = data.id || mockUuidV4Impl(); // Use the pre-defined mock function
    instance.save = mockAddressSaveImpl;
    instance.toObject = jest.fn().mockReturnValue(instance);
    return instance;
  });
  MockAddress.findOne = mockAddressFindOneImpl;
  MockAddress.find = mockAddressFindImpl;
  MockAddress.updateMany = mockAddressUpdateManyImpl;
  MockAddress.deleteOne = mockAddressDeleteOneImpl;
  return MockAddress;
});

jest.mock(userModelPath, () => {
  const MockUser = jest.fn().mockImplementation(data => {
    const instance = { ...data };
    instance.id = data.id || mockUuidV4Impl(); // Use the pre-defined mock function
    instance.save = mockUserSaveImpl;
    instance.toObject = jest.fn().mockReturnValue(instance);
    return instance;
  });
  MockUser.findOne = mockUserFindOneImpl;
  MockUser.updateOne = mockUserUpdateOneImpl;
  return MockUser;
});

// --- 2. Import modules AFTER mocks are set up ---
const addressService = require(servicePath);
const Address = require(addressModelPath); // Will get the mocked version
const User = require(userModelPath);       // Will get the mocked version
const HttpError = require(httpErrorPath);
const { v4: uuidv4_imported_for_test_logic_if_needed } = require('uuid'); // This will be mockUuidV4Impl


describe('Address Service', () => {
  const mockUserId = 'user-123';
  const mockAddressId = 'addr-abc';
  let mockUserInstanceForTests; // To be defined in beforeEach for clarity

  beforeEach(() => {
    jest.clearAllMocks(); // Clears call history, mock implementations, and reset states

    // Reset the top-level mock function implementations
    mockAddressSaveImpl.mockReset();
    mockAddressFindOneImpl.mockReset();
    mockAddressFindImpl.mockClear().mockReturnValue(mockAddressFindChained);
    mockAddressFindChained.sort.mockClear().mockResolvedValue([]);
    mockAddressUpdateManyImpl.mockReset().mockResolvedValue({ acknowledged: true, modifiedCount: 1 });
    mockAddressDeleteOneImpl.mockReset().mockResolvedValue({ acknowledged: true, deletedCount: 1 });

    mockUserSaveImpl.mockReset();
    mockUserFindOneImpl.mockReset();
    mockUserUpdateOneImpl.mockReset().mockResolvedValue({ acknowledged: true, modifiedCount: 1 });
    
    mockUuidV4Impl.mockReset().mockReturnValue('default-new-uuid');

    // Setup default mockUserInstance for tests that require User.findOne to resolve
    mockUserInstanceForTests = {
        id: mockUserId,
        defaultAddressId: null,
        save: mockUserSaveImpl,
        toObject: jest.fn(function() { return {...this, save: undefined}; }),
    };
    mockUserFindOneImpl.mockResolvedValue(mockUserInstanceForTests);
  });

  const mockAddressData = {
    label: 'Home',
    fullAddress: '123 Main St, Anytown',
    street: '123 Main St',
    city: 'Anytown',
    state: 'Anystate',
    country: 'CountryLand',
    isDefault: false,
  };
  
  const mockResolvedAddressInstance = { // A typical instance Address.findOne might resolve to
    ...mockAddressData,
    id: mockAddressId,
    userId: mockUserId,
    save: mockAddressSaveImpl,
    toObject: jest.fn(function() { return {...this, save: undefined}; }),
  };


  describe('getAddresses', () => {
    it('should return an array of addresses for the user, sorted by createdAt descending', async () => {
      const addressesToReturn = [
        { ...mockResolvedAddressInstance, id: 'addr-1', toObject: () => ({...mockResolvedAddressInstance, id: 'addr-1'}) },
        { ...mockResolvedAddressInstance, id: 'addr-2', toObject: () => ({...mockResolvedAddressInstance, id: 'addr-2'}) }
      ];
      mockAddressFindChained.sort.mockResolvedValue(addressesToReturn);

      const result = await addressService.getAddresses(mockUserId);
      expect(Address.find).toHaveBeenCalledWith({ userId: mockUserId });
      expect(mockAddressFindChained.sort).toHaveBeenCalledWith({ createdAt: -1 });
      expect(result).toEqual(addressesToReturn);
    });

    it('should return an empty array if user has no addresses', async () => {
      mockAddressFindChained.sort.mockResolvedValue([]);
      const result = await addressService.getAddresses(mockUserId);
      expect(result).toEqual([]);
    });

    it('should throw HttpError 500 on database error', async () => {
      mockAddressFindChained.sort.mockRejectedValue(new Error('DB Error'));
      await expect(addressService.getAddresses(mockUserId))
        .rejects.toThrow(new HttpError(500, 'Failed to retrieve addresses due to an unexpected error.'));
    });
  });

  describe('createAddress', () => {
    beforeEach(() => {
        mockUuidV4Impl.mockReturnValue('new-addr-uuid');
    });

    it('should create and save a new address', async () => {
      // Mock what the 'save' on the instance returned by 'new Address()' will do
      mockAddressSaveImpl.mockImplementation(function() { return Promise.resolve(this); });

      const result = await addressService.createAddress(mockUserId, mockAddressData);
      
      expect(Address).toHaveBeenCalledWith(expect.objectContaining({
        ...mockAddressData,
        userId: mockUserId,
        id: 'new-addr-uuid' 
      }));
      expect(mockAddressSaveImpl).toHaveBeenCalled();
      // The result from service is newAddress.toObject(). Our mock instance's toObject returns the instance.
      expect(result).toEqual(expect.objectContaining({ id: 'new-addr-uuid', ...mockAddressData }));
      expect(mockUserUpdateOneImpl).not.toHaveBeenCalled();
      expect(mockAddressUpdateManyImpl).not.toHaveBeenCalled();
    });

    it('should set new address as default if isDefault is true', async () => {
      mockAddressSaveImpl.mockImplementation(function() { return Promise.resolve(this); }); // Save returns the instance

      await addressService.createAddress(mockUserId, { ...mockAddressData, isDefault: true });
      expect(mockAddressSaveImpl).toHaveBeenCalled();
      expect(mockUserUpdateOneImpl).toHaveBeenCalledWith({ id: mockUserId }, { $set: { defaultAddressId: 'new-addr-uuid' } });
      expect(mockAddressUpdateManyImpl).toHaveBeenCalledWith({ userId: mockUserId, id: { $ne: 'new-addr-uuid' } }, { $set: { isDefault: false } });
    });
    
    it('should throw HttpError 500 if saving address fails', async () => {
      mockAddressSaveImpl.mockRejectedValueOnce(new Error('DB Save Error'));
      await expect(addressService.createAddress(mockUserId, mockAddressData))
        .rejects.toThrow(new HttpError(500, 'Failed to create address due to an unexpected error.'));
    });
    
    it('should throw HttpError 500 if updating User model fails when setting default', async () => {
        mockAddressSaveImpl.mockImplementation(function() { return Promise.resolve(this); });
        mockUserUpdateOneImpl.mockRejectedValueOnce(new Error('User update error'));
        await expect(addressService.createAddress(mockUserId, { ...mockAddressData, isDefault: true }))
            .rejects.toThrow(new HttpError(500, 'Failed to create address due to an unexpected error.'));
    });
  });

  describe('updateAddress', () => {
    const updatePayload = { label: 'Work', city: 'New City' };
    let currentAddressMockInstance;

    beforeEach(() => {
        currentAddressMockInstance = { 
            ...mockAddressData, 
            id: mockAddressId, 
            userId: mockUserId, 
            isDefault: false,
            save: mockAddressSaveImpl,
            toObject: jest.fn(function() { return {...this, save:undefined}; })
        };
        mockAddressFindOneImpl.mockResolvedValue(currentAddressMockInstance);
        // mockUserFindOneImpl is already set in global beforeEach to resolve with mockUserInstanceForTests
    });

    it('should update an existing address', async () => {
      mockAddressSaveImpl.mockImplementation(function() { return Promise.resolve(this); });
      
      const result = await addressService.updateAddress(mockUserId, mockAddressId, updatePayload);
      expect(mockAddressFindOneImpl).toHaveBeenCalledWith({ id: mockAddressId, userId: mockUserId });
      expect(currentAddressMockInstance.label).toBe('Work'); // Check if properties were updated on the mock
      expect(currentAddressMockInstance.city).toBe('New City');
      expect(mockAddressSaveImpl).toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining(updatePayload));
    });

    it('should set address as default during update if isDefault is true', async () => {
      mockAddressSaveImpl.mockImplementation(function() { return Promise.resolve(this); });
      
      await addressService.updateAddress(mockUserId, mockAddressId, { ...updatePayload, isDefault: true });
      expect(currentAddressMockInstance.isDefault).toBe(true);
      expect(mockUserUpdateOneImpl).toHaveBeenCalledWith({ id: mockUserId }, { $set: { defaultAddressId: mockAddressId } });
      expect(mockAddressUpdateManyImpl).toHaveBeenCalledWith({ userId: mockUserId, id: { $ne: mockAddressId } }, { $set: { isDefault: false } });
    });
    
    it('should unset address as default and clear user defaultAddressId if it was the default', async () => {
        currentAddressMockInstance.isDefault = true;
        mockUserInstanceForTests.defaultAddressId = mockAddressId; // User's default is this address
        mockAddressFindOneImpl.mockResolvedValue(currentAddressMockInstance);
        mockUserFindOneImpl.mockResolvedValue(mockUserInstanceForTests); // Ensure User.findOne returns this
        mockAddressSaveImpl.mockImplementation(function() { return Promise.resolve(this); });

        await addressService.updateAddress(mockUserId, mockAddressId, { isDefault: false });
        expect(currentAddressMockInstance.isDefault).toBe(false);
        expect(mockUserUpdateOneImpl).toHaveBeenCalledWith({ id: mockUserId }, { $set: { defaultAddressId: null } });
    });

    it('should throw HttpError 404 if address not found for update', async () => {
      mockAddressFindOneImpl.mockResolvedValue(null);
      await expect(addressService.updateAddress(mockUserId, mockAddressId, updatePayload))
        .rejects.toThrow(new HttpError(404, 'Address not found or you do not have permission to update it.'));
    });
  });

  describe('setDefaultAddress', () => {
    let addressToSetDefault;
    beforeEach(() => {
        addressToSetDefault = { 
            ...mockAddressData, 
            id: mockAddressId, 
            userId: mockUserId, 
            isDefault: false, 
            save: mockAddressSaveImpl,
            toObject: jest.fn(function() { return {...this, save:undefined}; })
        };
        mockAddressFindOneImpl.mockResolvedValue(addressToSetDefault);
    });

    it('should set the specified address as default', async () => {
      mockAddressSaveImpl.mockImplementation(function() { return Promise.resolve(this); });
      mockUserUpdateOneImpl.mockResolvedValue({ acknowledged: true, modifiedCount: 1 });
      mockAddressUpdateManyImpl.mockResolvedValue({ acknowledged: true, modifiedCount: 1 });

      const result = await addressService.setDefaultAddress(mockUserId, mockAddressId);
      expect(mockAddressFindOneImpl).toHaveBeenCalledWith({ id: mockAddressId, userId: mockUserId });
      expect(mockAddressUpdateManyImpl).toHaveBeenCalledWith(
        { userId: mockUserId, id: { $ne: mockAddressId }, isDefault: true },
        { $set: { isDefault: false } }
      );
      expect(addressToSetDefault.isDefault).toBe(true);
      expect(mockAddressSaveImpl).toHaveBeenCalled(); // On addressToSetDefault instance
      expect(mockUserUpdateOneImpl).toHaveBeenCalledWith({ id: mockUserId }, { $set: { defaultAddressId: mockAddressId } });
      expect(result.message).toBe('Default address set successfully.');
    });

    it('should return message if address is already default', async () => {
      addressToSetDefault.isDefault = true;
      mockAddressFindOneImpl.mockResolvedValue(addressToSetDefault);
      const result = await addressService.setDefaultAddress(mockUserId, mockAddressId);
      expect(result.message).toBe('Address is already the default.');
      expect(mockAddressSaveImpl).not.toHaveBeenCalled();
    });

    it('should throw HttpError 404 if address not found', async () => {
      mockAddressFindOneImpl.mockResolvedValue(null);
      await expect(addressService.setDefaultAddress(mockUserId, mockAddressId))
        .rejects.toThrow(new HttpError(404, 'Address not found or you do not have permission to set it as default.'));
    });
  });

  describe('deleteAddress', () => {
    let addressToDeleteInstance;
    beforeEach(() => {
        // Ensure mockAddressInstanceForTests.save is the mock we can control
        addressToDeleteInstance = { ...mockResolvedAddressInstance }; // Use a clean copy
        addressToDeleteInstance.save = mockAddressSaveImpl; // Ensure it has the correct save mock

        mockAddressFindOneImpl.mockResolvedValue(addressToDeleteInstance);
        mockAddressDeleteOneImpl.mockResolvedValue({ acknowledged: true, deletedCount: 1 });
        // User.findOne will use mockUserFindOneImpl which resolves to mockUserInstanceForTests by default
    });

    it('should delete an address successfully', async () => {
      mockUserInstanceForTests.defaultAddressId = 'other-addr-id'; // Not the default
      mockUserFindOneImpl.mockResolvedValue(mockUserInstanceForTests);

      const result = await addressService.deleteAddress(mockUserId, mockAddressId);
      expect(mockAddressFindOneImpl).toHaveBeenCalledWith({ id: mockAddressId, userId: mockUserId });
      expect(mockAddressDeleteOneImpl).toHaveBeenCalledWith({ id: mockAddressId, userId: mockUserId });
      expect(mockUserUpdateOneImpl).not.toHaveBeenCalled();
      expect(result.message).toBe('Address deleted successfully.');
    });

    it('should delete an address and clear user defaultAddressId if it was the default', async () => {
      mockUserInstanceForTests.defaultAddressId = mockAddressId; // This address IS the default
      mockUserFindOneImpl.mockResolvedValue(mockUserInstanceForTests);

      await addressService.deleteAddress(mockUserId, mockAddressId);
      expect(mockAddressDeleteOneImpl).toHaveBeenCalledWith({ id: mockAddressId, userId: mockUserId });
      expect(mockUserUpdateOneImpl).toHaveBeenCalledWith({ id: mockUserId }, { $set: { defaultAddressId: null } });
    });

    it('should throw HttpError 404 if address not found for deletion', async () => {
      mockAddressFindOneImpl.mockResolvedValue(null);
      await expect(addressService.deleteAddress(mockUserId, mockAddressId))
        .rejects.toThrow(new HttpError(404, 'Address not found or you do not have permission to delete it.'));
    });
    
    it('should throw HttpError 500 if User.findOne fails during delete default check', async () => {
        mockAddressFindOneImpl.mockResolvedValue(addressToDeleteInstance);
        mockUserFindOneImpl.mockRejectedValue(new Error('DB error finding user'));
        await expect(addressService.deleteAddress(mockUserId, mockAddressId))
            .rejects.toThrow(new HttpError(500, 'Failed to delete address due to an unexpected error.'));
    });
  });
});