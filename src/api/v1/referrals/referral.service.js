// File: src/api/v1/referrals/referral.service.js
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const mongoose = require('mongoose');
const Referral = require('../../../models/referral.model');
const User = require('../../../models/user.model');
const Config = require('../../../models/config.model');
const WalletTransaction = require('../../../models/walletTransaction.model');
const HttpError = require('../../../utils/HttpError');
const Agent = require('../../../models/agent.model');
const agentService = require('../agents/agent.service');
const { logger } = require('../../../config/logger.config');

let DEFAULT_PROGRAM_DESCRIPTION = "Share your code with friends! They get a discount, and you get rewards.";
let DEFAULT_BENEFIT_SELF = "Get N500 wallet credit for every successful referral.";
let DEFAULT_BENEFIT_FRIEND = "Get 10% off their first order.";

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

const processCodeOnRegistration = async (newUser, code) => {
  logger.info(`[REFERRAL_SERVICE] Processing code '${code}' for new user ${newUser.id}.`);

  // Step 1: Check if the code belongs to another customer.
  const referrer = await Referral.findOne({ referralCode: code });
  if (referrer) {
    logger.info(`Code '${code}' identified as a customer referral from user ${referrer.userId}.`);
    newUser.referredByCode = code;
    newUser.referredByUserId = referrer.userId; // <-- ADD THIS LINE to save the ID
    await newUser.save();

    referrer.totalReferredCount = (referrer.totalReferredCount || 0) + 1;
    await referrer.save();
    logger.info(`Updated total referral count for referrer ${referrer.userId}.`);
    return;
  }

  // Step 2: If not a customer code, check if it belongs to an agent.
  const agent = await Agent.findOne({ agentCode: code });
  if (agent) {
    logger.info(`Code '${code}' identified as an agent referral from agent ${agent.id}.`);
    newUser.referredByAgentId = agent.id;
    await newUser.save();

    await agentService.markCustomerRegisteredByAgent(agent.agentCode, newUser.id);
    return;
  }

  logger.warn(`[REFERRAL_SERVICE] Submitted code '${code}' for user ${newUser.id} is not a valid customer or agent code.`);
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

const creditReferrerForSuccessfulReferral = async (order, session) => {
  // ============================= MODIFIED WITH DETAILED LOGGING =============================
  logger.info(`[CREDIT_REFERRER] --- Initiating referral credit check for Order ID: ${order.id} ---`);

  const shouldCommit = !session;
  const activeSession = session || await mongoose.startSession();
  if (!session) activeSession.startTransaction();

  try {
    // CONDITION 1: Check if the order has a referrerId.
    if (!order.referrerId) {
      logger.warn(`[CREDIT_REFERRER] [FAIL] Order ${order.id} has no referrerId. No credit will be issued.`);
      if (shouldCommit) await activeSession.abortTransaction();
      return;
    }
    logger.info(`[CREDIT_REFERRER] [PASS] Order has referrerId: ${order.referrerId}.`);

    // CONDITION 2: Check if the referrer's user account and referral record exist.
    const [referrer, referralInfo, globalConfig] = await Promise.all([
      User.findOne({ id: order.referrerId }).session(activeSession),
      Referral.findOne({ userId: order.referrerId }).session(activeSession),
      Config.findOne().session(activeSession)
    ]);

    if (!referrer || !referralInfo) {
      logger.error(`[CREDIT_REFERRER] [FATAL] Referrer User or Referral record not found for user ID: ${order.referrerId}. Aborting.`);
      throw new Error(`Referrer or Referral info not found for user ID: ${order.referrerId}`);
    }
    logger.info(`[CREDIT_REFERRER] [PASS] Found Referrer User (${referrer.name}) and their Referral record.`);

    const referralProgramSettings = globalConfig?.referralProgram;

    // CONDITION 3: Check if the referral program is globally active.
    if (!referralProgramSettings || !referralProgramSettings.isActive) {
        logger.warn(`[CREDIT_REFERRER] [FAIL] Global referral program is currently inactive. Not crediting referrer ${referrer.id}.`);
        if (shouldCommit) await activeSession.abortTransaction();
        return;
    }
    logger.info(`[CREDIT_REFERRER] [PASS] Global referral program is active.`);

    // CONDITION 4: Check if the order meets the minimum purchase amount.
    const minPurchaseAmount = referralProgramSettings.minRefereePurchaseAmountKobo;
    if (order.finalAmountPaid < minPurchaseAmount) {
        logger.warn(`[CREDIT_REFERRER] [FAIL] Referee's purchase amount (${order.finalAmountPaid}) is below the minimum of ${minPurchaseAmount}. No credit will be issued.`);
        if (shouldCommit) await activeSession.abortTransaction();
        return;
    }
    logger.info(`[CREDIT_REFERRER] [PASS] Purchase amount (${order.finalAmountPaid}) meets or exceeds minimum of ${minPurchaseAmount}.`);

    // CONDITION 5: Check if this is the referee's FIRST successful order. (This was already in your order.service.js, but we re-verify here for safety)
    const completedOrdersCount = await Order.countDocuments({
        customerId: order.customerId,
        paymentStatus: 'Completed',
        status: { $nin: ['Canceled', 'Canceled by Customer', 'Payment Failed'] }
    }).session(activeSession);

    if (completedOrdersCount !== 1) {
        logger.warn(`[CREDIT_REFERRER] [FAIL] This is not the referee's first completed order. Found ${completedOrdersCount} completed orders. No credit will be issued for this order.`);
        if (shouldCommit) await activeSession.abortTransaction();
        return;
    }
    logger.info(`[CREDIT_REFERRER] [PASS] This is the referee's first completed order.`);

    // All conditions met, proceed to credit the referrer.
    logger.info(`[CREDIT_REFERRER] All conditions met. Proceeding to credit wallet for referrer ${referrer.id}.`);
    
    const REWARD_AMOUNT_KOBO = referralProgramSettings.rewardAmountKobo;
    const REWARD_DESCRIPTION = `Referral bonus from order #${order.id.substring(0,8)}`;

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
    logger.info(`[CREDIT_REFERRER] [SUCCESS] Successfully credited wallet for referrer ${referrer.id}. New balance: ${balanceAfter}. Successful referrals count: ${referralInfo.successfulReferralsCount}.`);
    logger.info(`[CREDIT_REFERRER] --- Referral credit check finished for Order ID: ${order.id} ---`);

  } catch (error) {
    if (shouldCommit) await activeSession.abortTransaction();
    logger.error(`[CREDIT_REFERRER] [FATAL] An error occurred during the credit process for order ${order.id}. Transaction rolled back.`, { message: error.message, stack: error.stack });
    throw new HttpError(500, `Failed to process referral credit.`);
  } finally {
    if (shouldCommit) activeSession.endSession();
  }
};
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
        path: 'userId',
        model: 'User',
        select: 'name email phone',
        foreignField: 'id',
        localField: 'userId'
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
  processCodeOnRegistration,
};