// tests/unit/api/v1/referrals/referral.service.js
// OR src/api/v1/referrals/referral.service.js

// We need to mock generateUniqueReferralCode *before* importing the service
// if it's an unexported helper. Or, we can spyOn it if the service is structured differently.
// For this example, we'll assume we can mock it via jest.mock for the whole module if it were imported,
// or we can use a more targeted approach if it's an internal unexported function.
// A cleaner way for internal functions is often to test their effects through the public API.
// Let's assume generateUniqueReferralCode is not directly exported and test its effect.
// We will mock crypto directly to control code generation.

const referralService = require('../../src/api/v1/referrals/referral.service'); // Adjust path
const User = require('../../src/models/user.model'); // Adjust path
const Referral = require('../../src/models/referral.model'); // Adjust path
const HttpError = require('../../src/utils/HttpError'); // Adjust path
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

// --- Mocking Dependencies ---
jest.mock('../../src/models/user.model');
jest.mock('../../src/models/referral.model');
jest.mock('uuid', () => ({
  v4: jest.fn(),
}));
jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'), // Import and retain default behavior
  randomBytes: jest.fn(), // Mock only randomBytes
}));


// Constants from the service (or mock them if they were from a config service)
const DEFAULT_PROGRAM_DESCRIPTION = "Share your code with friends! They get a discount, and you get rewards.";
const DEFAULT_BENEFIT_SELF = "Get N500 off your next order for every successful referral.";
const DEFAULT_BENEFIT_FRIEND = "Get 10% off their first order.";

describe('Referral Service', () => {
  const mockUserId = 'user-123';
  let mockUserFindOne, mockReferralFindOne, mockReferralSave;

  const mockUser = {
    id: mockUserId,
    name: 'Test Referrer',
    toObject: () => mockUser,
  };

  const mockExistingReferral = {
    id: 'ref-doc-uuid-existing',
    userId: mockUserId,
    referralCode: 'EXISTINGCODE',
    programDescription: DEFAULT_PROGRAM_DESCRIPTION,
    benefitSelf: DEFAULT_BENEFIT_SELF,
    benefitFriend: DEFAULT_BENEFIT_FRIEND,
    toObject: function() { return { ...this, save: undefined }; },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockUserFindOne = jest.fn(); User.findOne = mockUserFindOne;
    mockReferralFindOne = jest.fn(); Referral.findOne = mockReferralFindOne;
    
    mockReferralSave = jest.fn().mockImplementation(function() {
        return Promise.resolve({ ...this, toObject: () => ({...this}) });
    });
    // When new Referral() is called, the instance should have the mocked save
    Referral.mockImplementation((data) => ({
        ...data,
        save: mockReferralSave,
        toObject: function() { return {...this, save: undefined}; }
    }));

    uuidv4.mockReturnValue('new-ref-doc-uuid');
    // Default mock for crypto.randomBytes to generate a predictable code
    // Buffer.from('uniquecode').toString('hex') -> '756e69717565636f6465' (length 20)
    // To get length 8, we need 4 bytes: crypto.randomBytes(4).toString('hex')
    crypto.randomBytes.mockReturnValue(Buffer.from('uniqcode')); // .toString('hex') -> '756e6971636f6465'
  });

  describe('getReferralInformation', () => {
    it('should return existing referral information if found', async () => {
      mockUserFindOne.mockResolvedValue(mockUser);
      mockReferralFindOne.mockResolvedValue(mockExistingReferral); // User already has referral info

      const result = await referralService.getReferralInformation(mockUserId);

      expect(User.findOne).toHaveBeenCalledWith({ id: mockUserId });
      expect(Referral.findOne).toHaveBeenCalledWith({ userId: mockUserId });
      expect(Referral).not.toHaveBeenCalledWith(expect.objectContaining({ userId: mockUserId })); // Constructor not called for new
      expect(mockReferralSave).not.toHaveBeenCalled();
      expect(result).toEqual(mockExistingReferral);
    });

    it('should create and return new referral information if none exists for the user', async () => {
      mockUserFindOne.mockResolvedValue(mockUser);
      mockReferralFindOne
        .mockResolvedValueOnce(null) // First call by getReferralInformation (user has no referral)
        .mockResolvedValueOnce(null); // Second call by generateUniqueReferralCode (first code attempt is unique)

      const expectedNewReferralCode = Buffer.from('uniqcode').toString('hex').slice(0, 8).toUpperCase(); // "756E6971"

      const result = await referralService.getReferralInformation(mockUserId);

      expect(User.findOne).toHaveBeenCalledWith({ id: mockUserId });
      expect(Referral.findOne).toHaveBeenCalledTimes(2); // Once by getReferralInfo, once by generateUniqueReferralCode
      expect(crypto.randomBytes).toHaveBeenCalledWith(4); // For length 8 code
      expect(Referral).toHaveBeenCalledWith({ // Constructor called
        id: 'new-ref-doc-uuid',
        userId: mockUserId,
        referralCode: expectedNewReferralCode,
        programDescription: DEFAULT_PROGRAM_DESCRIPTION,
        benefitSelf: DEFAULT_BENEFIT_SELF,
        benefitFriend: DEFAULT_BENEFIT_FRIEND,
      });
      expect(mockReferralSave).toHaveBeenCalledTimes(1);
      expect(result).toEqual(expect.objectContaining({
        userId: mockUserId,
        referralCode: expectedNewReferralCode,
        programDescription: DEFAULT_PROGRAM_DESCRIPTION,
      }));
    });

    it('should generate a different code if the first generated code collides', async () => {
        mockUserFindOne.mockResolvedValue(mockUser);
        mockReferralFindOne
            .mockResolvedValueOnce(null)    // User has no referral initially
            .mockResolvedValueOnce({ id: 'someOtherRef', referralCode: '756E6971' }) // First code ("UNIQCODE") collides
            .mockResolvedValueOnce(null);   // Second code ("NEWCODE1") is unique

        crypto.randomBytes
            .mockReturnValueOnce(Buffer.from('uniqcode')) // -> 756E6971
            .mockReturnValueOnce(Buffer.from('newcode1'));// -> 6E657763

        const expectedUniqueCode = Buffer.from('newcode1').toString('hex').slice(0, 8).toUpperCase(); // "6E657763"

        const result = await referralService.getReferralInformation(mockUserId);

        expect(Referral.findOne).toHaveBeenCalledTimes(3); // 1 for user, 2 for code generation
        expect(crypto.randomBytes).toHaveBeenCalledTimes(2);
        expect(Referral).toHaveBeenCalledWith(expect.objectContaining({ referralCode: expectedUniqueCode }));
        expect(mockReferralSave).toHaveBeenCalledTimes(1);
        expect(result.referralCode).toBe(expectedUniqueCode);
    });

    it('should throw HttpError 404 if user not found', async () => {
      mockUserFindOne.mockResolvedValue(null);
      await expect(referralService.getReferralInformation(mockUserId))
        .rejects.toThrow(new HttpError(404, 'User not found.'));
    });

    it('should throw HttpError 500 if User.findOne fails', async () => {
      mockUserFindOne.mockRejectedValue(new Error('DB User Error'));
      await expect(referralService.getReferralInformation(mockUserId))
        .rejects.toThrow(new HttpError(500, 'Failed to retrieve referral information due to an unexpected error.'));
    });
    
    it('should throw HttpError 500 if Referral.findOne (initial check) fails', async () => {
      mockUserFindOne.mockResolvedValue(mockUser);
      mockReferralFindOne.mockRejectedValueOnce(new Error('DB Referral Find Error')); // Fails on initial check
      await expect(referralService.getReferralInformation(mockUserId))
        .rejects.toThrow(new HttpError(500, 'Failed to retrieve referral information due to an unexpected error.'));
    });
    
    it('should throw HttpError 500 if Referral.findOne (in generateUniqueReferralCode) fails', async () => {
      mockUserFindOne.mockResolvedValue(mockUser);
      mockReferralFindOne
        .mockResolvedValueOnce(null) // Initial find is null (triggering code gen)
        .mockRejectedValueOnce(new Error('DB Referral Find Error during code gen')); // Fails during code uniqueness check
      
      await expect(referralService.getReferralInformation(mockUserId))
        .rejects.toThrow(new HttpError(500, 'Failed to retrieve referral information due to an unexpected error.'));
    });

    it('should throw HttpError 500 if new Referral save fails', async () => {
      mockUserFindOne.mockResolvedValue(mockUser);
      mockReferralFindOne.mockResolvedValue(null); // No existing referral
      crypto.randomBytes.mockReturnValue(Buffer.from('goodcode'));
      mockReferralSave.mockRejectedValueOnce(new Error('DB Referral Save Error'));

      await expect(referralService.getReferralInformation(mockUserId))
        .rejects.toThrow(new HttpError(500, 'Failed to retrieve referral information due to an unexpected error.'));
    });
  });

  // You could add separate tests for generateUniqueReferralCode if it were exported
  // and you wanted to test its collision retry logic more directly.
  describe('generateUniqueReferralCode (conceptual tests if it were exportable)', () => {
    // These tests illustrate how you'd test the helper if it were directly testable.
    // Since it's internal, its effects are tested via getReferralInformation.

    it('should generate a code of specified length', async () => {
        mockReferralFindOne.mockResolvedValue(null); // Assume no collision
        crypto.randomBytes.mockReturnValue(Buffer.from('testcode')); // hex: 74657374636f6465
        // To directly test the internal helper if it were exposed:
        // const code = await referralService.generateUniqueReferralCode(6);
        // expect(code).toHaveLength(6);
        // expect(code).toBe('746573'); // First 6 chars of hex of 'testco'
        // For now, this logic is tested via getReferralInformation
    });

    it('should retry if a code collision occurs', async () => {
        const firstCodeBuffer = Buffer.from('collide1');
        const secondCodeBuffer = Buffer.from('unique 2');
        crypto.randomBytes
            .mockReturnValueOnce(firstCodeBuffer)  // First attempt (will collide)
            .mockReturnValueOnce(secondCodeBuffer); // Second attempt (will be unique)

        const collidingCode = firstCodeBuffer.toString('hex').slice(0, 8).toUpperCase();
        
        mockReferralFindOne
            .mockResolvedValueOnce({ referralCode: collidingCode }) // First call finds a collision
            .mockResolvedValueOnce(null);                          // Second call finds no collision

        // If generateUniqueReferralCode were exported:
        // const uniqueCode = await referralService.generateUniqueReferralCode(8);
        // expect(Referral.findOne).toHaveBeenCalledTimes(2);
        // expect(crypto.randomBytes).toHaveBeenCalledTimes(2);
        // expect(uniqueCode).toBe(secondCodeBuffer.toString('hex').slice(0, 8).toUpperCase());
        // This logic is indirectly tested by the getReferralInformation collision test.
    });
  });
});