// tests/unit/api/v1/promotions/promotion.service.test.js
const promotionService = require('../../src/api/v1/promotions/promotion.service.js');
const Promotion = require('../../src/models/promotion.model.js');
const { redisClient } = require('../../src/config/database.config.js');
const HttpError = require('../../src/utils/HttpError.js');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('../../src/config/logger.config.js'); // Import logger

// --- Top-level Mock Implementations ---
const mockPromotionSaveImpl = jest.fn();
const mockPromotionFindOneImpl = jest.fn();

const mockPromotionFindChainedSort = jest.fn();
const mockPromotionFindChainedSkip = jest.fn();
const mockPromotionFindChainedLimit = jest.fn();
const mockPromotionFindChained = {
    sort: mockPromotionFindChainedSort,
    skip: mockPromotionFindChainedSkip,
    limit: mockPromotionFindChainedLimit,
    // exec: jest.fn() // if using exec
};
const mockPromotionFindImpl = jest.fn(() => mockPromotionFindChained);
const mockPromotionCountDocumentsImpl = jest.fn();

const mockUuidV4Impl = jest.fn();

// --- Mocking Dependencies ---
jest.mock('uuid', () => ({
  v4: mockUuidV4Impl,
}));

jest.mock('../../src/models/promotion.model.js', () => {
  const MockPromotion = jest.fn().mockImplementation(data => {
    const instance = { ...data };
    instance.id = data.id || mockUuidV4Impl(); // Use the top-level mock
    instance.save = mockPromotionSaveImpl;
    // Consistent toObject that returns a plain object without functions
    instance.toObject = jest.fn(function() {
        const plainObject = { ...this };
        delete plainObject.save; // Remove mock functions
        delete plainObject.toObject;
        // Convert Date objects to ISO strings for consistent comparison if needed
        if (plainObject.validFrom instanceof Date) plainObject.validFrom = plainObject.validFrom.toISOString();
        if (plainObject.validUntil instanceof Date) plainObject.validUntil = plainObject.validUntil.toISOString();
        if (plainObject.createdAt instanceof Date) plainObject.createdAt = plainObject.createdAt.toISOString();
        if (plainObject.updatedAt instanceof Date) plainObject.updatedAt = plainObject.updatedAt.toISOString();
        return plainObject;
    });
    return instance;
  });
  MockPromotion.findOne = mockPromotionFindOneImpl;
  MockPromotion.find = mockPromotionFindImpl;
  MockPromotion.countDocuments = mockPromotionCountDocumentsImpl;
  return MockPromotion;
});

jest.mock('../../src/config/database.config.js', () => ({
  redisClient: {
    get: jest.fn(),
    setEx: jest.fn(),
    del: jest.fn(),
    keys: jest.fn(), // Kept from your original test mock
    isOpen: true,
  },
}));

jest.mock('../../src/config/logger.config.js', () => ({ // Mock logger to spy on it
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }
}));


describe('Promotion Service', () => {
  const mockPromoId = 'promo-uuid-123';
  const mockPromotionRawData = { // Data without methods, with real dates
    title: 'Summer Sale',
    shortDescription: 'Get 20% off on all summer items!',
    promoCode: 'SUMMER20',
    isActive: true,
    validFrom: new Date('2025-06-01T00:00:00.000Z'),
    validUntil: new Date('2025-08-31T23:59:59.000Z'),
    type: 'Percentage Discount',
    value: 20,
  };
  
  // Helper to create a mock instance that behaves like a Mongoose document for tests
  const createMockPromotionInstance = (data) => {
    const instanceData = { ...data, id: data.id || mockUuidV4Impl() };
    return {
        ...instanceData,
        save: mockPromotionSaveImpl,
        toObject: jest.fn(() => { // Consistent toObject for comparison
            const plain = { ...instanceData };
             if (plain.validFrom instanceof Date) plain.validFrom = plain.validFrom.toISOString();
             if (plain.validUntil instanceof Date) plain.validUntil = plain.validUntil.toISOString();
            return plain;
        })
    };
  };


  beforeEach(() => {
    jest.clearAllMocks();
    mockUuidV4Impl.mockReturnValue(mockPromoId);

    mockPromotionSaveImpl.mockReset();
    mockPromotionFindOneImpl.mockReset();
    mockPromotionCountDocumentsImpl.mockReset().mockResolvedValue(0);

    // Reset chained mocks for Promotion.find()
    mockPromotionFindImpl.mockClear().mockReturnValue(mockPromotionFindChained);
    mockPromotionFindChainedSort.mockClear().mockReturnThis();
    mockPromotionFindChainedSkip.mockClear().mockReturnThis();
    mockPromotionFindChainedLimit.mockClear().mockResolvedValue([]); // Default limit to resolve empty

    // Reset Redis client mocks
    redisClient.get.mockReset();
    redisClient.setEx.mockReset();
    redisClient.del.mockReset();
    redisClient.keys.mockReset().mockResolvedValue([]);
  });

  describe('getActivePromotions', () => {
    const cacheKey = promotionService.ACTIVE_PROMOTIONS_CACHE_KEY; // Use exported key
    const activePromosData = [createMockPromotionInstance(mockPromotionRawData)];
    // Data as it would be after toObject() and JSON stringify/parse (dates as strings)
    const activePromosAsCached = activePromosData.map(p => p.toObject());


    it('should return active promotions from cache if available', async () => {
      redisClient.get.mockResolvedValue(JSON.stringify(activePromosAsCached));
      const result = await promotionService.getActivePromotions();
      expect(redisClient.get).toHaveBeenCalledWith(cacheKey);
      expect(Promotion.find).not.toHaveBeenCalled();
      expect(result).toEqual(activePromosAsCached);
    });

    it('should fetch from DB, cache, and return active promotions if not in cache', async () => {
      redisClient.get.mockResolvedValue(null);
      mockPromotionFindChainedSort.mockResolvedValue(activePromosData); // DB returns Mongoose-like docs
      redisClient.setEx.mockResolvedValue('OK');

      const result = await promotionService.getActivePromotions();
      expect(redisClient.get).toHaveBeenCalledWith(cacheKey);
      expect(Promotion.find).toHaveBeenCalledWith({
        isActive: true,
        validFrom: { $lte: expect.any(Date) },
        validUntil: { $gte: expect.any(Date) },
      });
      expect(redisClient.setEx).toHaveBeenCalledWith(cacheKey, CACHE_EXPIRY_SECONDS, JSON.stringify(activePromosAsCached));
      expect(result).toEqual(activePromosAsCached);
    });

    it('should return empty array if no active promotions found in DB and not in cache', async () => {
        redisClient.get.mockResolvedValue(null);
        mockPromotionFindChainedSort.mockResolvedValue([]);
        const result = await promotionService.getActivePromotions();
        expect(result).toEqual([]);
        expect(redisClient.setEx).toHaveBeenCalledWith(cacheKey, 3600, JSON.stringify([]));
    });

    it('should still fetch from DB if redisClient.get fails, and attempt to set cache', async () => {
        redisClient.get.mockRejectedValue(new Error('Redis GET error'));
        mockPromotionFindChainedSort.mockResolvedValue(activePromosData);
        redisClient.setEx.mockResolvedValue('OK'); // Assume setEx would work

        const result = await promotionService.getActivePromotions();
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('[PROMOTION_SERVICE] Redis GET error'), expect.any(Error));
        expect(Promotion.find).toHaveBeenCalled();
        expect(redisClient.setEx).toHaveBeenCalled();
        expect(result).toEqual(activePromosAsCached);
    });

    it('should return DB result even if redisClient.setEx fails', async () => {
        redisClient.get.mockResolvedValue(null);
        mockPromotionFindChainedSort.mockResolvedValue(activePromosData);
        redisClient.setEx.mockRejectedValue(new Error('Redis SETEX error'));

        const result = await promotionService.getActivePromotions();
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('[PROMOTION_SERVICE] Redis SETEX error'), expect.any(Error));
        expect(result).toEqual(activePromosAsCached);
    });

    it('should throw HttpError 500 if database find operation fails', async () => {
        redisClient.get.mockResolvedValue(null); // Assume cache miss or Redis get error (handled by service)
        mockPromotionFindChainedSort.mockRejectedValue(new Error('DB Find Error'));
        await expect(promotionService.getActivePromotions())
            .rejects.toThrow(new HttpError(500, 'Failed to retrieve active promotions.'));
    });
  });

  describe('getPromotions (Admin)', () => {
    const mockAdminPromosData = [createMockPromotionInstance(mockPromotionRawData)];
    const mockAdminPromosAsPlain = mockAdminPromosData.map(p => p.toObject());

    it('should return paginated list of all promotions', async () => {
      mockPromotionFindChainedLimit.mockResolvedValue(mockAdminPromosData);
      mockPromotionCountDocumentsImpl.mockResolvedValue(mockAdminPromosData.length);

      const result = await promotionService.getPromotions({ page: 1, limit: 10 });
      expect(Promotion.find).toHaveBeenCalledWith({});
      expect(mockPromotionFindChainedSort).toHaveBeenCalledWith({ createdAt: -1 });
      expect(mockPromotionFindChainedSkip).toHaveBeenCalledWith(0);
      expect(mockPromotionFindChainedLimit).toHaveBeenCalledWith(10);
      expect(result.promotions).toEqual(mockAdminPromosAsPlain);
      expect(result.totalPromotions).toBe(mockAdminPromosData.length);
    });
  });

  describe('getPromotion (Admin)', () => {
    const mockSinglePromoInstance = createMockPromotionInstance(mockPromotionRawData);
    const mockSinglePromoPlain = mockSinglePromoInstance.toObject();


    it('should return a single promotion by ID', async () => {
      mockPromotionFindOneImpl.mockResolvedValue(mockSinglePromoInstance);
      const result = await promotionService.getPromotion(mockPromoId);
      expect(Promotion.findOne).toHaveBeenCalledWith({ id: mockPromoId });
      expect(result).toEqual(mockSinglePromoPlain);
    });

    it('should throw HttpError 404 if promotion not found', async () => {
      mockPromotionFindOneImpl.mockResolvedValue(null);
      await expect(promotionService.getPromotion(mockPromoId))
        .rejects.toThrow(new HttpError(404, 'Promotion not found.'));
    });
  });

  describe('createPromotion (Admin)', () => {
    // The Promotion mock constructor is already set up at the top level
    // and will use mockPromotionSaveImpl and mockUuidV4Impl.

    it('should create a new promotion successfully and invalidate cache', async () => {
      mockPromotionFindOneImpl.mockResolvedValue(null); // No existing promo with same code
      mockUuidV4Impl.mockReturnValue('new-promo-uuid-xyz'); // Specific UUID for this test
      // Simulate that the save method on the instance returns the instance (or its toObject version)
      mockPromotionSaveImpl.mockImplementation(function() { return Promise.resolve(this.toObject()); });
      redisClient.del.mockResolvedValue(1);


      const result = await promotionService.createPromotion(mockPromotionRawData);
      
      expect(Promotion.findOne).toHaveBeenCalledWith({ promoCode: mockPromotionRawData.promoCode.toUpperCase() });
      expect(Promotion).toHaveBeenCalledWith(expect.objectContaining({
        id: 'new-promo-uuid-xyz',
        promoCode: mockPromotionRawData.promoCode.toUpperCase(),
      }));
      expect(mockPromotionSaveImpl).toHaveBeenCalled();
      expect(redisClient.del).toHaveBeenCalledWith(promotionService.ACTIVE_PROMOTIONS_CACHE_KEY);
      expect(result.id).toBe('new-promo-uuid-xyz');
      expect(result.title).toBe(mockPromotionRawData.title);
    });

    it('should throw HttpError 409 if promo code already exists', async () => {
      mockPromotionFindOneImpl.mockResolvedValue(createMockPromotionInstance(mockPromotionRawData)); // Promo code exists
      await expect(promotionService.createPromotion(mockPromotionRawData))
        .rejects.toThrow(new HttpError(409, `Promo code '${mockPromotionRawData.promoCode}' already exists.`));
    });
    
    it('should still create promotion if redisClient.del fails but log it', async () => {
        mockPromotionFindOneImpl.mockResolvedValue(null);
        mockPromotionSaveImpl.mockImplementation(function() { return Promise.resolve(this.toObject()); });
        redisClient.del.mockRejectedValue(new Error('Redis DEL error'));
        
        // Spy on logger.error as the service should log this
        const loggerErrorSpy = jest.spyOn(logger, 'error');

        await expect(promotionService.createPromotion(mockPromotionRawData)).resolves.toBeDefined();
        expect(mockPromotionSaveImpl).toHaveBeenCalled();
        expect(loggerErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining('[PROMOTION_SERVICE] Error clearing active promotions cache:'),
            expect.any(Error)
        );
        loggerErrorSpy.mockRestore();
    });
  });

  describe('updatePromotion (Admin)', () => {
    const updatePayload = { title: 'Mega Summer Sale Updated', value: 25 };
    let existingPromoMock;

    beforeEach(() => {
        // Create a fresh mock for each test to avoid state leakage
        existingPromoMock = createMockPromotionInstance({ ...mockPromotionRawData, id: mockPromoId });
        mockPromotionFindOneImpl.mockImplementation(query => {
            if (query.id === mockPromoId && !query.promoCode) { // Initial find for update
                return Promise.resolve(existingPromoMock);
            }
            if (query.promoCode && query.id && query.id.$ne === mockPromoId) { // uniqueness check
                return Promise.resolve(null); // Default to new promo code being unique
            }
            return Promise.resolve(null);
        });
        // Ensure the save on the instance resolves to the (updated) instance's plain object
        mockPromotionSaveImpl.mockImplementation(function() { return Promise.resolve(this.toObject()); });
        redisClient.del.mockResolvedValue(1);
    });

    it('should update an existing promotion successfully and invalidate cache', async () => {
      const result = await promotionService.updatePromotion(mockPromoId, updatePayload);
      expect(Promotion.findOne).toHaveBeenCalledWith({ id: mockPromoId });
      expect(mockPromotionSaveImpl).toHaveBeenCalled(); // Called on existingPromoMock
      // Verify that properties on existingPromoMock were updated BEFORE save
      // This depends on how the mock instance is structured; our current one updates a copy.
      // Better to check the result:
      expect(result.title).toBe(updatePayload.title);
      expect(result.value).toBe(updatePayload.value);
      expect(redisClient.del).toHaveBeenCalledWith(promotionService.ACTIVE_PROMOTIONS_CACHE_KEY);
    });

    it('should throw 404 if promotion to update not found', async () => {
      mockPromotionFindOneImpl.mockResolvedValue(null); // Simulate not found
      await expect(promotionService.updatePromotion('non-existent-id', updatePayload))
        .rejects.toThrow(new HttpError(404, 'Promotion not found for update.'));
    });

    it('should throw 409 if updated promoCode conflicts with another promotion', async () => {
        const conflictingUpdate = { promoCode: 'EXISTINGCODE' };
        // First findOne (for the promo to update)
        mockPromotionFindOneImpl.mockResolvedValueOnce(existingPromoMock);
        // Second findOne (for the conflict check)
        mockPromotionFindOneImpl.mockResolvedValueOnce(createMockPromotionInstance({ id: 'other-promo', promoCode: 'EXISTINGCODE' }));
        
        await expect(promotionService.updatePromotion(mockPromoId, conflictingUpdate))
            .rejects.toThrow(new HttpError(409, `Promo code '${conflictingUpdate.promoCode}' is already in use.`));
    });

    it('should throw 400 if validUntil is before validFrom after update', async () => {
        const invalidDateUpdate = { validFrom: new Date('2025-09-01T00:00:00.000Z'), validUntil: new Date('2025-08-01T00:00:00.000Z') };
        // existingPromoMock's save will be called, and the validation within the service should catch this.
        // The service directly checks the dates on the `promotion` object before saving.
        await expect(promotionService.updatePromotion(mockPromoId, invalidDateUpdate))
            .rejects.toThrow(new HttpError(400, '"validUntil" date must be after "validFrom" date.'));
    });
  });
});