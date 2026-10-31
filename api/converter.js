const { createClient } = require('@supabase/supabase-js');

export default async function handler(req, res) {
    if (req.method === 'GET') return res.status(200).send('Main Bot Webhook Active!');

    try {
        const BOT_TOKEN = process.env.BOT_TOKEN;
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
        const ADMIN_ID = parseInt(process.env.ADMIN_ID); 
        const APP_SHORT_NAME = 'httpsteleearnlinksvercelapp'; 

        if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_KEY) return res.status(200).send('Env missing');

        const update = req.body;
        const cleanUrl = SUPABASE_URL.trim().replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
        const supabase = createClient(cleanUrl, SUPABASE_KEY.trim());

        const tgAPI = async (method, body) => {
            const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            return await response.json();
        };

        const { data: currentSettings } = await supabase.from('settings').select('*').limit(1).maybeSingle();
        const settingsId = currentSettings ? currentSettings.id : null;

        // 🟢 ADMIN PANEL CALLBACKS
        if (update.callback_query) {
            const query = update.callback_query;
            const chatId = query.message.chat.id;
            const data = query.data;

            await tgAPI('answerCallbackQuery', { callback_query_id: query.id });
            if (chatId !== ADMIN_ID) return res.status(200).send('OK');

            const backBtn = { inline_keyboard: [[{ text: "⬅️ Back", callback_data: "admin_home" }]] };

            if (data === 'admin_home') {
                 const menu = { inline_keyboard: [[{ text: "📝 Edit Text", callback_data: "edit_text" }, { text: "📸 Edit Media", callback_data: "edit_media" }], [{ text: "🔘 Edit Button Name", callback_data: "edit_btn" }, { text: "🎨 Edit Button Color", callback_data: "edit_color" }], [{ text: "👁 Preview", callback_data: "preview" }, { text: "🗑 Remove Media", callback_data: "remove_media" }]] };
                 await tgAPI('editMessageText', { chat_id: chatId, message_id: query.message.message_id, text: `🎛 <b>teleEarn Main Admin Panel</b>`, parse_mode: 'HTML', reply_markup: menu });
            } 
            else if (data === 'edit_text') await tgAPI('sendMessage', { chat_id: chatId, text: `📝 <b>Reply (Swipe Left)</b> with your new welcome text.`, parse_mode: 'HTML', reply_markup: { force_reply: true } });
            else if (data === 'edit_media') await tgAPI('sendMessage', { chat_id: chatId, text: `📸 <b>Reply (Swipe Left)</b> with a Photo or Video.`, parse_mode: 'HTML', reply_markup: { force_reply: true } });
            else if (data === 'edit_btn') await tgAPI('sendMessage', { chat_id: chatId, text: `🔘 <b>Reply (Swipe Left)</b> with your new Button Text.`, parse_mode: 'HTML', reply_markup: { force_reply: true } });
            else if (data === 'edit_color') {
                await tgAPI('editMessageText', { chat_id: chatId, message_id: query.message.message_id, text: `🎨 Select Button Color:`, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: "🟦 Blue", callback_data: "set_color_primary" }, { text: "🟩 Green", callback_data: "set_color_success" }, { text: "🟥 Red", callback_data: "set_color_danger" }], [{ text: "⬅️ Back", callback_data: "admin_home" }]] } });
            }
            else if (data.startsWith('set_color_')) {
                const newColor = data.replace('set_color_', '');
                if (settingsId) await supabase.from('settings').update({ button_color: newColor }).eq('id', settingsId);
                await tgAPI('editMessageText', { chat_id: chatId, message_id: query.message.message_id, text: `✅ Color set to ${newColor}!`, reply_markup: backBtn });
            }
            else if (data === 'remove_media') {
                if (settingsId) await supabase.from('settings').update({ welcome_image: null }).eq('id', settingsId);
                await tgAPI('editMessageText', { chat_id: chatId, message_id: query.message.message_id, text: "✅ Media removed!", parse_mode: 'HTML', reply_markup: backBtn });
            } 
            else if (data === 'preview') {
                let cap = currentSettings?.welcome_text || `🌟 Welcome!`;
                let img = currentSettings?.welcome_image || '';
                // URL ISSUE FIXED HERE:
                const rm = { inline_keyboard: [[{ text: currentSettings?.button_text || "🚀 Open", url: `https://t.me/teleEarnLinkbot/${APP_SHORT_NAME}`, style: currentSettings?.button_color || "primary" }]] };
                if (img.startsWith('video:')) await tgAPI('sendVideo', { chat_id: chatId, video: img.replace('video:', ''), caption: cap, parse_mode: 'HTML', reply_markup: rm });
                else if (img.startsWith('photo:')) await tgAPI('sendPhoto', { chat_id: chatId, photo: img.replace('photo:', ''), caption: cap, parse_mode: 'HTML', reply_markup: rm });
                else await tgAPI('sendMessage', { chat_id: chatId, text: cap, parse_mode: 'HTML', reply_markup: rm });
            }
            return res.status(200).send('OK');
        }

        // 🟢 NORMAL MESSAGES
        if (update && update.message) {
            const msg = update.message;
            const chatId = msg.chat.id;
            const text = msg.text || '';
            const isAdmin = (chatId === ADMIN_ID);
            const backBtn = { inline_keyboard: [[{ text: "⬅️ Back", callback_data: "admin_home" }]] };

            if (isAdmin && msg.reply_to_message) {
                const rt = msg.reply_to_message.text || '';
                try {
                    if (rt.includes("Welcome Text Setup")) { await supabase.from('settings').update({ welcome_text: text }).eq('id', settingsId); await tgAPI('sendMessage', { chat_id: chatId, text: "✅ Text Updated!", reply_markup: backBtn }); }
                    else if (rt.includes("Media Setup")) {
                        let m = msg.photo ? 'photo:'+msg.photo[msg.photo.length-1].file_id : (msg.video ? 'video:'+msg.video.file_id : '');
                        if (m) { await supabase.from('settings').update({ welcome_image: m }).eq('id', settingsId); await tgAPI('sendMessage', { chat_id: chatId, text: "✅ Media Updated!", reply_markup: backBtn }); }
                    }
                    else if (rt.includes("Button Setup")) { await supabase.from('settings').update({ button_text: text }).eq('id', settingsId); await tgAPI('sendMessage', { chat_id: chatId, text: "✅ Button Updated!", reply_markup: backBtn }); }
                } catch(e) {}
                return res.status(200).send('OK');
            }

            if (text.startsWith('/start')) {
                const param = text.split(' ')[1] || '';
                // URL ISSUE FIXED HERE:
                let finalUrl = `https://t.me/teleEarnLinkbot/${APP_SHORT_NAME}`;
                if (param) finalUrl += `?startapp=${param}`;
                
                let cap = currentSettings?.welcome_text || `🌟 Welcome!`;
                let img = currentSettings?.welcome_image || '';
                const rm = { inline_keyboard: [[{ text: currentSettings?.button_text || "🚀 Open", url: finalUrl, style: currentSettings?.button_color || "primary" }]] };

                if (img.startsWith('video:')) await tgAPI('sendVideo', { chat_id: chatId, video: img.replace('video:', ''), caption: cap, parse_mode: 'HTML', reply_markup: rm });
                else if (img.startsWith('photo:')) await tgAPI('sendPhoto', { chat_id: chatId, photo: img.replace('photo:', ''), caption: cap, parse_mode: 'HTML', reply_markup: rm });
                else await tgAPI('sendMessage', { chat_id: chatId, text: cap, parse_mode: 'HTML', reply_markup: rm });
            }
            else if (isAdmin && text === '/admin') {
                await tgAPI('sendMessage', { chat_id: chatId, text: `🎛 <b>Main Admin Panel</b>`, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: "📝 Edit Text", callback_data: "edit_text" }, { text: "📸 Edit Media", callback_data: "edit_media" }], [{ text: "🔘 Edit Button Name", callback_data: "edit_btn" }, { text: "🎨 Edit Button Color", callback_data: "edit_color" }], [{ text: "👁 Preview", callback_data: "preview" }, { text: "🗑 Remove Media", callback_data: "remove_media" }]] } });
            }
        }
        res.status(200).send('OK');
    } catch (error) { res.status(200).send('Error'); }
}
