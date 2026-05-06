// src/api/firestoreService.js
import { onAuthStateChanged, signInWithEmailAndPassword } from 'firebase/auth';
import {
    collection, query, where, doc, addDoc, updateDoc, serverTimestamp, setDoc, getDoc, orderBy, getDocs, writeBatch, Timestamp, deleteDoc, runTransaction, limit, startAfter
} from 'firebase/firestore';
import { auth, db, appId } from './firebase';

// --- Authentication & User Profile Functions ---

export const signInUser = async (email, password) => {
    if (!email || !password) {
        throw new Error("Email and password are required.");
    }
    return await signInWithEmailAndPassword(auth, email, password);
};

export const onAuthStateChangedListener = (callback) => {
    return onAuthStateChanged(auth, async (user) => {
        if (user && !user.isAnonymous) {
            const userProfile = await getUserProfile(user.uid);
            if (userProfile) {
                callback({ ...user, ...userProfile });
            } else {
                const newUserProfile = await createUserProfile(user.uid, user.email);
                callback({ ...user, ...newUserProfile });
            }
        } else {
            callback(null);
        }
    });
};

export const getUserProfile = async (uid) => {
    const userDocRef = doc(db, `artifacts/${appId}/users`, uid);
    const userDocSnap = await getDoc(userDocRef);
    return userDocSnap.exists() ? userDocSnap.data() : null;
};

export const createUserProfile = async (uid, email) => {
    const userDocRef = doc(db, `artifacts/${appId}/users`, uid);
    const newUserProfile = {
        email,
        role: 'Cashier',
        status: 'active',
        createdAt: serverTimestamp(),
    };
    await setDoc(userDocRef, newUserProfile);
    return newUserProfile;
};

export const addUserInvitation = (email, role) => {
    const usersColRef = collection(db, `artifacts/${appId}/users`);
    return addDoc(usersColRef, { email: email.toLowerCase(), role, status: 'invited', createdAt: serverTimestamp() });
};

export const updateUserRole = (uid, role) => {
    const userDocRef = doc(db, `artifacts/${appId}/users`, uid);
    return updateDoc(userDocRef, { role });
};

/**
 * Creates or updates an in-progress daily summary document.
 * @param {object} summaryData - The data from the MeterReadingsForm.
 * @param {object} user - The user submitting the form.
 * @param {string|null} summaryId - The ID of the existing document, if any.
 * @returns {Promise}
 */
export const saveDailyReadings = async (summaryData, user, summaryId = null) => {
    const dailySummaryRef = summaryId ? doc(db, `artifacts/${appId}/daily_summaries`, summaryId) : doc(collection(db, `artifacts/${appId}/daily_summaries`));

    const completeRecord = {
        date: new Date(summaryData.date),
        branchId: summaryData.branchId,
        cashierName: summaryData.cashierName,
        meters: {
            openingMeterA: parseFloat(summaryData.openingMeterA) || 0,
            closingMeterA: parseFloat(summaryData.closingMeterA) || 0,
            openingMeterB: parseFloat(summaryData.openingMeterB) || 0,
            closingMeterB: parseFloat(summaryData.closingMeterB) || 0,
            pricePerKg: parseFloat(summaryData.pricePerKg) || 0,
        },
        status: 'in_progress',
        submittedBy: { uid: user.uid, email: user.email },
        createdAt: serverTimestamp(),
    };

    await setDoc(dailySummaryRef, completeRecord, { merge: true });
    return dailySummaryRef.id;
};

/**
 * Submits a completed daily summary to the approval queue.
 * @param {string} summaryId - The ID of the daily summary to finalize.
 * @param {object} user - The user finalizing the report.
 * @returns {Promise}
 */
export const finalizeDailySummary = async (summaryId, user) => {
    const summaryRef = doc(db, `artifacts/${appId}/daily_summaries`, summaryId);
    return updateDoc(summaryRef, {
        status: 'pending',
        submittedAt: serverTimestamp(),
    });
};

/**
 * Gets the single in-progress daily summary for a given user.
 * @param {string} uid - The user's UID.
 * @returns {Query}
 */
export const getDailySummaryQuery = (uid) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return query(
        collection(db, `artifacts/${appId}/daily_summaries`),
        where('submittedBy.uid', '==', uid),
        where('status', '==', 'in_progress'),
        where('createdAt', '>=', today),
        limit(1)
    );
};

// --- Live Data Entry Functions ---

export const addDataEntry = async (logData, user, type) => {
    const { dailySummaryId, ...dataWithoutSummaryId } = logData;
    if (!dailySummaryId) throw new Error("A daily summary ID is required to log transactions.");
    
    // The rest of the function remains the same, but the Firestore document
    // will now include the dailySummaryId field.
    if (type === 'expense') {
        const dataEntryRef = collection(db, `artifacts/${appId}/data_entries`);
        const expenseData = {
            type: 'expense',
            ...dataWithoutSummaryId,
            dailySummaryId, // Link the entry to the summary
            date: new Date(dataWithoutSummaryId.date),
            status: 'pending',
            submittedBy: { uid: user.uid, email: user.email },
            submittedAt: serverTimestamp(),
            amount: parseFloat(dataWithoutSummaryId.amount)
        };
        return addDoc(dataEntryRef, expenseData);
    }
    if (type === 'sale') {
        // Use a Firestore Transaction to ensure atomic read/write
        return await runTransaction(db, async (transaction) => {
            // 1. Find the oldest stock batch with remaining inventory
            const stockQuery = query(
                collection(db, `artifacts/${appId}/stock_ins`),
                where("remainingKg", ">", 0),
                orderBy("createdAt", "asc"),
                limit(1)
            );
            
            const stockDocs = await getDocs(stockQuery);
            if (stockDocs.empty) {
                throw new Error("No stock available to sell from. Please log a new stock-in.");
            }
            
            const stockBatch = stockDocs.docs[0];
            const stockBatchRef = stockBatch.ref;
            const stockBatchData = stockBatch.data();

            const kgSold = parseFloat(logData.kgSold) || 0;
            if (kgSold > stockBatchData.remainingKg) {
                throw new Error(`Sale quantity (${kgSold} kg) exceeds available stock in current batch (${stockBatchData.remainingKg} kg).`);
            }
            
            // 2. Create the new sale document and link it to the batch
            const dataEntryRef = doc(collection(db, `artifacts/${appId}/data_entries`));
            const saleData = {
                type: 'sale',
                ...logData,
                date: new Date(logData.date),
                status: 'pending',
                submittedBy: { uid: user.uid, email: user.email },
                submittedAt: serverTimestamp(),
                revenue: parseFloat(logData.revenue),
                kgSold: kgSold,
                batchId: stockBatch.id // Link the sale to the batch
            };
            transaction.set(dataEntryRef, saleData);

            // 3. Atomically update the remaining quantity on the stock batch
            const newRemainingKg = stockBatchData.remainingKg - kgSold;
            transaction.update(stockBatchRef, { remainingKg: newRemainingKg });

            return dataEntryRef.id;
        });
    }
}

export const updateLogStatus = (logId, newStatus, user) => {
    const logDocRef = doc(db, `artifacts/${appId}/data_entries`, logId);
    return updateDoc(logDocRef, { status: newStatus, reviewedBy: { uid: user.uid, email: user.email }, reviewedAt: serverTimestamp() });
};

// --- Daily Summary Functions (NEW) ---

/**
 * Adds a complete end-of-day summary record to the database.
 * This is used for both live end-of-day submissions (pending approval)
 * and historical data migration (pre-approved).
 * @param {object} summaryData - The complete data from the end-of-day form.
 * @param {object} user - The user submitting the form.
 * @returns {Promise}
 */
export const addDailySummary = (summaryData, user) => {
    const summaryRef = collection(db, `artifacts/${appId}/daily_summaries`);
    
    // Convert string inputs to numbers
    const posAmount = parseFloat(summaryData.posAmount) || 0;
    const cashAmount = parseFloat(summaryData.cashAmount) || 0;

    const salesData = {
        posAmount: posAmount,
        cashAmount: cashAmount,
        totalRevenue: posAmount + cashAmount,
    };

    const meterData = {
        openingMeterA: parseFloat(summaryData.openingMeterA) || 0,
        closingMeterA: parseFloat(summaryData.closingMeterA) || 0,
        openingMeterB: parseFloat(summaryData.openingMeterB) || 0,
        closingMeterB: parseFloat(summaryData.closingMeterB) || 0,
        pricePerKg: parseFloat(summaryData.pricePerKg) || 0,
    };

    const expensesData = summaryData.expenses.map(exp => ({
        description: exp.description,
        category: exp.category,
        amount: parseFloat(exp.amount) || 0,
        date: new Date(exp.date),
    })).filter(exp => exp.description && exp.amount > 0);

    const completeRecord = {
        date: new Date(summaryData.date),
        branchId: summaryData.branchId,
        cashierName: summaryData.cashierName,
        sales: salesData,
        meters: meterData,
        expenses: expensesData,
        submittedBy: { uid: user.uid, email: user.email },
        createdAt: serverTimestamp(),
        // FIX: Add a default 'approved' status for historical data
        status: 'approved',
    };

    return addDoc(summaryRef, completeRecord);
};



export const approveDailySummary = async (summaryId, entryIds, status, user) => {
    const batch = writeBatch(db);
    
    // 1. Update the daily summary document
    const summaryRef = doc(db, `artifacts/${appId}/daily_summaries`, summaryId);
    batch.update(summaryRef, {
        status: status,
        reviewedBy: { uid: user.uid, email: user.email },
        reviewedAt: serverTimestamp()
    });

    // 2. Update all associated individual data entries in a batch
    const dataEntryCollection = collection(db, `artifacts/${appId}/data_entries`);
    for (const entryId of entryIds) {
        const entryRef = doc(dataEntryCollection, entryId);
        batch.update(entryRef, {
            status: status,
            reviewedBy: { uid: user.uid, email: user.email },
            reviewedAt: serverTimestamp()
        });
    }

    return await batch.commit();
};

export const getEntriesForDate = async (dateString) => {
    const startOfDay = new Date(dateString);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(dateString);
    endOfDay.setHours(23, 59, 59, 999);

    const q = query(
        collection(db, `artifacts/${appId}/data_entries`),
        where("submittedAt", ">=", startOfDay),
        where("submittedAt", "<=", endOfDay),
        where("status", "==", "pending")
    );
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

// --- Historical & Unified Data Functions ---

export const getUnifiedFinancialData = async () => {
    const entriesQuery = query(collection(db, `artifacts/${appId}/data_entries`), where("status", "==", "approved"));
    const entriesSnapshot = await getDocs(entriesQuery);
    const liveEntries = entriesSnapshot.docs.map(doc => doc.data());

    const summariesQuery = query(collection(db, `artifacts/${appId}/daily_summaries`), where("status", "==", "approved"));
    const summariesSnapshot = await getDocs(summariesQuery);
    const historicalSummaries = summariesSnapshot.docs.map(doc => doc.data());

    const unifiedData = [];
    liveEntries.forEach(entry => {
        if (entry.type === 'sale') unifiedData.push({ type: 'sale', date: entry.date, revenue: entry.revenue, kgSold: entry.kgSold, branchId: entry.branchId, source: 'live' });
        else if (entry.type === 'expense') unifiedData.push({ type: 'expense', date: entry.date, amount: entry.amount, branchId: entry.branchId, source: 'live' });
    });

    historicalSummaries.forEach(summary => {
        if (summary.sales && summary.sales.totalRevenue > 0) {
            const kgA = (summary.meters.closingMeterA || 0) - (summary.meters.openingMeterA || 0);
            const kgB = (summary.meters.closingMeterB || 0) - (summary.meters.openingMeterB || 0);
            unifiedData.push({ type: 'sale', date: summary.date, revenue: summary.sales.totalRevenue, kgSold: kgA + kgB, branchId: summary.branchId, source: 'historical' });
        }
        if (summary.expenses && summary.expenses.length > 0) {
            summary.expenses.forEach(expense => unifiedData.push({ type: 'expense', date: summary.date, amount: expense.amount, branchId: summary.branchId, source: 'historical' }));
        }
    });
    return unifiedData;
};

export const addHistoricalEntry = (logData, user) => {
    const dataEntryRef = collection(db, `artifacts/${appId}/data_entries`);
    const entry = {
        type: 'sale',
        branchId: logData.branchId,
        date: new Date(logData.date),
        kgSold: parseFloat(logData.kgSold),
        revenue: parseFloat(logData.amountPaid),
        paymentMethod: logData.paymentMethod,
        receiptNumber: logData.receiptNumber,
        transactionRef: logData.transactionRef,
        status: 'approved',
        isHistorical: true,
        submittedBy: { uid: user.uid, email: user.email },
        submittedAt: serverTimestamp(),
        reviewedBy: { uid: user.uid, email: user.email },
        reviewedAt: serverTimestamp(),
    };
    if (logData.customerId) {
        entry.customerId = logData.customerId;
    }
    return addDoc(dataEntryRef, entry);
};

// --- Asset & Inventory Management Functions ---

export const getAssetsQuery = () => query(collection(db, `artifacts/${appId}/assets`));

export const addAsset = (assetData) => {
    const assetsRef = collection(db, `artifacts/${appId}/assets`);
    return addDoc(assetsRef, { ...assetData, cost: parseFloat(assetData.cost), purchaseDate: new Date(assetData.purchaseDate), createdAt: serverTimestamp() });
};

export const getStockInsQuery = () => {
    return query(collection(db, `artifacts/${appId}/stock_ins`));
};

/**
 * Adds a new bulk LPG purchase record to the database.
 * @param {object} stockInData - Data about the stock purchase.
 * @param {object} user - The user logging the entry.
 * @returns {Promise} A promise that resolves when the record is added.
 */
export const addStockIn = (stockInData, user) => {
    const stockInsRef = collection(db, `artifacts/${appId}/stock_ins`);
    const quantity = parseFloat(stockInData.quantityKg) || 0;

    return addDoc(stockInsRef, {
        quantityKg: quantity,
        // NEW: Add cost and target sale prices
        costPerKg: parseFloat(stockInData.costPerKg) || 0,
        targetSalePricePerKg: parseFloat(stockInData.targetSalePricePerKg) || 0,
        // NEW: Track remaining quantity for this batch
        remainingKg: quantity, 
        purchaseDate: new Date(stockInData.purchaseDate),
        supplier: stockInData.supplier,
        loggedBy: { uid: user.uid, email: user.email },
        createdAt: serverTimestamp(),
    });
};

export const getPlantsQuery = () => {
    return query(collection(db, `artifacts/${appId}/plants`), orderBy('name'));
};

export const addPlant = (plantData) => {
    const plantsRef = collection(db, `artifacts/${appId}/plants`);
    return addDoc(plantsRef, {
        ...plantData,
        capacity: parseFloat(plantData.capacity) || 0,
        outputToday: 0,
        uptime: 100.0,
        createdAt: serverTimestamp(),
    });
};

export const deletePlant = (plantId) => {
    const plantRef = doc(db, `artifacts/${appId}/plants`, plantId);
    return deleteDoc(plantRef);
};

export const getLoansQuery = () => {
    return query(collection(db, `artifacts/${appId}/loans`), orderBy('name'));
};

export const addLoan = (loanData) => {
    const loansRef = collection(db, `artifacts/${appId}/loans`);
    return addDoc(loansRef, {
        ...loanData,
        principal: parseFloat(loanData.principal),
        interestRate: parseFloat(loanData.interestRate),
        term: parseInt(loanData.term, 10),
        createdAt: serverTimestamp(),
    });
};

export const deleteLoan = (loanId) => {
    const loanRef = doc(db, `artifacts/${appId}/loans`, loanId);
    return deleteDoc(loanRef);
};

export const getCylindersQuery = () => {
    return query(collection(db, `artifacts/${appId}/cylinders`), orderBy('size'));
};

export const addCylinder = (cylinderData) => {
    const cylindersRef = collection(db, `artifacts/${appId}/cylinders`);
    return addDoc(cylindersRef, {
        ...cylinderData,
        quantity: parseInt(cylinderData.quantity, 10),
        createdAt: serverTimestamp(),
    });
};

export const deleteCylinder = (cylinderId) => {
    const cylinderRef = doc(db, `artifacts/${appId}/cylinders`, cylinderId);
    return deleteDoc(cylinderRef);
};

// --- Customer & Logistics Functions ---

export const getCustomersQuery = () => {
    return query(collection(db, `artifacts/${appId}/customers`), orderBy('name'));
};

export const addCustomer = (customerData) => {
    const customersRef = collection(db, `artifacts/${appId}/customers`);
    return addDoc(customersRef, {
        ...customerData,
        createdAt: serverTimestamp(),
    });
};

export const getSalesForCustomerQuery = (customerId) => {
    return query(
        collection(db, `artifacts/${appId}/data_entries`),
        where("status", "==", "approved"),
        where("type", "==", "sale"),
        where("customerId", "==", customerId)
    );
};

// ADDED BACK: Customer Notes Functions
export const addCustomerNote = (customerId, noteText, user) => {
    const notesRef = collection(db, `artifacts/${appId}/customers/${customerId}/notes`);
    return addDoc(notesRef, {
        text: noteText,
        createdAt: serverTimestamp(),
        author: { uid: user.uid, email: user.email }
    });
};

export const getCustomerNotesQuery = (customerId) => {
    if (!customerId) return null;
    return query(collection(db, `artifacts/${appId}/customers/${customerId}/notes`), orderBy('createdAt', 'desc'));
};

export const getVansQuery = () => {
    return query(collection(db, `artifacts/${appId}/vans`), orderBy('vanNumber'));
};

export const getUnassignedOrdersQuery = () => {
    return query(
        collection(db, `artifacts/${appId}/delivery_orders`),
        where('status', '==', 'unassigned')
    );
};

export const assignOrderToVan = (vanId, orderId, orderDetails) => {
    const vanRef = doc(db, `artifacts/${appId}/vans`, vanId);
    const orderRef = doc(db, `artifacts/${appId}/delivery_orders`, orderId);
    const batch = writeBatch(db);
    batch.update(vanRef, { status: 'On Delivery', currentOrderId: orderId, destination: orderDetails.area });
    batch.update(orderRef, { status: 'assigned', vanId: vanId });
    return batch.commit();
};

// --- Configuration Functions ---

export const getConfiguration = async () => {
    const configRef = doc(db, `artifacts/${appId}/configuration`, 'main_settings');
    const docSnap = await getDoc(configRef);
    if (docSnap.exists()) {
        return docSnap.data();
    } else {
        const defaultConfig = { lowStockThreshold: 500, taxRateVAT: 7.5 };
        await setDoc(configRef, defaultConfig);
        return defaultConfig;
    }
};

export const updateConfiguration = (settingsData) => {
    const configRef = doc(db, `artifacts/${appId}/configuration`, 'main_settings');
    return updateDoc(configRef, settingsData);
};

// --- General Query Functions ---

export const getApprovedEntriesQuery = (branchId = 'all') => {
    const queryConstraints = [
        where("status", "==", "approved")
    ];
    if (branchId && branchId !== 'all') {
        queryConstraints.push(where("branchId", "==", branchId));
    }
    return query(collection(db, `artifacts/${appId}/data_entries`), ...queryConstraints);
};

export const getTransactionHistoryQuery = (filters, lastDoc = null) => {
    const { branchId, type, startDate, endDate, limitSize = 25 } = filters;
    let q = collection(db, `artifacts/${appId}/data_entries`);
    
    // Base query for all approved entries
    q = query(q, where("status", "==", "approved"));
    
    // Add dynamic filters
    if (branchId && branchId !== 'all') {
        q = query(q, where("branchId", "==", branchId));
    }
    if (type && type !== 'all') {
        q = query(q, where("type", "==", type));
    }
    if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        q = query(q, where("date", ">=", start));
    }
    if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        q = query(q, where("date", "<=", end));
    }
    
    // Always order for consistent pagination
    q = query(q, orderBy("date", "desc"));
    
    // Implement pagination
    if (lastDoc) {
        q = query(q, startAfter(lastDoc));
    }
    
    // Set a document limit for the page
    q = query(q, limit(limitSize));

    return q;
};