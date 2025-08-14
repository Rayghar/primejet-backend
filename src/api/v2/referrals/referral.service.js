// File: src/api/v1/referrals/referral.service.js
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const mongoose = require('mongoose');
const Referral = require('../../../models/referral.model');
const User = require('../../../models/user.model');
const Config = require('../../../models/config.model');
const WalletTransaction = require('../../../models/walletTransaction.model');
const HttpError = require('../../../utils/HttpError');

// Fetch default program details from Config model or use fallbacks
let DEFAULT_PROGRAM_DESCRIPTION = "Share your code with friends! They get a discount, and you get rewards.";
let DEFAULT_BENEFIT_SELF = "Get N500 wallet credit for every successful referral.";
let DEFAULT_BENEFIT_FRIEND = "Get 10% off their first order.";

// Function to load defaults from DB config
const loadReferralProgramDefaults = async () => {
  try {
    const config = await Config.findOne();
    if (config && config.referralProgram) {
      DEFAULT_PROGRAM_DESCRIPTION = config.referralProgram.programDescription || DEFAULT_PROGRAM_DESCRIPTION;
      DEFAULT_BENEFIT_SELF = config.referralProgram.benefitSelf || DEFAULT_BENEFIT_SELF;
      DEFAULT_BENEFIT_FRIEND = config.referralProgram.benefitFriend || DEFAULT_BENEFIT_FRIEND;
      console.log('[REFERRAL_SERVICE] Loaded referral program defaults from DB config.');
    }
  } catch (error) {
    console.error('[REFERRAL_SERVICE] Error loading referral program defaults from DB, using hardcoded values:', error);
  }
};

// Call once on service initialization or app startup
loadReferralProgramDefaults();

const generateUniqueReferralCode = async (length = 8) => {
  let referralCode;
  let isUnique = false;
  while (!isUnique) {
    referralCode = crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length).toUpperCase();
    const existingReferral = await Referral.findOne({ referralCode });
    if (!existingReferral) {
      isUnique = true;
    }
  }
  return referralCode;
};

const getReferralInformation = async (userId) => {
  try {
    const user = await User.findOne({ id: userId });
    if (!user) {
      throw new HttpError(404, 'User not found.');
    }

    let referralInfo = await Referral.findOne({ userId });

    if (!referralInfo) {
      console.log(`[REFERRAL_SERVICE] No referral info found for user ${userId}. Attempting to create one.`);
      const newReferralCode = await generateUniqueReferralCode();

      referralInfo = new Referral({
        id: uuidv4(),
        userId: userId,
        referralCode: newReferralCode,
        programDescription: DEFAULT_PROGRAM_DESCRIPTION,
        benefitSelf: DEFAULT_BENEFIT_SELF,
        benefitFriend: DEFAULT_BENEFIT_FRIEND,
      });
      await referralInfo.save();
      console.log(`[REFERRAL_SERVICE] Created new referral info for user ${userId} with code ${newReferralCode}.`);
    }

    return referralInfo.toObject();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error('Unexpected error in getReferralInformation:', error);
    throw new HttpError(500, 'Failed to retrieve referral information due to an unexpected error.');
  }
};

/**
 * Credits a referrer's wallet and updates their stats after a successful referral.
 * This should be called after a referee's first order payment is confirmed.
 * @param {object} order - The completed order object of the referee. Must include order.referrerId and order.id.
 * @returns {Promise<void>}
 */
const creditReferrerForSuccessfulReferral = async (order, session) => {
  const shouldCommit = !session; // Commit only if we started the transaction here
  const activeSession = session || await mongoose.startSession();
  if (!session) activeSession.startTransaction();

  try {
    if (!order.referrerId) {
      console.log(`[REFERRAL_SERVICE] Order ${order.id} has no referrer. No credit issued.`);
      if (shouldCommit) await activeSession.abortTransaction();
      return;
    }

    const [referrer, referralInfo, globalConfig] = await Promise.all([
      User.findOne({ id: order.referrerId }).session(activeSession),
      Referral.findOne({ userId: order.referrerId }).session(activeSession),
      Config.findOne().session(activeSession)
    ]);

    const referralProgramSettings = globalConfig?.referralProgram;

    if (!referrer || !referralInfo) {
      throw new Error(`Referrer or Referral info not found for user ID: ${order.referrerId}`);
    }
    if (!referralProgramSettings || !referralProgramSettings.isActive) {
        console.log(`[REFERRAL_SERVICE] Global referral program is inactive. Not crediting referrer ${referrer.id}.`);
        if (shouldCommit) await activeSession.abortTransaction();
        return;
    }

    // Check if referee's order meets minimum purchase amount
    if (order.finalAmountPaid < referralProgramSettings.minRefereePurchaseAmountKobo) {
        console.log(`[REFERRAL_SERVICE] Referee's purchase (${order.id}) of ${order.finalAmountPaid} is below minimum of ${referralProgramSettings.minRefereePurchaseAmountKobo}. No credit issued.`);
        if (shouldCommit) await activeSession.abortTransaction();
        return;
    }

    const REWARD_AMOUNT_KOBO = referralProgramSettings.rewardAmountKobo;
    const REWARD_DESCRIPTION = `Referral bonus from ${order.id.substring(0,8)}`;

    const balanceBefore = referrer.walletBalance || 0;
    const balanceAfter = balanceBefore + REWARD_AMOUNT_KOBO;

    const walletTx = new WalletTransaction({
      userId: referrer.id,
      type: 'REFERRAL_BONUS',
      amount: REWARD_AMOUNT_KOBO,
      status: 'COMPLETED',
      description: REWARD_DESCRIPTION,
      orderId: order.id,
      balanceBefore,
      balanceAfter,
    });
    await walletTx.save({ session: activeSession });

    referrer.walletBalance = balanceAfter;
    await referrer.save({ session: activeSession });

    referralInfo.successfulReferralsCount = (referralInfo.successfulReferralsCount || 0) + 1;
    await referralInfo.save({ session: activeSession });

    if (shouldCommit) await activeSession.commitTransaction();
    console.log(`[REFERRAL_SERVICE] Successfully credited wallet for referrer ${referrer.id}.`);

  } catch (error) {
    if (shouldCommit) await activeSession.abortTransaction();
    console.error(`[REFERRAL_SERVICE] Failed to credit referrer for order ${order.id}. Error: ${error.message}`);
    throw new HttpError(500, `Failed to process referral credit.`);
  } finally {
    if (shouldCommit) activeSession.endSession();
  }
};

/**
 * Admin function to get all referral records, with pagination and search.
 * @param {object} options - Pagination and search options.
 * @param {number} options.page - Current page number.
 * @param {number} options.limit - Number of records per page.
 * @param {string} options.search - Search query for referralCode or user name/email.
 * @returns {Promise<object>} - Paginated list of referral records.
 */
/**
 * Admin function to get all referral records, with pagination and search.
 * @param {object} options - Pagination and search options.
 * @returns {Promise<object>} - Paginated list of referral records.
 */
const getReferralsForAdmin = async ({ page = 1, limit = 10, search = '' }) => {
  try {
    const query = {};
    if (search) {
      const users = await User.find({
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
        ],
      }).select('id');
      const userIds = users.map(user => user.id);

      query.$or = [
        { referralCode: { $regex: search.toUpperCase(), $options: 'i' } },
        { userId: { $in: userIds } },
      ];
    }

    const totalReferrals = await Referral.countDocuments(query);
    const referrals = await Referral.find(query)
      .populate({
        path: 'userId', // The field in this schema
        model: 'User',   // The model to link to
        select: 'name email phone', // The fields to bring back
        foreignField: 'id', // The field in the User model to match with
        localField: 'userId'  // The key from this schema
      })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const formattedReferrals = referrals.map(r => ({
      id: r.id,
      userId: r.userId ? r.userId.id : 'N/A',
      userName: r.userId ? r.userId.name : '[Deleted User]',
      userEmail: r.userId ? r.userId.email : 'N/A',
      userPhone: r.userId ? r.userId.phone : 'N/A',
      referralCode: r.referralCode,
      programDescription: r.programDescription,
      benefitSelf: r.benefitSelf,
      benefitFriend: r.benefitFriend,
      isActive: r.isActive,
      totalReferredCount: r.totalReferredCount,
      successfulReferralsCount: r.successfulReferralsCount,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));

    return {
      referrals: formattedReferrals,
      currentPage: page,
      totalPages: Math.ceil(totalReferrals / limit),
      totalReferrals,
    };
  } catch (error) {
    console.error('Error in getReferralsForAdmin:', error);
    throw new HttpError(500, 'Failed to retrieve referral records for admin.');
  }
};


module.exports = {
  getReferralInformation,
  creditReferrerForSuccessfulReferral,
  getReferralsForAdmin,
  loadReferralProgramDefaults,
};