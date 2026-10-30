const { createClient } = require('@supabase/supabase-js');

export default async function handler(req, res) {
    if (req.method === 'GET') return res.status(200).send('Webhook is Super Active!');

    try {
        const BOT_TOKEN = process.env.BOT_TOKEN;
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
        const ADMIN_ID = parseInt(process.env.ADMIN_ID); // Vercel se aapki ID lega

        if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_KEY) return res.status(200).send('Env missing');

        const update = req.body;
        const cleanUrl = SUPABASE_URL.trim().replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
        const supabase = createClient(cleanUrl, SUPABASE_KEY.trim());

        // Telegram API ko command bhejne ka short function
        const tgAPI = async (method, body) => {
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
        };

        // ==========================================
        // 1️⃣ ADMIN PANEL: BUTTON CLICKS HANDLE KAREIN
        // ==========================================
        if (update.callback_query) {
            const query = update.callback_query;
            const chatId = query.message.chat.id;
            const data = query.data;

            if (chatId !== ADMIN_ID) return res.status(200).send('OK');

            if (data === 'admin_home') {
                 const menu = `⚙️ <b>teleEarn Premium Admin Panel</b>\n\nWhat would you like to edit?`;
                 await tgAPI('editMessageText', {
                     chat_id: chatId, message_id: query.message.message_id, text: menu, parse_mode: 'HTML',
                     reply_markup: {
                         inline_keyboard: [
                             [{ text: "📝 Edit Welcome Text", callback_data: "edit_text" }],
                             [{ text: "📸/🎥 Edit Image or Video", callback_data: "edit_media" }],
                             [{ text: "🔘 Edit Button Name", callback_data: "edit_btn" }],
                             [{ text: "🗑 Remove Media", callback_data: "remove_media" }]
                         ]
                     }
                 });
            } else if (data === 'edit_text') {
                await tgAPI('sendMessage', {
                    chat_id: chatId, text: "📝 <b>Reply to this message</b> with your new Welcome Text (HTML supported):",
                    parse_mode: 'HTML', reply_markup: { force_reply: true }
                });
            } else if (data === 'edit_media') {
                await tgAPI('sendMessage', {
                    chat_id: chatId, text: "📸/🎥 <b>Reply to this message</b> by sending a Photo, a Video, or a Direct URL:",
                    parse_mode: 'HTML', reply_markup: { force_reply: true }
                });
            } else if (data === 'edit_btn') {
                await tgAPI('sendMessage', {
                    chat_id: chatId, text: "🔘 <b>Reply to this message</b> with the new Button Name:",
                    parse_mode: 'HTML', reply_markup: { force_reply: true }
                });
            } else if (data === 'remove_media') {
                const { data: currentSettings } = await supabase.from('settings').select('id').limit(1).single();
                if (currentSettings) await supabase.from('settings').update({ welcome_image: null }).eq('id', currentSettings.id);
                await tgAPI('sendMessage', {
                    chat_id: chatId, text: "✅ Media removed successfully!",
                    reply_markup: { inline_keyboard: [[{ text: "⬅️ Back to Admin", callback_data: "admin_home" }]] }
                });
            }
            return res.status(200).send('OK');
        }

        // ==========================================
        // 2️⃣ MESSAGES & REPLIES HANDLE KAREIN
        // ==========================================
        if (update && update.message) {
            const msg = update.message;
            const chatId = msg.chat.id;
            const text = msg.text || '';
            const isAdmin = (chatId === ADMIN_ID);

            const { data: currentSettings } = await supabase.from('settings').select('*').limit(1).single();
            const settingsId = currentSettings ? currentSettings.id : null;

            // 🟢 AGAR ADMIN KISI MESSAGE KA REPLY DE RAHA HAI (Data Save)
            if (isAdmin && msg.reply_to_message) {
                const replyText = msg.reply_to_message.text || '';
                
                if (replyText.includes("new Welcome Text")) {
                    if (settingsId) await supabase.from('settings').update({ welcome_text: text }).eq('id', settingsId);
                    else await supabase.from('settings').insert([{ welcome_text: text }]);
                    await tgAPI('sendMessage', { chat_id: chatId, text: "✅ Text Updated successfully!", reply_markup: { inline_keyboard: [[{ text: "⬅️ Back to Admin", callback_data: "admin_home" }]] } });
                } 
                else if (replyText.includes("Photo, a Video, or a Direct URL")) {
                    let mediaToSave = '';
                    // Agar admin ne direct photo ya video bheji hai!
                    if (msg.photo && msg.photo.length > 0) mediaToSave = 'photo:' + msg.photo[msg.photo.length - 1].file_id;
                    else if (msg.video) mediaToSave = 'video:' + msg.video.file_id;
                    else if (msg.animation) mediaToSave = 'video:' + msg.animation.file_id;
                    else if (text) mediaToSave = text; // Agar URL likha hai

                    if (mediaToSave) {
                        if (settingsId) await supabase.from('settings').update({ welcome_image: mediaToSave }).eq('id', settingsId);
                        else await supabase.from('settings').insert([{ welcome_image: mediaToSave }]);
                        await tgAPI('sendMessage', { chat_id: chatId, text: "✅ Media Updated successfully!", reply_markup: { inline_keyboard: [[{ text: "⬅️ Back to Admin", callback_data: "admin_home" }]] } });
                    } else {
                        await tgAPI('sendMessage', { chat_id: chatId, text: "❌ Invalid media. Please send a photo, video, or URL." });
                    }
                }
                else if (replyText.includes("new Button Name")) {
                    if (settingsId) await supabase.from('settings').update({ button_text: text }).eq('id', settingsId);
                    else await supabase.from('settings').insert([{ button_text: text }]);
                    await tgAPI('sendMessage', { chat_id: chatId, text: "✅ Button Name Updated successfully!", reply_markup: { inline_keyboard: [[{ text: "⬅️ Back to Admin", callback_data: "admin_home" }]] } });
                }
                return res.status(200).send('OK');
            }

            // 🟢 NORMAL USER: /start Command
            if (text.startsWith('/start')) {
                const param = text.split(' ')[1] || '';
                let finalUrl = 'https://t.me/teleEarnLinkbot/httpsteleearnlinksvercelapp';
                if (param) finalUrl += `?startapp=${param}`;

                let caption = currentSettings?.welcome_text || `🌟 <b>Welcome to teleEarn!</b> 🌟\n\nClick below to open your Dashboard!`;
                let mediaInfo = currentSettings?.welcome_image || '';
                let buttonText = currentSettings?.button_text || "🚀 Open teleEarn Dashboard 🚀";

                const replyMarkup = { inline_keyboard: [[{ text: buttonText, url: finalUrl }]] };

                if (mediaInfo) {
                    if (mediaInfo.startsWith('video:') || mediaInfo.endsWith('.mp4')) {
                        const vId = mediaInfo.replace('video:', '');
                        await tgAPI('sendVideo', { chat_id: chatId, video: vId, caption: caption, parse_mode: 'HTML', reply_markup: replyMarkup });
                    } else {
                        const pId = mediaInfo.replace('photo:', '');
                        await tgAPI('sendPhoto', { chat_id: chatId, photo: pId, caption: caption, parse_mode: 'HTML', reply_markup: replyMarkup });
                    }
                } else {
                    await tgAPI('sendMessage', { chat_id: chatId, text: caption, parse_mode: 'HTML', reply_markup: replyMarkup });
                }
            }
            
            // 🟢 ADMIN PANEL OPEN COMMAND
            else if (isAdmin && text === '/admin') {
                const adminMenu = `⚙️ <b>teleEarn Premium Admin Panel</b>\n\nWhat would you like to edit?`;
                await tgAPI('sendMessage', {
                    chat_id: chatId, text: adminMenu, parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "📝 Edit Welcome Text", callback_data: "edit_text" }],
                            [{ text: "📸/🎥 Edit Image or Video", callback_data: "edit_media" }],
                            [{ text: "🔘 Edit Button Name", callback_data: "edit_btn" }],
                            [{ text: "🗑 Remove Media", callback_data: "remove_media" }]
                        ]
                    }
                });
            }
        }
        res.status(200).send('OK');
    } catch (error) {
        console.error(error);
        res.status(200).send('Error');
    }
}
