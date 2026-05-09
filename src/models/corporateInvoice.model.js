// File: src/models/corporateInvoice.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const invoiceLineSchema = new mongoose.Schema(
  {
    description: { type: String, trim: true },
    quantity: { type: Number, default: 0, min: 0 },
    unitPrice: { type: Number, default: 0, min: 0 },
    amount: { type: Number, default: 0, min: 0 },
    metadata: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false }
);

const paymentLineSchema = new mongoose.Schema(
  {
    id: { type: String, default: () => uuidv4() },
    amount: { type: Number, required: true, min: 0 },
    method: { type: String, trim: true },
    gateway: { type: String, trim: true },
    reference: { type: String, trim: true },
    recordedAt: { type: Date, default: Date.now },
    recordedBy: { type: String, trim: true },
    note: { type: String, trim: true },
  },
  { _id: false }
);

const invoiceEventSchema = new mongoose.Schema(
  {
    status: { type: String, trim: true },
    note: { type: String, trim: true },
    timestamp: { type: Date, default: Date.now },
    updatedBy: { type: String, trim: true },
    updatedByName: { type: String, trim: true },
  },
  { _id: false }
);

const corporateInvoiceSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4(), index: true },
    invoiceNumber: { type: String, trim: true, uppercase: true, unique: true, sparse: true, index: true },
    clientId: { type: String, required: true, index: true },
    clientName: { type: String, trim: true, index: true },
    requestId: { type: String, trim: true, index: true, sparse: true },
    fulfilmentId: { type: String, required: true, trim: true, index: true, unique: true, sparse: true },
    fulfilmentCode: { type: String, trim: true },
    linkedOrderId: { type: String, trim: true, index: true, sparse: true },
    linkedRunId: { type: String, trim: true, index: true, sparse: true },
    branchId: { type: String, trim: true, index: true },
    branchName: { type: String, trim: true },
    siteName: { type: String, trim: true },
    invoiceDate: { type: Date, default: Date.now, index: true },
    dueDate: { type: Date, index: true },
    currency: { type: String, default: 'NGN' },
    status: {
      type: String,
      enum: ['DRAFT', 'ISSUED', 'PART_PAID', 'PAID', 'OVERDUE', 'DISPUTED', 'VOID'],
      default: 'ISSUED',
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: ['UNPAID', 'PART_PAID', 'PAID', 'PROCESSING', 'WAIVED'],
      default: 'UNPAID',
      index: true,
    },
    lineItems: { type: [invoiceLineSchema], default: [] },
    subtotal: { type: Number, default: 0, min: 0 },
    discountAmount: { type: Number, default: 0, min: 0 },
    deliveryFee: { type: Number, default: 0, min: 0 },
    vatAmount: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, default: 0, min: 0 },
    amountPaid: { type: Number, default: 0, min: 0 },
    outstandingAmount: { type: Number, default: 0, min: 0 },
    lastPaymentAt: { type: Date },
    paymentHistory: { type: [paymentLineSchema], default: [] },
    events: { type: [invoiceEventSchema], default: [] },
    immutableSnapshot: { type: mongoose.Schema.Types.Mixed },
    disputeReason: { type: String, trim: true },
    createdBy: { type: String, trim: true },
    updatedBy: { type: String, trim: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

corporateInvoiceSchema.index({ clientId: 1, invoiceDate: -1 });
corporateInvoiceSchema.index({ clientId: 1, paymentStatus: 1, dueDate: 1 });
corporateInvoiceSchema.index({ branchId: 1, paymentStatus: 1 });

corporateInvoiceSchema.pre('save', function (next) {
  if (!this.invoiceNumber) {
    const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    this.invoiceNumber = `B2B-INV-${stamp}-${String(this.id || uuidv4()).slice(0, 6).toUpperCase()}`;
  }
  const lineSubtotal = (Array.isArray(this.lineItems) ? this.lineItems : []).reduce((sum, line) => {
    const amount = Number(line.amount || 0) || (Number(line.quantity || 0) * Number(line.unitPrice || 0));
    line.amount = Math.max(0, amount);
    return sum + line.amount;
  }, 0);
  this.subtotal = Math.max(0, Number(this.subtotal || lineSubtotal || 0));
  this.totalAmount = Math.max(0, this.subtotal - Number(this.discountAmount || 0) + Number(this.deliveryFee || 0) + Number(this.vatAmount || 0));
  this.outstandingAmount = Math.max(0, this.totalAmount - Number(this.amountPaid || 0));

  if (this.paymentStatus !== 'WAIVED' && this.paymentStatus !== 'PROCESSING') {
    if (this.outstandingAmount <= 0 && this.totalAmount > 0) this.paymentStatus = 'PAID';
    else if (Number(this.amountPaid || 0) > 0) this.paymentStatus = 'PART_PAID';
    else this.paymentStatus = 'UNPAID';
  }

  if (this.status !== 'VOID' && this.status !== 'DISPUTED') {
    if (this.paymentStatus === 'PAID') this.status = 'PAID';
    else if (this.paymentStatus === 'PART_PAID') this.status = 'PART_PAID';
    else if (this.dueDate && new Date(this.dueDate) < new Date()) this.status = 'OVERDUE';
    else if (!this.status || this.status === 'DRAFT') this.status = 'ISSUED';
  }
  next();
});

module.exports = mongoose.models.CorporateInvoice || mongoose.model('CorporateInvoice', corporateInvoiceSchema);
