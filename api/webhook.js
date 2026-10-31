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
            const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
            });
            return await response.json();
        };

        const { data: currentSettings } = await supabase.from('settings').select('*').limit(1).maybeSingle();
        const settingsId = currentSettings ? currentSettings.id : null;

        const mainAdminMenu = {
            inline_keyboard: [
                [{ text: "📝 Edit Text", callback_data: "edit_text" }, { text: "📸 Edit Media", callback_data: "edit_media" }],
                [{ text: "🔘 Edit Button Name", callback_data: "edit_btn" }],
                [{ text: "👁 Preview", callback_data: "preview" }, { text: "🗑 Remove Media", callback_data: "remove_media" }]
            ]
        };

        const backBtn = { inline_keyboard: [[{ text: "⬅️ Back to Admin", callback_data: "admin_home" }]] };

        // Get or Create User
        const getOrCreateUser = async (chatId, msg) => {
            let { data: user } = await supabase.from('users').select('*').eq('telegram_id', chatId).maybeSingle();
            if (!user) {
                const { data: newUser } = await supabase.from('users').insert([{ telegram_id: chatId, first_name: msg?.chat?.first_name || 'Admin', username: msg?.chat?.username || '' }]).select().maybeSingle();
                user = newUser;
            }
            return user;
        };

        // ==========================================
        // 🟢 BUTTON CLICKS
        // ==========================================
        if (update.callback_query) {
            const query = update.callback_query;
            const chatId = query.message.chat.id;
            const data = query.data;

            await tgAPI('answerCallbackQuery', { callback_query_id: query.id });
            if (chatId !== ADMIN_ID) return res.status(200).send('OK');

            const user = await getOrCreateUser(chatId, query.message);

            if (data === 'admin_home') {
                 await supabase.from('users').update({ current_action: '' }).eq('id', user.id);
                 const menu = `🎛 <b>teleEarn Admin Control Center</b>\n\nConfigure your bot's Welcome Screen easily:`;
                 await tgAPI('editMessageText', { chat_id: chatId, message_id: query.message.message_id, text: menu, parse_mode: 'HTML', reply_markup: mainAdminMenu });
            } 
            else if (data === 'edit_text') {
                await supabase.from('users').update({ current_action: 'edit_text' }).eq('id', user.id);
                await tgAPI('sendMessage', { chat_id: chatId, text: `📝 <b>Send your new Welcome Text below:</b>\n<i>(HTML tags like &lt;b&gt;bold&lt;/b&gt; are supported!)</i>`, parse_mode: 'HTML', reply_markup: backBtn });
            } 
            else if (data === 'edit_media') {
                await supabase.from('users').update({ current_action: 'edit_media' }).eq('id', user.id);
                await tgAPI('sendMessage', { chat_id: chatId, text: `📸 <b>Send a new Photo or Video below:</b>`, parse_mode: 'HTML', reply_markup: backBtn });
            } 
            else if (data === 'edit_btn') {
                await supabase.from('users').update({ current_action: 'edit_btn' }).eq('id', user.id);
                await tgAPI('sendMessage', { chat_id: chatId, text: `🔘 <b>Send your new Button Text below:</b>`, parse_mode: 'HTML', reply_markup: backBtn });
            } 
            else if (data === 'remove_media') {
                if (settingsId) await supabase.from('settings').update({ welcome_image: null }).eq('id', settingsId);
                await tgAPI('editMessageText', { chat_id: chatId, message_id: query.message.message_id, text: "✅ <b>Media removed successfully!</b>", parse_mode: 'HTML', reply_markup: backBtn });
            } 
            else if (data === 'preview') {
                let caption = currentSettings?.welcome_text || `🌟 Welcome!`;
                let mediaInfo = currentSettings?.welcome_image || '';
                const replyMarkup = { inline_keyboard: [[{ text: currentSettings?.button_text || "🚀 Open", url: 'https://t.me/teleEarnLinkbot/httpsteleearnlinksvercelapp' }]] };
                if (mediaInfo.startsWith('video:')) await tgAPI('sendVideo', { chat_id: chatId, video: mediaInfo.replace('video:', ''), caption: caption, parse_mode: 'HTML', reply_markup: replyMarkup });
                else if (mediaInfo.startsWith('photo:')) await tgAPI('sendPhoto', { chat_id: chatId, photo: mediaInfo.replace('photo:', ''), caption: caption, parse_mode: 'HTML', reply_markup: replyMarkup });
                else await tgAPI('sendMessage', { chat_id: chatId, text: caption, parse_mode: 'HTML', reply_markup: replyMarkup });
            }
            return res.status(200).send('OK');
        }

        // ==========================================
        // 🟢 MESSAGES & ADMIN INPUTS
        // ==========================================
        if (update && update.message) {
            const msg = update.message;
            const chatId = msg.chat.id;
            const text = msg.text || '';
            const isAdmin = (chatId === ADMIN_ID);

            const user = await getOrCreateUser(chatId, msg);
            const backBtn = { inline_keyboard: [[{ text: "⬅️ Back to Admin", callback_data: "admin_home" }]] };

            const saveToDB = async (updateObj) => {
                if (settingsId) await supabase.from('settings').update(updateObj).eq('id', settingsId);
                else await supabase.from('settings').insert([{ ...updateObj, cpm: 2 }]);
            };

            // ✅ NO MORE FORCE REPLY: Directly process based on 'current_action' state
            if (isAdmin && user.current_action) {
                try {
                    if (user.current_action === 'edit_text') {
                        await saveToDB({ welcome_text: text });
                        await tgAPI('sendMessage', { chat_id: chatId, text: "✅ <b>Text Updated successfully!</b>", parse_mode: 'HTML', reply_markup: backBtn });
                    } 
                    else if (user.current_action === 'edit_media') {
                        let mediaToSave = '';
                        if (msg.photo && msg.photo.length > 0) mediaToSave = 'photo:' + msg.photo[msg.photo.length - 1].file_id;
                        else if (msg.video) mediaToSave = 'video:' + msg.video.file_id;
                        else if (msg.animation) mediaToSave = 'video:' + msg.animation.file_id;
                        else if (text.startsWith('http')) mediaToSave = text; 

                        if (mediaToSave) {
                            await saveToDB({ welcome_image: mediaToSave });
                            await tgAPI('sendMessage', { chat_id: chatId, text: "✅ <b>Media Updated successfully!</b>", parse_mode: 'HTML', reply_markup: backBtn });
                        } else {
                            return await tgAPI('sendMessage', { chat_id: chatId, text: "❌ <b>Invalid media.</b> Please send a valid photo, video, or URL.", parse_mode: 'HTML', reply_markup: backBtn });
                        }
                    }
                    else if (user.current_action === 'edit_btn') {
                        await saveToDB({ button_text: text });
                        await tgAPI('sendMessage', { chat_id: chatId, text: "✅ <b>Button Name Updated successfully!</b>", parse_mode: 'HTML', reply_markup: backBtn });
                    }
                    // Reset State
                    await supabase.from('users').update({ current_action: '' }).eq('id', user.id);
                } catch (e) {
                    await tgAPI('sendMessage', { chat_id: chatId, text: `❌ Error: ${e.message}`, parse_mode: 'HTML', reply_markup: backBtn });
                }
                return res.status(200).send('OK');
            }

            if (text.startsWith('/start')) {
                const param = text.split(' ')[1] || '';
                let finalUrl = 'https://t.me/teleEarnLinkbot/httpsteleearnlinksvercelapp';
                if (param) finalUrl += `?startapp=${param}`;

                let caption = currentSettings?.welcome_text || `🌟 <b>Welcome to teleEarn!</b> 🌟\n\nClick below to open your Dashboard!`;
                let mediaInfo = currentSettings?.welcome_image || '';
                let buttonText = currentSettings?.button_text || "🚀 Open teleEarn Dashboard 🚀";
                const replyMarkup = { inline_keyboard: [[{ text: buttonText, url: finalUrl }]] };

                if (mediaInfo.startsWith('video:')) await tgAPI('sendVideo', { chat_id: chatId, video: mediaInfo.replace('video:', ''), caption: caption, parse_mode: 'HTML', reply_markup: replyMarkup });
                else if (mediaInfo.startsWith('photo:')) await tgAPI('sendPhoto', { chat_id: chatId, photo: mediaInfo.replace('photo:', ''), caption: caption, parse_mode: 'HTML', reply_markup: replyMarkup });
                else await tgAPI('sendMessage', { chat_id: chatId, text: caption, parse_mode: 'HTML', reply_markup: replyMarkup });
            }
            else if (isAdmin && text === '/admin') {
                await supabase.from('users').update({ current_action: '' }).eq('id', user.id);
                await tgAPI('sendMessage', { chat_id: chatId, text: `🎛 <b>teleEarn Admin Control Center</b>\n\nConfigure your bot's Welcome Screen easily:`, parse_mode: 'HTML', reply_markup: mainAdminMenu });
            }
        }
        res.status(200).send('OK');
    } catch (error) { res.status(200).send('Error'); }
}
