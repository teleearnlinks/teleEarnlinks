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

        const getOrCreateUser = async (chatId, msg) => {
            let { data: user } = await supabase.from('users').select('*').eq('telegram_id', chatId).maybeSingle();
            if (!user) {
                const { data: newUser } = await supabase.from('users').insert([{ telegram_id: chatId, first_name: msg?.chat?.first_name || 'Admin', username: msg?.chat?.username || '' }]).select().maybeSingle();
                user = newUser;
            }
            return user;
        };

        const mainAdminMenu = {
            inline_keyboard: [
                [{ text: "📝 Edit Text", callback_data: "edit_text" }, { text: "📸 Edit Media", callback_data: "edit_media" }],
                [{ text: "🔘 Edit Button Name", callback_data: "edit_btn" }, { text: "🎨 Edit Button Color", callback_data: "edit_color" }],
                [{ text: "👁 Preview", callback_data: "preview" }, { text: "🗑 Remove Media", callback_data: "remove_media" }]
            ]
        };
        const backBtn = { inline_keyboard: [[{ text: "⬅️ Back", callback_data: "admin_home" }]] };

        if (update.callback_query) {
            const query = update.callback_query;
            const chatId = query.message.chat.id;
            const data = query.data;

            await tgAPI('answerCallbackQuery', { callback_query_id: query.id });
            if (chatId !== ADMIN_ID) return res.status(200).send('OK');

            const user = await getOrCreateUser(chatId, query.message);

            if (data === 'admin_home') {
                 await supabase.from('users').update({ current_action: '' }).eq('id', user.id);
                 await tgAPI('editMessageText', { chat_id: chatId, message_id: query.message.message_id, text: `🎛 <b>teleEarn Main Admin Panel</b>`, parse_mode: 'HTML', reply_markup: mainAdminMenu });
            } 
            else if (data === 'edit_text') {
                await supabase.from('users').update({ current_action: 'edit_text' }).eq('id', user.id);
                await tgAPI('sendMessage', { chat_id: chatId, text: `📝 <b>Send your new Welcome Text below:</b>\n<i>(Send /cancel to abort)</i>`, parse_mode: 'HTML' });
            } 
            else if (data === 'edit_media') {
                await supabase.from('users').update({ current_action: 'edit_media' }).eq('id', user.id);
                await tgAPI('sendMessage', { chat_id: chatId, text: `📸 <b>Send a new Photo or Video below:</b>\n<i>(Send /cancel to abort)</i>`, parse_mode: 'HTML' });
            } 
            else if (data === 'edit_btn') {
                await supabase.from('users').update({ current_action: 'edit_btn' }).eq('id', user.id);
                await tgAPI('sendMessage', { chat_id: chatId, text: `🔘 <b>Send your new Button Text below:</b>\n<i>(Send /cancel to abort)</i>`, parse_mode: 'HTML' });
            }
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
                const rm = { inline_keyboard: [[{ text: currentSettings?.button_text || "🚀 Open", url: `https://t.me/teleEarnLinkbot/${APP_SHORT_NAME}`, style: currentSettings?.button_color || "primary" }]] };
                if (img.startsWith('video:')) await tgAPI('sendVideo', { chat_id: chatId, video: img.replace('video:', ''), caption: cap, parse_mode: 'HTML', reply_markup: rm });
                else if (img.startsWith('photo:')) await tgAPI('sendPhoto', { chat_id: chatId, photo: img.replace('photo:', ''), caption: cap, parse_mode: 'HTML', reply_markup: rm });
                else await tgAPI('sendMessage', { chat_id: chatId, text: cap, parse_mode: 'HTML', reply_markup: rm });
            }
            return res.status(200).send('OK');
        }

        if (update && update.message) {
            const msg = update.message;
            const chatId = msg.chat.id;
            const text = msg.text || '';
            const isAdmin = (chatId === ADMIN_ID);
            const user = await getOrCreateUser(chatId, msg);
            const backBtn = { inline_keyboard: [[{ text: "⬅️ Back", callback_data: "admin_home" }]] };

            // 🟢 EMERGENCY ESCAPE
            if (text === '/start' || text === '/cancel') {
                if (user.current_action) await supabase.from('users').update({ current_action: '' }).eq('id', user.id);
                if (text === '/cancel') {
                    await tgAPI('sendMessage', { chat_id: chatId, text: "❌ Action cancelled.", reply_markup: backBtn });
                    return res.status(200).send('OK');
                }

                const param = text.split(' ')[1] || '';
                let finalUrl = `https://t.me/teleEarnLinkbot/${APP_SHORT_NAME}`;
                if (param) finalUrl += `?startapp=${param}`;
                
                let cap = currentSettings?.welcome_text || `🌟 Welcome!`;
                let img = currentSettings?.welcome_image || '';
                const rm = { inline_keyboard: [[{ text: currentSettings?.button_text || "🚀 Open", url: finalUrl, style: currentSettings?.button_color || "primary" }]] };

                if (img.startsWith('video:')) await tgAPI('sendVideo', { chat_id: chatId, video: img.replace('video:', ''), caption: cap, parse_mode: 'HTML', reply_markup: rm });
                else if (img.startsWith('photo:')) await tgAPI('sendPhoto', { chat_id: chatId, photo: img.replace('photo:', ''), caption: cap, parse_mode: 'HTML', reply_markup: rm });
                else await tgAPI('sendMessage', { chat_id: chatId, text: cap, parse_mode: 'HTML', reply_markup: rm });
                return res.status(200).send('OK');
            }

            if (isAdmin && user.current_action) {
                try {
                    const saveToDB = async (obj) => {
                        if (settingsId) await supabase.from('settings').update(obj).eq('id', settingsId);
                        else await supabase.from('settings').insert([{ ...obj, cpm: 2 }]);
                    };

                    if (user.current_action === 'edit_text') {
                        await saveToDB({ welcome_text: text });
                        await tgAPI('sendMessage', { chat_id: chatId, text: "✅ Text Updated!", parse_mode: 'HTML', reply_markup: backBtn });
                    } else if (user.current_action === 'edit_media') {
                        let m = msg.photo ? 'photo:'+msg.photo[msg.photo.length-1].file_id : (msg.video ? 'video:'+msg.video.file_id : '');
                        if (m || text.startsWith('http')) {
                            await saveToDB({ welcome_image: m || text });
                            await tgAPI('sendMessage', { chat_id: chatId, text: "✅ Media Updated!", parse_mode: 'HTML', reply_markup: backBtn });
                        } else {
                            await tgAPI('sendMessage', { chat_id: chatId, text: "❌ Invalid Media.", parse_mode: 'HTML', reply_markup: backBtn });
                        }
                    } else if (user.current_action === 'edit_btn') {
                        await saveToDB({ button_text: text });
                        await tgAPI('sendMessage', { chat_id: chatId, text: "✅ Button Updated!", parse_mode: 'HTML', reply_markup: backBtn });
                    }
                    await supabase.from('users').update({ current_action: '' }).eq('id', user.id);
                } catch(e) {
                    await tgAPI('sendMessage', { chat_id: chatId, text: `❌ Error: ${e.message}`, parse_mode: 'HTML', reply_markup: backBtn });
                }
                return res.status(200).send('OK');
            }

            if (isAdmin && text === '/admin') {
                await supabase.from('users').update({ current_action: '' }).eq('id', user.id);
                await tgAPI('sendMessage', { chat_id: chatId, text: `🎛 <b>Main Admin Panel</b>`, parse_mode: 'HTML', reply_markup: mainAdminMenu });
            }
        }
        res.status(200).send('OK');
    } catch (error) { res.status(200).send('Error'); }
}
