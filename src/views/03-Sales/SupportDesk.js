// src/views/03-Sales/SupportDesk.js
import React, { useEffect, useContext, useMemo, useRef, useState, useCallback } from 'react';
import { SocketContext } from '../../contexts/SocketContext';

// ✅ IMPORTANT: wire to supportService.js (not customerService.js)
import {
  getActiveChatThreads,
  getChatHistory,
  sendMessage,
  getCustomers,
  getCustomerOrders,
} from '../../api/supportService';

import { getUnassignedOrders, getActiveRuns } from '../../api/operationsService';
import PageTitle from '../../components/shared/PageTitle';
import {
  Send,
  MessageSquare,
  Search,
  Paperclip,
  Check,
  CheckCheck,
  RefreshCw,
  AlertTriangle,
  Truck,
  Clock,
  Package,
  Activity,
  ExternalLink,
  User,
  ChevronRight,
} from 'lucide-react';

const safeArr = (v) => (Array.isArray(v) ? v : []);
const safeStr = (v) => (typeof v === 'string' ? v : '');
const safeNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const normalizeThreads = (data) => {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && Array.isArray(data.threads)) return data.threads;
  return [];
};

const normalizeMessages = (data) => {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && Array.isArray(data.messages)) return data.messages;
  return [];
};

const normalizeOrders = (data) => {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    if (Array.isArray(data.orders)) return data.orders;
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data.results)) return data.results;
  }
  return [];
};

const isPendingOrderStatus = (status = '') => {
  const s = String(status).toLowerCase();
  return s.includes('pending') || s.includes('placed') || s.includes('processing') || s.includes('ready');
};

const isActiveOrderStatus = (status = '') => {
  const s = String(status).toLowerCase();
  return (
    s.includes('driver assigned') ||
    s.includes('awaiting driver') ||
    s.includes('pickup') ||
    s.includes('delivery') ||
    s.includes('in progress') ||
    s.includes('on delivery') ||
    s.includes('active')
  );
};

const formatTime = (value) => {
  if (!value) return '--:--';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const formatDateTime = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const getOrderTimestamp = (order) =>
  order?.orderDate || order?.placedAt || order?.createdAt || order?.updatedAt || null;

const getWaitingMs = (order) => {
  const ts = getOrderTimestamp(order);
  if (!ts) return null;
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Date.now() - t);
};

const formatDurationShort = (ms) => {
  if (ms == null) return '—';
  const mins = Math.floor(ms / 60000);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (days > 0) return `${days}d ${hrs % 24}h`;
  if (hrs > 0) return `${hrs}h ${mins % 60}m`;
  return `${mins}m`;
};

const getStatusPillClass = (status = '') => {
  const s = String(status).toLowerCase();
  if (s.includes('delivered')) return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20';
  if (s.includes('cancel')) return 'bg-red-500/10 text-red-300 border-red-500/20';
  if (isActiveOrderStatus(s)) return 'bg-blue-500/10 text-blue-300 border-blue-500/20';
  if (isPendingOrderStatus(s)) return 'bg-amber-500/10 text-amber-300 border-amber-500/20';
  return 'bg-white/5 text-gray-300 border-white/10';
};

const getPaymentPillClass = (paymentStatus = '') => {
  const s = String(paymentStatus).toLowerCase();
  if (s.includes('paid') || s.includes('success')) return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20';
  if (s.includes('pending') || s.includes('processing')) return 'bg-amber-500/10 text-amber-300 border-amber-500/20';
  if (s.includes('failed') || s.includes('rejected')) return 'bg-red-500/10 text-red-300 border-red-500/20';
  return 'bg-white/5 text-gray-300 border-white/10';
};

const getWaitingPillClass = (ms) => {
  if (ms == null) return 'bg-white/5 text-gray-300 border-white/10';
  const mins = Math.floor(ms / 60000);
  if (mins >= 120) return 'bg-red-500/10 text-red-300 border-red-500/20'; // 2h+
  if (mins >= 60) return 'bg-amber-500/10 text-amber-300 border-amber-500/20'; // 1h+
  return 'bg-blue-500/10 text-blue-300 border-blue-500/20';
};

const StatCard = ({ icon: Icon, title, value, sub, tone = 'blue' }) => {
  const toneMap = {
    blue: 'from-blue-500/20 to-cyan-500/10 text-blue-300',
    amber: 'from-amber-500/20 to-yellow-500/10 text-amber-300',
    emerald: 'from-emerald-500/20 to-green-500/10 text-emerald-300',
    violet: 'from-violet-500/20 to-fuchsia-500/10 text-violet-300',
  };

  return (
    <div className="glass-card p-3 border border-white/5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] text-gray-400">{title}</p>
          <p className="text-xl font-semibold text-white mt-1">{value}</p>
          <p className="text-[11px] text-gray-500 mt-1">{sub}</p>
        </div>
        <div
          className={`w-9 h-9 rounded-xl bg-gradient-to-br ${toneMap[tone]} flex items-center justify-center border border-white/10`}
        >
          <Icon size={16} />
        </div>
      </div>
    </div>
  );
};

// priority scoring for attention list
const attentionScore = (profile) => safeNum(profile?.pendingCount) * 2 + safeNum(profile?.activeCount);

export default function SupportDesk() {
  const { socket } = useContext(SocketContext);

  const [threads, setThreads] = useState([]);
  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState([]);

  const [input, setInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const [loadingThreads, setLoadingThreads] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  // Support hub state
  const [hubLoading, setHubLoading] = useState(false);
  const [hubError, setHubError] = useState('');
  const [queueSnapshot, setQueueSnapshot] = useState({
    newCustomerOrders: 0,
    ordersAssigned: 0,
    activeDeliveries: 0,
    totalRuns: 0,
  });
  const [recentCustomerOrders, setRecentCustomerOrders] = useState([]);
  const [customersAttentionList, setCustomersAttentionList] = useState([]);

  // ✅ Active customer context (replaces “Online/Support Session” with service-quality details)
  const [activeCustomerContext, setActiveCustomerContext] = useState({
    loading: false,
    error: '',
    latestOrder: null,
    pendingCount: 0,
    activeCount: 0,
    totalOrders: 0,
  });

  const scrollRef = useRef(null);
  const hubReqRef = useRef(0);
  const activeContextReqRef = useRef(0);

  const scrollToBottom = (smooth = true) => {
    setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' }), 60);
  };

  const loadThreads = useCallback(async () => {
    setLoadingThreads(true);
    setError('');
    try {
      const data = await getActiveChatThreads();
      setThreads(normalizeThreads(data));
    } catch (e) {
      console.error('Chat Threads Error', e);
      setError(e?.message || e?.response?.data?.message || 'Failed to load chat threads.');
      setThreads([]);
    } finally {
      setLoadingThreads(false);
    }
  }, []);

  const loadActiveCustomerContext = useCallback(
    async (customerId) => {
      if (!customerId) {
        setActiveCustomerContext({
          loading: false,
          error: '',
          latestOrder: null,
          pendingCount: 0,
          activeCount: 0,
          totalOrders: 0,
        });
        return;
      }

      const reqId = ++activeContextReqRef.current;

      setActiveCustomerContext((p) => ({
        ...p,
        loading: true,
        error: '',
      }));

      try {
        const ordersData = await getCustomerOrders(customerId);
        if (activeContextReqRef.current !== reqId) return;

        const orders = normalizeOrders(ordersData);

        const sortedOrders = [...orders].sort((a, b) => {
          const da = new Date(getOrderTimestamp(a) || 0).getTime();
          const db = new Date(getOrderTimestamp(b) || 0).getTime();
          return db - da;
        });

        const latestOrder = sortedOrders[0] || null;
        const pendingCount = sortedOrders.filter((o) => isPendingOrderStatus(o?.status)).length;
        const activeCount = sortedOrders.filter((o) => isActiveOrderStatus(o?.status)).length;

        setActiveCustomerContext({
          loading: false,
          error: '',
          latestOrder,
          pendingCount,
          activeCount,
          totalOrders: sortedOrders.length,
        });
      } catch (e) {
        console.error('Active Customer Context Error', e);
        if (activeContextReqRef.current !== reqId) return;
        setActiveCustomerContext({
          loading: false,
          error: e?.message || e?.response?.data?.message || 'Failed to load customer context.',
          latestOrder: null,
          pendingCount: 0,
          activeCount: 0,
          totalOrders: 0,
        });
      }
    },
    [setActiveCustomerContext]
  );

  const loadSupportHub = useCallback(async () => {
    const reqId = ++hubReqRef.current;

    setHubLoading(true);
    setHubError('');

    try {
      const [unassignedRes, activeRunsRes, customersRes] = await Promise.allSettled([
        getUnassignedOrders(),
        getActiveRuns(),
        getCustomers('', 1),
      ]);

      if (hubReqRef.current !== reqId) return;

      const unassignedOrders = unassignedRes.status === 'fulfilled' ? safeArr(unassignedRes.value) : [];
      const activeRunsRaw = activeRunsRes.status === 'fulfilled' ? safeArr(activeRunsRes.value) : [];
      const customersPayload = customersRes.status === 'fulfilled' ? customersRes.value : null;

      const assignedRuns = activeRunsRaw.filter(
        (r) => String(r?.overallStatus || '').toLowerCase() === 'assigned'
      );
      const activeDeliveryRuns = activeRunsRaw.filter((r) =>
        ['in progress', 'active', 'on delivery'].includes(String(r?.overallStatus || '').toLowerCase())
      );

      setQueueSnapshot({
        newCustomerOrders: unassignedOrders.length,
        ordersAssigned: assignedRuns.length,
        activeDeliveries: activeDeliveryRuns.length,
        totalRuns: activeRunsRaw.length,
      });

      const customersList = Array.isArray(customersPayload)
        ? customersPayload
        : safeArr(customersPayload?.customers || customersPayload?.data || customersPayload?.results);

      const topCustomers = customersList.slice(0, 10);

      const orderLookups = await Promise.allSettled(
        topCustomers.map(async (c) => {
          const customerId = c?.id || c?._id;
          const customerName = c?.name || c?.fullName || c?.customerName || c?.email || 'Customer';

          if (!customerId) {
            return {
              customerId: '',
              customerName,
              customerPhone: c?.phone || c?.phoneNumber || '',
              customerEmail: c?.email || '',
              latestOrder: null,
              pendingCount: 0,
              activeCount: 0,
              totalOrders: 0,
            };
          }

          const ordersData = await getCustomerOrders(customerId);
          const orders = normalizeOrders(ordersData);

          const sortedOrders = [...orders].sort((a, b) => {
            const da = new Date(getOrderTimestamp(a) || 0).getTime();
            const db = new Date(getOrderTimestamp(b) || 0).getTime();
            return db - da;
          });

          const latestOrder = sortedOrders[0] || null;
          const pendingCount = sortedOrders.filter((o) => isPendingOrderStatus(o?.status)).length;
          const activeCount = sortedOrders.filter((o) => isActiveOrderStatus(o?.status)).length;

          return {
            customerId,
            customerName,
            customerPhone: c?.phone || c?.phoneNumber || '',
            customerEmail: c?.email || '',
            latestOrder,
            pendingCount,
            activeCount,
            totalOrders: sortedOrders.length,
          };
        })
      );

      if (hubReqRef.current !== reqId) return;

      const customerOrderProfiles = orderLookups
        .filter((r) => r.status === 'fulfilled')
        .map((r) => r.value)
        .filter((x) => x?.latestOrder);

      const recentOrders = [...customerOrderProfiles]
        .map((p) => ({
          customerId: p.customerId,
          customerName: p.customerName,
          customerPhone: p.customerPhone,
          customerEmail: p.customerEmail,
          order: p.latestOrder,
          pendingCount: p.pendingCount,
          activeCount: p.activeCount,
        }))
        .sort((a, b) => {
          const da = new Date(getOrderTimestamp(a.order) || 0).getTime();
          const db = new Date(getOrderTimestamp(b.order) || 0).getTime();
          return db - da;
        })
        .slice(0, 10);

      const attentionCustomers = [...customerOrderProfiles]
        .filter((p) => safeNum(p.pendingCount) > 0 || safeNum(p.activeCount) > 0)
        .sort((a, b) => attentionScore(b) - attentionScore(a))
        .slice(0, 10);

      setRecentCustomerOrders(recentOrders);
      setCustomersAttentionList(attentionCustomers);

      if (unassignedRes.status === 'rejected' || activeRunsRes.status === 'rejected' || customersRes.status === 'rejected') {
        setHubError('Some support hub data loaded partially. Refresh to retry failed sections.');
      }
    } catch (e) {
      console.error('Support Hub Load Error', e);
      setHubError(e?.message || 'Failed to load support hub data.');
      setQueueSnapshot({ newCustomerOrders: 0, ordersAssigned: 0, activeDeliveries: 0, totalRuns: 0 });
      setRecentCustomerOrders([]);
      setCustomersAttentionList([]);
    } finally {
      if (hubReqRef.current === reqId) setHubLoading(false);
    }
  }, []);

  useEffect(() => {
    loadThreads();
    loadSupportHub();

    const t = setInterval(() => {
      loadSupportHub();

      // keep waiting-time current for active chat header
      if (activeChat?.userId) loadActiveCustomerContext(activeChat.userId);
    }, 60000);

    return () => clearInterval(t);
  }, [loadThreads, loadSupportHub, loadActiveCustomerContext, activeChat?.userId]);

  // Real-time listener
  useEffect(() => {
    if (!socket) return;

    const onReceive = (msg) => {
      const sameChat =
        activeChat &&
        (msg.senderId === activeChat.userId ||
          msg.chatId === activeChat.chatId ||
          msg.recipientId === activeChat.userId);

      if (sameChat) {
        setMessages((prev) => [...prev, msg]);
        scrollToBottom();
      }

      loadThreads();
      loadSupportHub();

      if (activeChat?.userId) loadActiveCustomerContext(activeChat.userId);
    };

    socket.on('receive_message', onReceive);
    return () => socket.off('receive_message', onReceive);
  }, [socket, activeChat, loadThreads, loadSupportHub, loadActiveCustomerContext]);

  const handleSelectChat = async (thread) => {
    setActiveChat(thread);
    setMessages([]);
    setLoadingHistory(true);
    setError('');

    // ✅ Load support-quality context for header (waiting time + payment + latest order)
    loadActiveCustomerContext(thread?.userId);

    try {
      const data = await getChatHistory(thread.chatId);
      setMessages(normalizeMessages(data));
      scrollToBottom(false);
    } catch (e) {
      console.error('Chat History Error', e);
      setMessages([]);
      setError(e?.message || e?.response?.data?.message || 'Failed to load chat history.');
    } finally {
      setLoadingHistory(false);
    }
  };

  const tryOpenCustomerChat = async (customerId, customerName = 'Customer') => {
    if (!customerId) return;

    const thread = safeArr(threads).find((t) => t.userId === customerId);
    if (thread) {
      handleSelectChat(thread);
      return;
    }

    const pseudo = {
      userId: customerId,
      userName: customerName,
      chatId: customerId, // fallback
      lastMessage: '',
      unreadCount: 0,
      lastMessageAt: null,
    };
    setActiveChat(pseudo);
    setMessages([]);

    // ✅ still load context so header is useful even without a thread
    loadActiveCustomerContext(customerId);
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || !activeChat || sending) return;

    const text = input.trim();
    const tempId = `tmp_${Date.now()}`;

    const tempMsg = {
      id: tempId,
      text,
      senderRole: 'admin',
      createdAt: new Date().toISOString(),
      status: 'sent',
    };

    setMessages((prev) => [...prev, tempMsg]);
    setInput('');
    scrollToBottom();

    setSending(true);
    try {
      await sendMessage(activeChat.chatId, text, activeChat.userId);

      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, status: 'delivered' } : m)));

      loadThreads();
    } catch (e2) {
      console.error('Send Message Error', e2);

      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, status: 'failed' } : m)));

      setError(e2?.message || e2?.response?.data?.message || 'Message failed to send.');
    } finally {
      setSending(false);
    }
  };

  const filteredThreads = useMemo(() => {
    const q = safeStr(searchTerm).toLowerCase();
    return safeArr(threads).filter((t) => {
      const name = safeStr(t.userName).toLowerCase();
      const lastMsg = safeStr(t.lastMessage).toLowerCase();
      return name.includes(q) || lastMsg.includes(q);
    });
  }, [threads, searchTerm]);

  const totalUnread = useMemo(
    () => safeArr(threads).reduce((sum, t) => sum + safeNum(t.unreadCount), 0),
    [threads]
  );

  const refreshAll = async () => {
    await Promise.allSettled([loadThreads(), loadSupportHub()]);
    if (activeChat?.userId) await loadActiveCustomerContext(activeChat.userId);
  };

  const activeOrder = activeCustomerContext.latestOrder;
  const activeOrderId = activeOrder?.id || activeOrder?._id || '';
  const activeOrderStatus = activeOrder?.status || '';
  const activePaymentStatus = activeOrder?.paymentStatus || activeOrder?.payment?.status || '';
  const activeWaitMs = getWaitingMs(activeOrder);

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col">
      <PageTitle title="Support Desk" subtitle="Customer Support Hub, Live Chats & Delivery Visibility" />

      {/* Top KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-3">
        <StatCard
          icon={MessageSquare}
          title="Open Threads"
          value={safeArr(threads).length}
          sub={`${totalUnread} unread messages`}
          tone="violet"
        />
        <StatCard icon={Package} title="New Customer Orders" value={queueSnapshot.newCustomerOrders} sub="Awaiting batching/assignment" tone="amber" />
        <StatCard icon={Truck} title="Orders Assigned" value={queueSnapshot.ordersAssigned} sub="Assigned runs not yet started" tone="blue" />
        <StatCard icon={Activity} title="Active Deliveries" value={queueSnapshot.activeDeliveries} sub="In-progress delivery runs" tone="emerald" />

        <div className="glass-card p-3 border border-white/5 flex items-center justify-between">
          <div>
            <p className="text-[11px] text-gray-400">Support Actions</p>
            <p className="text-sm text-white mt-1">Refresh all panels</p>
            <p className="text-[11px] text-gray-500 mt-1">Chats, queues, customers</p>
          </div>
          <button
            onClick={refreshAll}
            className="glass-button px-3 py-2 text-xs flex items-center"
            disabled={loadingThreads || hubLoading || activeCustomerContext.loading}
          >
            <RefreshCw size={14} className={`mr-2 ${(loadingThreads || hubLoading || activeCustomerContext.loading) ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-1 gap-3 min-h-0">
        {/* LEFT: THREADS */}
        <div className="w-80 min-w-80 glass-card p-0 overflow-hidden border-0 flex flex-col">
          <div className="p-4 border-b border-white/5 space-y-3">
            <div className="relative">
              <input
                type="text"
                placeholder="Search conversations..."
                className="glass-input w-full py-2 pl-9 text-xs"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <Search size={14} className="absolute left-3 top-2.5 text-gray-500" />
            </div>

            <button
              onClick={loadThreads}
              className="glass-button w-full px-3 py-2 flex items-center justify-center text-xs"
              disabled={loadingThreads}
            >
              <RefreshCw size={14} className={`mr-2 ${loadingThreads ? 'animate-spin' : ''}`} />
              {loadingThreads ? 'Refreshing…' : 'Refresh Threads'}
            </button>

            {error && (
              <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-200 text-xs flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 text-red-300" />
                <span>{error}</span>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {filteredThreads.map((thread) => (
              <button
                key={thread.userId}
                onClick={() => handleSelectChat(thread)}
                className={`w-full text-left p-4 border-b border-white/5 hover:bg-white/5 transition-all ${
                  activeChat?.userId === thread.userId ? 'bg-blue-600/10 border-l-2 border-l-blue-500' : ''
                }`}
              >
                <div className="flex justify-between items-center mb-1">
                  <span className={`text-sm font-semibold ${activeChat?.userId === thread.userId ? 'text-white' : 'text-gray-300'}`}>
                    {thread.userName || 'Customer'}
                  </span>
                  <span className="text-[10px] text-gray-500">{formatTime(thread.lastMessageAt)}</span>
                </div>

                <div className="flex justify-between items-center gap-2">
                  <p className="text-xs text-gray-500 truncate flex-1">{thread.lastMessage || ''}</p>
                  {safeNum(thread.unreadCount) > 0 && (
                    <span className="bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                      {thread.unreadCount}
                    </span>
                  )}
                </div>
              </button>
            ))}

            {!loadingThreads && filteredThreads.length === 0 && (
              <div className="p-6 text-center text-gray-600 text-xs">No conversations found.</div>
            )}
          </div>
        </div>

        {/* CENTER: CHAT */}
        <div className="flex-1 min-w-0 glass-card p-0 overflow-hidden border-0 flex flex-col bg-[#0f1218]">
          {activeChat ? (
            <>
              {/* ✅ Header: replace “active chat field” with order/payment/waiting details */}
              <div className="p-4 border-b border-white/5 bg-white/5 backdrop-blur-md flex justify-between items-center gap-3">
                <div className="flex items-center min-w-0 gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold border border-white/10">
                    {safeStr(activeChat.userName)[0] || 'U'}
                  </div>

                  <div className="min-w-0">
                    <h3 className="font-bold text-white text-sm truncate">{activeChat.userName || 'Customer'}</h3>

                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      {/* Latest order identifier */}
                      <span className="text-[11px] text-gray-400">
                        Latest Order:{' '}
                        <span className="text-gray-200">{activeOrderId ? `#${String(activeOrderId).slice(0, 10)}` : '—'}</span>
                      </span>

                      {/* Order Status */}
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border ${getStatusPillClass(activeOrderStatus)}`}>
                        {activeOrderStatus || (activeCustomerContext.loading ? 'Loading…' : 'No order')}
                      </span>

                      {/* Payment Status */}
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border ${getPaymentPillClass(activePaymentStatus)}`}>
                        {activePaymentStatus || 'Payment: —'}
                      </span>

                      {/* Waiting time */}
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border ${getWaitingPillClass(activeWaitMs)}`}>
                        Wait: {formatDurationShort(activeWaitMs)}
                      </span>

                      {/* Totals quick-view */}
                      <span className="text-[11px] text-gray-500">
                        Pending {safeNum(activeCustomerContext.pendingCount)} • Active {safeNum(activeCustomerContext.activeCount)}
                      </span>

                      {activeOrder?.grandTotal != null ? (
                        <span className="text-[11px] text-gray-300">₦{safeNum(activeOrder.grandTotal).toLocaleString()}</span>
                      ) : null}

                      {activeCustomerContext.error ? (
                        <span className="text-[11px] text-red-300">{activeCustomerContext.error}</span>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="flex space-x-2 shrink-0">
                  <a
                    href={`/orders?customerId=${encodeURIComponent(activeChat.userId || '')}`}
                    className="glass-button-secondary px-3 py-1 text-xs inline-flex items-center"
                  >
                    View Orders
                  </a>
                  <a
                    href={`/customers?customerId=${encodeURIComponent(activeChat.userId || '')}`}
                    className="glass-button-secondary px-3 py-1 text-xs inline-flex items-center"
                  >
                    Manage Customer
                  </a>
                  {activeOrderId ? (
                    <a
                      href={`/orders/${encodeURIComponent(activeOrderId)}`}
                      className="glass-button-secondary px-3 py-1 text-xs inline-flex items-center"
                    >
                      Open Order
                    </a>
                  ) : null}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {loadingHistory ? (
                  <p className="text-blue-400 animate-pulse text-sm">Loading chat history…</p>
                ) : (
                  messages.map((msg, i) => {
                    const isMe = msg.senderRole === 'admin';
                    const status = msg.status || 'sent';

                    return (
                      <div key={msg.id || i} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[75%] p-3 rounded-2xl text-sm shadow-lg ${
                            isMe
                              ? status === 'failed'
                                ? 'bg-red-600 text-white rounded-tr-none'
                                : 'bg-blue-600 text-white rounded-tr-none'
                              : 'bg-[#1e293b] text-gray-200 border border-white/5 rounded-tl-none'
                          }`}
                        >
                          <p>{msg.text}</p>

                          <div className={`flex justify-end items-center mt-1 space-x-1 text-[10px] ${isMe ? 'text-blue-200' : 'text-gray-500'}`}>
                            <span>{formatTime(msg.createdAt)}</span>

                            {isMe &&
                              (status === 'read' ? (
                                <CheckCheck size={12} />
                              ) : status === 'delivered' ? (
                                <CheckCheck size={12} className="opacity-70" />
                              ) : status === 'failed' ? (
                                <span className="ml-1 text-[10px] text-red-200">Failed</span>
                              ) : (
                                <Check size={12} />
                              ))}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={scrollRef} />
              </div>

              <div className="p-4 bg-black/20 border-t border-white/5">
                <form onSubmit={handleSend} className="flex items-center gap-2">
                  <button
                    type="button"
                    className="text-gray-400 hover:text-white p-2 rounded-full hover:bg-white/5 transition-colors"
                    title="Attach (coming soon)"
                  >
                    <Paperclip size={20} />
                  </button>

                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Type your message..."
                    className="glass-input flex-1 py-3 px-4 rounded-full"
                  />

                  <button
                    type="submit"
                    disabled={!input.trim() || sending}
                    className="bg-blue-600 hover:bg-blue-500 text-white p-3 rounded-full shadow-lg shadow-blue-900/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    title={sending ? 'Sending…' : 'Send'}
                  >
                    <Send size={18} />
                  </button>
                </form>

                {sending && <p className="text-[11px] text-gray-500 mt-2">Sending message…</p>}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-600">
              <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-4">
                <MessageSquare size={32} className="opacity-50" />
              </div>
              <p className="text-sm">Select a conversation or use the customer panels to start support</p>
            </div>
          )}
        </div>

        {/* RIGHT: SUPPORT HUB PANELS */}
        <div className="w-[420px] min-w-[420px] flex flex-col gap-3 min-h-0">
          {/* Queue & dispatch snapshot */}
          <div className="glass-card p-0 overflow-hidden border-0">
            <div className="p-3 border-b border-white/5 bg-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Truck size={14} className="text-blue-300" />
                <p className="text-sm font-semibold text-white">Order & Delivery Support Queue</p>
              </div>
              <a
                href="/operations/logistics"
                className="text-[11px] text-blue-300 hover:text-blue-200 inline-flex items-center gap-1"
              >
                Manage <ExternalLink size={12} />
              </a>
            </div>

            <div className="p-3 grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-white/5 bg-black/20 p-3">
                <p className="text-[11px] text-gray-400">New Customer Orders</p>
                <p className="text-lg text-white font-semibold mt-1">{queueSnapshot.newCustomerOrders}</p>
                <p className="text-[10px] text-gray-500 mt-1">Need batching / assignment</p>
              </div>
              <div className="rounded-xl border border-white/5 bg-black/20 p-3">
                <p className="text-[11px] text-gray-400">Orders Assigned</p>
                <p className="text-lg text-white font-semibold mt-1">{queueSnapshot.ordersAssigned}</p>
                <p className="text-[10px] text-gray-500 mt-1">Runs assigned to drivers</p>
              </div>
              <div className="rounded-xl border border-white/5 bg-black/20 p-3">
                <p className="text-[11px] text-gray-400">Active Deliveries</p>
                <p className="text-lg text-white font-semibold mt-1">{queueSnapshot.activeDeliveries}</p>
                <p className="text-[10px] text-gray-500 mt-1">In progress now</p>
              </div>
              <div className="rounded-xl border border-white/5 bg-black/20 p-3">
                <p className="text-[11px] text-gray-400">Total Active Runs</p>
                <p className="text-lg text-white font-semibold mt-1">{queueSnapshot.totalRuns}</p>
                <p className="text-[10px] text-gray-500 mt-1">Assigned + In progress</p>
              </div>
            </div>
          </div>

          {/* Recent customer orders */}
          <div className="glass-card p-0 overflow-hidden border-0 flex-1 min-h-0">
            <div className="p-3 border-b border-white/5 bg-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock size={14} className="text-amber-300" />
                <p className="text-sm font-semibold text-white">Recent Customer Orders</p>
              </div>
              <a href="/orders" className="text-[11px] text-blue-300 hover:text-blue-200 inline-flex items-center gap-1">
                View all <ExternalLink size={12} />
              </a>
            </div>

            {hubError && (
              <div className="mx-3 mt-3 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-200 text-xs flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 text-red-300" />
                <span>{hubError}</span>
              </div>
            )}

            <div className="p-3 overflow-y-auto max-h-[290px] space-y-2">
              {hubLoading && recentCustomerOrders.length === 0 ? (
                <div className="text-xs text-blue-300 animate-pulse">Loading support orders…</div>
              ) : recentCustomerOrders.length === 0 ? (
                <div className="text-xs text-gray-500 text-center py-6">No recent customer orders found.</div>
              ) : (
                recentCustomerOrders.map((item) => {
                  const oid = item.order?.id || item.order?._id || '';
                  const paymentStatus = item.order?.paymentStatus || item.order?.payment?.status || '';
                  const waitMs = getWaitingMs(item.order);

                  return (
                    <div key={`${item.customerId}_${oid || 'order'}`} className="rounded-xl border border-white/5 bg-black/20 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm text-white font-medium truncate">{item.customerName}</p>
                          <p className="text-[11px] text-gray-500 truncate">
                            {oid ? `#${String(oid).slice(0, 10)}` : 'Order'} • {formatDateTime(getOrderTimestamp(item.order))}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap justify-end">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${getWaitingPillClass(waitMs)}`} title="Order waiting time">
                            Wait {formatDurationShort(waitMs)}
                          </span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${getPaymentPillClass(paymentStatus)}`} title="Payment status">
                            {paymentStatus || 'Payment: —'}
                          </span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${getStatusPillClass(item.order?.status)}`} title="Order status">
                            {item.order?.status || 'Unknown'}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-400 flex-wrap">
                        <span>Pending: {safeNum(item.pendingCount)}</span>
                        <span>Active: {safeNum(item.activeCount)}</span>
                        {item.order?.grandTotal != null && <span>₦{safeNum(item.order.grandTotal).toLocaleString()}</span>}
                      </div>

                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={() => tryOpenCustomerChat(item.customerId, item.customerName)}
                          className="glass-button-secondary px-2.5 py-1 text-[11px] inline-flex items-center gap-1"
                        >
                          <MessageSquare size={12} />
                          Support
                        </button>

                        <a
                          href={oid ? `/orders/${encodeURIComponent(oid)}` : '/orders'}
                          className="glass-button-secondary px-2.5 py-1 text-[11px] inline-flex items-center gap-1"
                        >
                          Manage Order <ChevronRight size={12} />
                        </a>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Customers needing attention */}
          <div className="glass-card p-0 overflow-hidden border-0">
            <div className="p-3 border-b border-white/5 bg-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <User size={14} className="text-violet-300" />
                <p className="text-sm font-semibold text-white">Customers Needing Attention</p>
              </div>
              <a href="/customers" className="text-[11px] text-blue-300 hover:text-blue-200 inline-flex items-center gap-1">
                CRM <ExternalLink size={12} />
              </a>
            </div>

            <div className="p-3 space-y-2 max-h-[220px] overflow-y-auto">
              {hubLoading && customersAttentionList.length === 0 ? (
                <div className="text-xs text-blue-300 animate-pulse">Loading customers…</div>
              ) : customersAttentionList.length === 0 ? (
                <div className="text-xs text-gray-500 text-center py-4">No customers with pending/active orders.</div>
              ) : (
                customersAttentionList.map((c) => (
                  <div
                    key={c.customerId}
                    className="rounded-xl border border-white/5 bg-black/20 p-3 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-white truncate">{c.customerName}</p>
                      <p className="text-[11px] text-gray-500 truncate">
                        Pending {safeNum(c.pendingCount)} • Active {safeNum(c.activeCount)} • Total {safeNum(c.totalOrders)}
                      </p>
                    </div>
                    <button
                      onClick={() => tryOpenCustomerChat(c.customerId, c.customerName)}
                      className="glass-button px-2.5 py-1 text-[11px] whitespace-nowrap"
                    >
                      Support
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Mini footer */}
          <div className="glass-card p-3 border border-white/5">
            <div className="flex items-center justify-between">
              <div className="text-[11px] text-gray-500">
                Auto-refresh: <span className="text-gray-300">60s</span>
              </div>
              <button
                onClick={loadSupportHub}
                className="glass-button-secondary px-2.5 py-1 text-[11px] inline-flex items-center gap-1"
                disabled={hubLoading}
              >
                <RefreshCw size={12} className={hubLoading ? 'animate-spin' : ''} />
                Refresh Hub
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
