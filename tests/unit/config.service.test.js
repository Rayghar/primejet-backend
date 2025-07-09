// tests/unit/api/v1/config/config.service.test.js
// OR src/api/v1/config/config.service.test.js

const configService = require('../../src/api/v1/config/config.service'); // Adjust path
const Config = require('../../src/models/config.model'); // Adjust path
const HttpError = require('../../src/utils/HttpError'); // Adjust path

// --- Mocking Dependencies ---
jest.mock('../../src/models/config.model');

describe('Config Service', () => {
  let mockConfigData;

  beforeEach(() => {
    jest.clearAllMocks();

    mockConfigData = {
      cylinderSettings: [{ id: 'std_12kg', price: 7500 }],
      feeSettings: {
        vatPercentage: 7.5,
        serviceFeePercentage: 5,
        baseDeliveryFee: 1000,
        expressDeliverySurcharge: 500,
      },
      toObject: jest.fn().mockImplementation(function() { return { ...this, toObject: undefined, save: undefined }; }), // Simple toObject mock
      save: jest.fn().mockResolvedValue(this), // Mock save on instance for older update logic if used
    };

    // Default mock implementations
    Config.findOne.mockReset().mockResolvedValue(null);
    Config.findOneAndUpdate.mockReset().mockResolvedValue(null);
    // If the service ever uses 'new Config().save()', you might need:
    // Config.mockImplementation(() => mockConfigData); 
  });

  // --- getSystemConfig ---
  describe('getSystemConfig', () => {
    it('should return system configuration if found', async () => {
      Config.findOne.mockResolvedValue(mockConfigData);
      const result = await configService.getSystemConfig();
      expect(Config.findOne).toHaveBeenCalledWith();
      expect(result).toEqual(mockConfigData.toObject());
    });

    it('should throw HttpError 404 if configuration not found', async () => {
      Config.findOne.mockResolvedValue(null);
      await expect(configService.getSystemConfig())
        .rejects.toThrow(new HttpError(404, 'System configuration not found. Please set it up.'));
    });

    it('should throw HttpError 500 on database error during findOne', async () => {
      Config.findOne.mockRejectedValue(new Error('DB Find Error'));
      await expect(configService.getSystemConfig())
        .rejects.toThrow(new HttpError(500, 'Failed to retrieve system configuration due to an unexpected error.'));
    });
  });

  // --- updateSystemConfig ---
  describe('updateSystemConfig', () => {
    const newConfigData = {
      feeSettings: {
        vatPercentage: 8.0,
        serviceFeePercentage: 6,
        baseDeliveryFee: 1200,
        expressDeliverySurcharge: 600,
      }
    };
    const updatedConfigDocument = { ...mockConfigData, ...newConfigData, toObject: () => ({...mockConfigData, ...newConfigData})};


    it('should update existing configuration and return it', async () => {
      Config.findOneAndUpdate.mockResolvedValue(updatedConfigDocument);
      
      const result = await configService.updateSystemConfig(newConfigData);
      
      expect(Config.findOneAndUpdate).toHaveBeenCalledWith(
        {}, // Empty filter
        { $set: newConfigData },
        {
          new: true,
          upsert: true,
          runValidators: true,
          setDefaultsOnInsert: true,
        }
      );
      expect(result).toEqual(updatedConfigDocument.toObject());
    });

    it('should create new configuration if none exists (upsert) and return it', async () => {
      // findOneAndUpdate with upsert:true will create if not found
      Config.findOneAndUpdate.mockResolvedValue(updatedConfigDocument); // Simulate creation

      const result = await configService.updateSystemConfig(newConfigData);
      
      expect(Config.findOneAndUpdate).toHaveBeenCalledWith(
        {},
        { $set: newConfigData },
        expect.objectContaining({ upsert: true, new: true })
      );
      expect(result).toEqual(updatedConfigDocument.toObject());
    });
    
    it('should throw HttpError 500 if findOneAndUpdate fails to return a document (unexpected)', async () => {
        Config.findOneAndUpdate.mockResolvedValue(null); // Should not happen with upsert:true unless error
        await expect(configService.updateSystemConfig(newConfigData))
            .rejects.toThrow(new HttpError(500, 'Failed to update or create system configuration.'));
    });

    it('should throw HttpError 500 on generic database error during findOneAndUpdate', async () => {
      Config.findOneAndUpdate.mockRejectedValue(new Error('DB Update Error'));
      await expect(configService.updateSystemConfig(newConfigData))
        .rejects.toThrow(new HttpError(500, `Failed to update system configuration: DB Update Error`));
    });

    it('should throw HttpError 400 on Mongoose validation error', async () => {
      const validationError = new Error('Validation failed');
      validationError.name = 'ValidationError';
      validationError.errors = {
        feeSettings: { message: 'VAT percentage is required.' },
      };
      Config.findOneAndUpdate.mockRejectedValue(validationError);

      await expect(configService.updateSystemConfig(newConfigData))
        .rejects.toThrow(new HttpError(400, 'Configuration update failed: VAT percentage is required.'));
    });
  });
});