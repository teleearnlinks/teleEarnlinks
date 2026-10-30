const { createClient } = require('@supabase/supabase-js');

export default async function handler(req, res) {
    if (req.method === 'GET') return res.status(200).send('Premium Webhook Active!');

    try {
        const BOT_TOKEN = process.env.BOT_TOKEN;
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
        const ADMIN_ID = parseInt(process.env.ADMIN_ID); 

        if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_KEY) return res.status(200).send('Env missing');

        const update = req.body;
        const cleanUrl = SUPABASE_URL.trim().replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
        const supabase = createClient(cleanUrl, SUPABASE_KEY.trim());

        const tgAPI = async (method, body) => {
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
        };

        const { data: currentSettings } = await supabase.from('settings').select('*').limit(1).maybeSingle();
        const settingsId = currentSettings ? currentSettings.id : null;

        const mainAdminMenu = {
            inline_keyboard: [
                [{ text: "📝 Edit Text", callback_data: "edit_text", style: "primary" }, { text: "📸 Edit Media", callback_data: "edit_media", style: "primary" }],
                [{ text: "🔘 Edit Button Name", callback_data: "edit_btn", style: "primary" }, { text: "🎨 Edit Button Color", callback_data: "edit_color", style: "primary" }],
                [{ text: "👁 Preview", callback_data: "preview", style: "success" }, { text: "🗑 Remove Media", callback_data: "remove_media", style: "danger" }]
            ]
        };

        const backBtn = { inline_keyboard: [[{ text: "⬅️ Back to Admin", callback_data: "admin_home", style: "primary" }]] };

        // ==========================================
        // 1️⃣ ADMIN PANEL BUTTON CLICKS
        // ==========================================
        if (update.callback_query) {
            const query = update.callback_query;
            const chatId = query.message.chat.id;
            const data = query.data;

            await tgAPI('answerCallbackQuery', { callback_query_id: query.id });
            if (chatId !== ADMIN_ID) return res.status(200).send('OK');

            if (data === 'admin_home') {
                 const menu = `🎛 <b>teleEarn Admin Control Center</b>\n\nConfigure your bot's Welcome Screen easily. Select an option below:`;
                 await tgAPI('editMessageText', { chat_id: chatId, message_id: query.message.message_id, text: menu, parse_mode: 'HTML', reply_markup: mainAdminMenu });
            } 
            else if (data === 'edit_text') {
                const msg = `📝 <b>Welcome Text Setup</b>\n\n📌 <b>Reply to this exact message</b> with your new welcome text.\n<i>(HTML tags like &lt;b&gt;bold&lt;/b&gt; are supported!)</i>`;
                await tgAPI('sendMessage', { chat_id: chatId, text: msg, parse_mode: 'HTML', reply_markup: { force_reply: true } });
            } 
            else if (data === 'edit_media') {
                const msg = `📸 <b>Media Setup</b>\n\n📌
