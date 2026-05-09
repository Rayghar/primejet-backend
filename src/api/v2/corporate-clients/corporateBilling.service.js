// File: src/api/v2/corporate-clients/corporateBilling.service.js
const CorporateInvoice = require('../../../models/corporateInvoice.model');
const CorporateFulfilment = require('../../../models/corporateFulfilment.model');

const toNum = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const round = (n, dp = 2) => Math.round(toNum(n) * 10 ** dp) / 10 ** dp;
const clean = (v) => (v === undefined || v === null ? '' : String(v).trim());

const inferDueDate = (fulfilment = {}, client = {}) => {
  if (fulfilment.paymentDueDate) return fulfilment.paymentDueDate;
  const base = fulfilment.actualDeliveredAt || fulfilment.createdAt || new Date();
  const terms = String(client.paymentTerms || fulfilment.paymentMethod || '').toUpperCase();
  let days = 0;
  if (terms.includes('7')) days = 7;
  if (terms.includes('14')) days = 14;
  if (terms.includes('30')) days = 30;
  const due = new Date(base);
  due.setDate(due.getDate() + days);
  return due;
};

const buildInvoiceSnapshot = ({ client = {}, request = {}, fulfilment = {} }) => {
  const kg = toNum(fulfilment.deliveredKg || fulfilment.requestedKg || request.requestedKg);
  const price = toNum(fulfilment.sellingPricePerKg || request.estimatedPricePerKg || client.agreedPricePerKg);
  const deliveryFee = toNum(fulfilment.deliveryCost);
  const subtotal = round(kg * price);
  const totalAmount = round(subtotal + deliveryFee);
  return {
    clientId: clean(client.id || fulfilment.clientId),
    clientName: clean(client.companyName || fulfilment.clientName),
    requestId: clean(request.id),
    fulfilmentId: clean(fulfilment.id),
    fulfilmentCode: clean(fulfilment.orderCode),
    linkedOrderId: clean(fulfilment.linkedOrderId),
    linkedRunId: clean(fulfilment.linkedRunId),
    branchId: clean(fulfilment.branchId || client.assignedBranchId),
    branchName: clean(fulfilment.branchName || client.assignedBranchName),
    siteName: clean(fulfilment.deliverySiteName || request.siteName),
    invoiceDate: fulfilment.actualDeliveredAt || fulfilment.createdAt || new Date(),
    dueDate: inferDueDate(fulfilment, client),
    lineItems: [
      {
        description: `${clean(fulfilment.deliverySiteName || request.siteName || 'Corporate LPG delivery')} • ${kg}kg`,
        quantity: kg,
        unitPrice: price,
        amount: subtotal,
        metadata: { orderType: fulfilment.orderType, requestType: request.requestType },
      },
    ],
    subtotal,
    deliveryFee,
    totalAmount,
    amountPaid: round(toNum(fulfilment.amountPaid)),
    immutableSnapshot: {
      requestedKg: toNum(fulfilment.requestedKg || request.requestedKg),
      deliveredKg: kg,
      pricePerKg: price,
      deliveryFee,
      paymentMethod: fulfilment.paymentMethod,
      paymentStatus: fulfilment.paymentStatus,
      generatedFrom: 'CORPORATE_FULFILMENT',
      generatedAt: new Date(),
    },
  };
};

const applyInvoiceValuesToFulfilment = async (fulfilment, invoice) => {
  if (!fulfilment || !invoice) return fulfilment;
  fulfilment.invoiceNumber = invoice.invoiceNumber;
  fulfilment.paymentDueDate = invoice.dueDate || fulfilment.paymentDueDate;
  fulfilment.amountPaid = round(toNum(invoice.amountPaid));
  fulfilment.outstandingAmount = round(toNum(invoice.outstandingAmount));
  if (invoice.paymentStatus === 'PAID') fulfilment.paymentStatus = 'PAID';
  else if (invoice.paymentStatus === 'PART_PAID') fulfilment.paymentStatus = 'PART_PAID';
  else if (invoice.paymentStatus === 'PROCESSING') fulfilment.paymentStatus = 'PROCESSING';
  else if (!['CREDIT', 'WAIVED'].includes(fulfilment.paymentStatus)) fulfilment.paymentStatus = 'UNPAID';
  await fulfilment.save();
  return fulfilment;
};

const ensureInvoiceForFulfilment = async ({ client = {}, request = {}, fulfilment, actor = {}, forceRefresh = false }) => {
  if (!fulfilment?.id) return null;
  let invoice = await CorporateInvoice.findOne({ fulfilmentId: fulfilment.id });
  const snapshot = buildInvoiceSnapshot({ client, request, fulfilment });
  if (!invoice) {
    invoice = new CorporateInvoice({
      ...snapshot,
      status: 'ISSUED',
      paymentStatus: fulfilment.paymentStatus === 'PROCESSING' ? 'PROCESSING' : undefined,
      createdBy: actor.id || actor.userId || actor.actorId || 'system',
      updatedBy: actor.id || actor.userId || actor.actorId || 'system',
      events: [{ status: 'ISSUED', note: `Invoice generated from fulfilment ${fulfilment.orderCode || fulfilment.id}.`, updatedBy: actor.id || actor.actorId, updatedByName: actor.name || actor.email || 'system' }],
    });
  } else if (forceRefresh && invoice.paymentStatus !== 'PAID') {
    Object.assign(invoice, {
      linkedOrderId: snapshot.linkedOrderId || invoice.linkedOrderId,
      linkedRunId: snapshot.linkedRunId || invoice.linkedRunId,
      branchId: snapshot.branchId || invoice.branchId,
      branchName: snapshot.branchName || invoice.branchName,
      siteName: snapshot.siteName || invoice.siteName,
      lineItems: snapshot.lineItems,
      subtotal: snapshot.subtotal,
      deliveryFee: snapshot.deliveryFee,
      totalAmount: snapshot.totalAmount,
      dueDate: snapshot.dueDate || invoice.dueDate,
      updatedBy: actor.id || actor.actorId || 'system',
      immutableSnapshot: invoice.immutableSnapshot || snapshot.immutableSnapshot,
    });
  }
  await invoice.save();
  await applyInvoiceValuesToFulfilment(fulfilment, invoice);
  return invoice;
};

const recordInvoicePayment = async ({ fulfilment, invoice, amount, paymentMethod, paymentGateway, paymentReference, actor = {}, note }) => {
  if (!invoice && fulfilment?.id) invoice = await CorporateInvoice.findOne({ fulfilmentId: fulfilment.id });
  if (!invoice) throw new Error('Corporate invoice not found.');
  const paid = round(toNum(amount));
  if (paid <= 0) throw new Error('Payment amount must be greater than zero.');
  invoice.amountPaid = round(toNum(invoice.amountPaid) + paid);
  invoice.lastPaymentAt = new Date();
  invoice.paymentHistory = Array.isArray(invoice.paymentHistory) ? invoice.paymentHistory : [];
  invoice.paymentHistory.unshift({
    amount: paid,
    method: paymentMethod || 'MANUAL',
    gateway: paymentGateway || 'MANUAL',
    reference: paymentReference,
    recordedBy: actor.id || actor.actorId || 'system',
    note,
  });
  invoice.events = Array.isArray(invoice.events) ? invoice.events : [];
  invoice.events.unshift({ status: 'PAYMENT_RECORDED', note: note || `Payment recorded: ₦${paid.toLocaleString()}`, updatedBy: actor.id || actor.actorId, updatedByName: actor.name || actor.email || 'system' });
  await invoice.save();
  if (fulfilment) await applyInvoiceValuesToFulfilment(fulfilment, invoice);
  return invoice;
};

const invoiceToStatementRows = (invoices = []) => {
  let balance = 0;
  const lines = [];
  invoices
    .slice()
    .sort((a, b) => new Date(a.invoiceDate || a.createdAt || 0) - new Date(b.invoiceDate || b.createdAt || 0))
    .forEach((inv) => {
      const invoiceValue = toNum(inv.totalAmount);
      if (invoiceValue > 0) {
        balance = round(balance + invoiceValue);
        lines.push({ id: `${inv.id}-invoice`, type: 'INVOICE', date: inv.invoiceDate || inv.createdAt, reference: inv.invoiceNumber, description: inv.siteName || 'Corporate LPG invoice', debit: invoiceValue, credit: 0, balance, fulfilmentId: inv.fulfilmentId, invoiceId: inv.id });
      }
      (Array.isArray(inv.paymentHistory) ? inv.paymentHistory.slice().reverse() : []).forEach((p) => {
        balance = round(balance - toNum(p.amount));
        lines.push({ id: p.id || `${inv.id}-payment-${p.recordedAt}`, type: 'PAYMENT', date: p.recordedAt || inv.lastPaymentAt, reference: p.reference || inv.invoiceNumber, description: `Payment received for ${inv.invoiceNumber}`, debit: 0, credit: toNum(p.amount), balance, fulfilmentId: inv.fulfilmentId, invoiceId: inv.id });
      });
    });
  return lines.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
};

const buildBillingSummaryFromInvoices = (invoices = [], client = {}) => {
  const now = new Date();
  const totalInvoiceValue = round(invoices.reduce((sum, r) => sum + toNum(r.totalAmount), 0));
  const totalPaid = round(invoices.reduce((sum, r) => sum + toNum(r.amountPaid), 0));
  const outstanding = round(invoices.reduce((sum, r) => sum + toNum(r.outstandingAmount), 0));
  const openInvoices = invoices.filter((r) => toNum(r.outstandingAmount) > 0 && r.paymentStatus !== 'PAID');
  const overdueInvoices = openInvoices.filter((r) => r.dueDate && new Date(r.dueDate) < now);
  const creditLimit = toNum(client.creditLimit);
  return {
    totalInvoiceValue,
    totalPaid,
    outstanding,
    openInvoiceCount: openInvoices.length,
    overdueInvoiceCount: overdueInvoices.length,
    creditLimit,
    availableCredit: Math.max(0, round(creditLimit - outstanding)),
    creditUtilizationPct: creditLimit > 0 ? round((outstanding / creditLimit) * 100) : 0,
    hasCreditRisk: creditLimit > 0 && outstanding > creditLimit,
    hasOverdue: overdueInvoices.length > 0,
  };
};

module.exports = {
  ensureInvoiceForFulfilment,
  recordInvoicePayment,
  buildInvoiceSnapshot,
  invoiceToStatementRows,
  buildBillingSummaryFromInvoices,
};
