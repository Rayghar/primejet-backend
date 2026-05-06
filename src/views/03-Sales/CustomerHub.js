// src/views/03-Sales/CustomerHub.js
import React, { useEffect, useMemo, useState } from 'react';
import {
  getCustomers,
  getCustomerOrders,
  addCustomer,
} from '../../api/customerService';

import PageTitle from '../../components/shared/PageTitle';
import Card from '../../components/shared/Card';
import Button from '../../components/shared/Button';
import Modal from '../../components/shared/Modal';
import Notification from '../../components/shared/Notification';

import {
  Search,
  PlusCircle,
  Phone,
  Mail,
  Eye,
  Clock,
  User,
  RefreshCw,
} from 'lucide-react';

const safeArr = (v) => (Array.isArray(v) ? v : []);
const safeStr = (v) => (typeof v === 'string' ? v : '');
const safeNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const normalizeCustomers = (data) => {
  // supports [] or {customers: []} or {data: []}
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    if (Array.isArray(data.customers)) return data.customers;
    if (Array.isArray(data.data)) return data.data;
  }
  return [];
};

const normalizeOrders = (data) => {
  // supports [] or {orders: []}
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && Array.isArray(data.orders)) return data.orders;
  return [];
};

// simple debounce (no extra deps)
const useDebouncedValue = (value, delay = 350) => {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
};

export default function CustomerHub() {
  const [customers, setCustomers] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearch = useDebouncedValue(searchTerm, 350);

  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerHistory, setCustomerHistory] = useState([]);

  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [notification, setNotification] = useState({
    show: false,
    message: '',
    type: 'success',
  });

  const [newCustomerForm, setNewCustomerForm] = useState({
    name: '',
    phone: '',
    email: '',
    type: 'Individual',
  });

  const canCreate = useMemo(() => {
    const nameOk = safeStr(newCustomerForm.name).trim().length >= 2;
    const phoneOk = safeStr(newCustomerForm.phone).trim().length >= 7;
    // email optional, but if present must include @
    const email = safeStr(newCustomerForm.email).trim();
    const emailOk = !email || email.includes('@');
    return nameOk && phoneOk && emailOk;
  }, [newCustomerForm]);

  const fetchCustomers = async (q) => {
    setLoadingCustomers(true);
    try {
      const data = await getCustomers(q);
      setCustomers(normalizeCustomers(data));
    } catch (e) {
      console.error('Customers Load Error', e);
      setCustomers([]);
      setNotification({
        show: true,
        message: e?.response?.data?.message || 'Failed to load customers.',
        type: 'error',
      });
    } finally {
      setLoadingCustomers(false);
    }
  };

  useEffect(() => {
    fetchCustomers(debouncedSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const handleAddCustomer = async (e) => {
    e.preventDefault();
    if (!canCreate) {
      setNotification({
        show: true,
        message: 'Please enter a valid name and phone (email optional).',
        type: 'error',
      });
      return;
    }

    try {
      await addCustomer({
        ...newCustomerForm,
        name: safeStr(newCustomerForm.name).trim(),
        phone: safeStr(newCustomerForm.phone).trim(),
        email: safeStr(newCustomerForm.email).trim(),
        type: newCustomerForm.type || 'Individual',
      });

      setNotification({
        show: true,
        message: 'Customer created successfully.',
        type: 'success',
      });

      setShowAddModal(false);
      setNewCustomerForm({ name: '', phone: '', email: '', type: 'Individual' });
      fetchCustomers(debouncedSearch);
    } catch (e) {
      console.error('Add Customer Error', e);
      setNotification({
        show: true,
        message: e?.response?.data?.message || e?.message || 'Error adding customer.',
        type: 'error',
      });
    }
  };

  const handleViewDetails = async (customer) => {
    setSelectedCustomer(customer);
    setCustomerHistory([]);
    setLoadingHistory(true);

    try {
      const data = await getCustomerOrders(customer.id);
      setCustomerHistory(normalizeOrders(data));
    } catch (e) {
      console.error('Customer Orders Error', e);
      setCustomerHistory([]);
      setNotification({
        show: true,
        message: e?.response?.data?.message || 'Failed to load customer order history.',
        type: 'error',
      });
    } finally {
      setLoadingHistory(false);
    }
  };

  return (
    <div className="space-y-6">
      <Notification notification={notification} setNotification={setNotification} />

      <div className="flex justify-between items-center">
        <PageTitle title="Customer Hub" subtitle="CRM & History" />
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            icon={RefreshCw}
            onClick={() => fetchCustomers(debouncedSearch)}
            disabled={loadingCustomers}
          >
            {loadingCustomers ? 'Refreshing...' : 'Refresh'}
          </Button>
          <Button onClick={() => setShowAddModal(true)} icon={PlusCircle}>
            Add Customer
          </Button>
        </div>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="p-4 border-b border-white/5">
          <div className="relative">
            <input
              type="text"
              placeholder="Search by name / phone / email..."
              className="glass-input w-full pl-10 py-2"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <Search className="absolute left-3 top-2.5 text-gray-500" size={18} />
          </div>
          {loadingCustomers && (
            <p className="text-xs text-blue-400 mt-2 animate-pulse">Searching customers…</p>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-400">
            <thead className="bg-white/5 text-gray-300 uppercase text-xs">
              <tr>
                <th className="p-4">Customer</th>
                <th className="p-4">Contact</th>
                <th className="p-4 text-center">Type</th>
                <th className="p-4 text-right">Action</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-white/5">
              {customers.length === 0 ? (
                <tr>
                  <td className="p-6 text-center text-gray-500" colSpan={4}>
                    No customers found.
                  </td>
                </tr>
              ) : (
                customers.map((cust) => (
                  <tr key={cust.id} className="hover:bg-white/5">
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <div className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white">
                          <User size={16} />
                        </div>
                        <div>
                          <p className="font-medium text-white leading-tight">{cust.name}</p>
                          <p className="text-[11px] text-gray-500 font-mono">
                            {cust.id ? String(cust.id).slice(0, 8) : '—'}
                          </p>
                        </div>
                      </div>
                    </td>

                    <td className="p-4 space-y-1">
                      <div className="flex items-center">
                        <Phone size={12} className="mr-1" /> {cust.phone || '—'}
                      </div>
                      <div className="flex items-center">
                        <Mail size={12} className="mr-1" /> {cust.email || '—'}
                      </div>
                    </td>

                    <td className="p-4 text-center">
                      <span className="bg-blue-500/20 text-blue-300 px-2 py-1 rounded text-xs">
                        {cust.type || 'Individual'}
                      </span>
                    </td>

                    <td className="p-4 text-right">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleViewDetails(cust)}
                        icon={Eye}
                      >
                        Details
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Add Customer Modal */}
      {showAddModal && (
        <Modal title="Add New Customer" onClose={() => setShowAddModal(false)}>
          <form onSubmit={handleAddCustomer} className="space-y-4">
            <div>
              <label className="block text-gray-400 text-xs mb-1">Name</label>
              <input
                className="glass-input w-full p-3"
                value={newCustomerForm.name}
                onChange={(e) => setNewCustomerForm({ ...newCustomerForm, name: e.target.value })}
                required
              />
            </div>

            <div>
              <label className="block text-gray-400 text-xs mb-1">Phone</label>
              <input
                className="glass-input w-full p-3"
                value={newCustomerForm.phone}
                onChange={(e) => setNewCustomerForm({ ...newCustomerForm, phone: e.target.value })}
                required
              />
            </div>

            <div>
              <label className="block text-gray-400 text-xs mb-1">Email (optional)</label>
              <input
                className="glass-input w-full p-3"
                value={newCustomerForm.email}
                onChange={(e) => setNewCustomerForm({ ...newCustomerForm, email: e.target.value })}
              />
              {!!newCustomerForm.email && !String(newCustomerForm.email).includes('@') && (
                <p className="text-xs text-red-400 mt-1">Email looks invalid.</p>
              )}
            </div>

            <div>
              <label className="block text-gray-400 text-xs mb-1">Type</label>
              <select
                className="glass-input w-full p-3 bg-slate-800"
                value={newCustomerForm.type}
                onChange={(e) => setNewCustomerForm({ ...newCustomerForm, type: e.target.value })}
              >
                <option>Individual</option>
                <option>Corporate</option>
              </select>
            </div>

            <div className="flex justify-end pt-4">
              <Button type="submit" disabled={!canCreate}>
                Create Account
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Details Modal */}
      {selectedCustomer && (
        <Modal title={selectedCustomer.name} onClose={() => setSelectedCustomer(null)}>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                <p className="text-xs text-gray-500 mb-1">Phone</p>
                <p className="text-white font-medium">{selectedCustomer.phone || '—'}</p>
              </div>
              <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                <p className="text-xs text-gray-500 mb-1">Email</p>
                <p className="text-white font-medium">{selectedCustomer.email || '—'}</p>
              </div>
            </div>

            <h4 className="font-bold text-white flex items-center border-b border-white/10 pb-2">
              <Clock size={16} className="mr-2" /> Order History
            </h4>

            <div className="max-h-72 overflow-y-auto space-y-2 pr-2">
              {loadingHistory ? (
                <p className="text-blue-400 text-sm animate-pulse">Loading orders…</p>
              ) : customerHistory.length === 0 ? (
                <p className="text-gray-500 text-sm">No orders found.</p>
              ) : (
                customerHistory.map((o) => (
                  <div
                    key={o.id}
                    className="p-3 bg-white/5 rounded-xl flex justify-between items-center text-sm border border-white/5"
                  >
                    <div>
                      <p className="text-gray-300">
                        {o.createdAt ? new Date(o.createdAt).toLocaleDateString() : '—'}
                      </p>
                      <p className="text-[11px] text-gray-500 font-mono">
                        {o.id ? String(o.id).slice(0, 8) : '—'}
                      </p>
                    </div>
                    <span className="text-white font-mono">
                      ₦{safeNum(o.grandTotal).toLocaleString()}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
