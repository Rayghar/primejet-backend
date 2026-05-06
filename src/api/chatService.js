import apiClient from './apiClient';

// Get list of customers who have initiated chats
export const getActiveChatThreads = async () => {
    const res = await apiClient.get('/chat/admin/threads');
    return res.data; 
};

// Get messages for a specific user
export const getChatHistory = async (userId) => {
    const res = await apiClient.get(`/chat/admin/${userId}/messages`);
    return res.data;
};

// Send a message as Admin
export const sendAdminMessage = async (recipientId, text) => {
    const res = await apiClient.post('/chat/send', {
        recipientId,
        text,
        senderRole: 'admin'
    });
    return res.data;
};