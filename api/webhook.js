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

        // Universal Telegram API Caller
        const tgAPI = async (method, body) => {
            const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            return await response.json();
        };

        // Get Current Settings Safely
        const { data: currentSettings } = await supabase.from('settings').select('*').limit(1).maybeSingle();
        const settingsId = currentSettings ? currentSettings.id : null;

        // ==========================================
        // 1️⃣ PREMIUM ADMIN DASHBOARD (BUTTON CLICKS)
        // ==========================================
        if (update.callback_query) {
            const query = update.callback_query;
            const chatId = query.message.chat.id;
            const data = query.data;

            // Stop the button loading spinner instantly
            await tgAPI('answerCallbackQuery', { callback_query_id: query.id });

            if (chatId !== ADMIN_ID) return res.status(200).send('OK');

            const backBtn = { inline_keyboard: [[{ text: "⬅️ Back to Dashboard", callback_data: "admin_home" }]] };

            if (data === 'admin_home') {
                 const menu = `👑 <b>𝗔𝗗𝗠𝗜𝗡 𝗖𝗢𝗡𝗧𝗥𝗢𝗟 𝗣𝗔𝗡𝗘𝗟</b> 👑\n━━━━━━━━━━━━━━━━━━━━\nWelcome Master! Fully customize your bot's welcome screen below.\n\n👇 <b>Select an option to edit:</b>`;
                 await tgAPI('editMessageText', {
                     chat_id: chatId, message_id: query.message.message_id, text: menu, parse_mode: 'HTML',
                     reply_markup: {
                         inline_keyboard: [
                             [{ text: "📝 Edit Welcome Text", callback_data: "edit_text" }],
                             [{ text: "📸/🎥 Edit Image/Video", callback_data: "edit_media" }],
                             [{ text: "🔘 Edit Button Name", callback_data: "edit_btn" }],
                             [{ text: "🗑 Remove Media", callback_data: "remove_media" }, { text: "👁 Preview", callback_data: "preview" }]
                         ]
                     }
                 });
            } else if (data === 'edit_text') {
                const msg = `📝 <b>𝗘𝗗𝗜𝗧 𝗪𝗘𝗟𝗖𝗢𝗠𝗘 𝗧𝗘𝗫𝗧</b>\n━━━━━━━━━━━━━━━━━━━━\n⚠️ <b>IMPORTANT:</b> You MUST <b>Swipe Left (Reply)</b> to this exact message to change the text.\n\n👇 <i>Reply to this message with your new text:</i>`;
                await tgAPI('sendMessage', { chat_id: chatId, text: msg, parse_mode: 'HTML', reply_markup: { force_reply: true } });
            } else if (data === 'edit_media') {
                const msg = `📸 <b>𝗘𝗗𝗜𝗧 𝗠𝗘𝗗𝗜𝗔 (Photo/Video)</b>\n━━━━━━━━━━━━━━━━━━━━\n⚠️ <b>IMPORTANT:</b> You MUST <b>Swipe Left (Reply)</b> to this exact message.\n\n👇 <i>Reply to this message with a Photo, a Video, or an Image URL:</i>`;
                await tgAPI('sendMessage', { chat_id: chatId, text: msg, parse_mode: 'HTML', reply_markup: { force_reply: true } });
            } else if (data === 'edit_btn') {
                const msg = `🔘 <b>𝗘𝗗𝗜𝗧 𝗕𝗨𝗧𝗧𝗢𝗡 𝗡𝗔𝗠𝗘</b>\n━━━━━━━━━━━━━━━━━━━━\n⚠️ <b>IMPORTANT:</b> You MUST <b>Swipe Left (Reply)</b> to this exact message.\n\n👇 <i>Reply to this message with your new button name:</i>`;
                await tgAPI('sendMessage', { chat_id: chatId, text: msg, parse_mode: 'HTML', reply_markup: { force_reply: true } });
            } else if (data === 'remove_media') {
                if (settingsId) await supabase.from('settings').update({ welcome_image: null }).eq('id', settingsId);
                await tgAPI('editMessageText', { chat_id: chatId, message_id: query.message.message_id, text: "✅ <b>Media removed successfully!</b>", parse_mode: 'HTML', reply_markup: backBtn });
            } else if (data === 'preview') {
                // Simulate /start for admin
                let caption = currentSettings?.welcome_text || `🌟 <b>Welcome to teleEarn!</b> 🌟\n\nClick below to open your Dashboard!`;
                let mediaInfo = currentSettings?.welcome_image || '';
                let buttonText = currentSettings?.button_text || "🚀 Open teleEarn Dashboard 🚀";
                const replyMarkup = { inline_keyboard: [[{ text: buttonText, url: 'https://t.me/teleEarnLinkbot/httpsteleearnlinksvercelapp' }]] };

                if (mediaInfo) {
                    if (mediaInfo.startsWith('video:') || mediaInfo.endsWith('.mp4')) {
                        await tgAPI('sendVideo', { chat_id: chatId, video: mediaInfo.replace('video:', ''), caption: caption, parse_mode: 'HTML', reply_markup: replyMarkup });
                    } else {
                        await tgAPI('sendPhoto', { chat_id: chatId, photo: mediaInfo.replace('photo:', ''), caption: caption, parse_mode: 'HTML', reply_markup: replyMarkup });
                    }
                } else {
                    await tgAPI('sendMessage', { chat_id: chatId, text: caption, parse_mode: 'HTML', reply_markup: replyMarkup });
                }
            }
            return res.status(200).send('OK');
        }

        // ==========================================
        // 2️⃣ MESSAGE & REPLY HANDLER
        // ==========================================
        if (update && update.message) {
            const msg = update.message;
            const chatId = msg.chat.id;
            const text = msg.text || '';
            const isAdmin = (chatId === ADMIN_ID);

            const backBtn = { inline_keyboard: [[{ text: "⬅️ Back to Dashboard", callback_data: "admin_home" }]] };

            // 🟢 HANDLE ADMIN REPLIES
            if (isAdmin && msg.reply_to_message) {
                const replyText = msg.reply_to_message.text || '';
                
                if (replyText.includes("new text:")) {
                    if (settingsId) await supabase.from('settings').update({ welcome_text: text }).eq('id', settingsId);
                    else await supabase.from('settings').insert([{ welcome_text: text }]);
                    await tgAPI('sendMessage', { chat_id: chatId, text: "✅ <b>Text Updated successfully!</b>", parse_mode: 'HTML', reply_markup: backBtn });
                } 
                else if (replyText.includes("Photo, a Video, or an Image URL:")) {
                    let mediaToSave = '';
                    if (msg.photo && msg.photo.length > 0) mediaToSave = 'photo:' + msg.photo[msg.photo.length - 1].file_id;
                    else if (msg.video) mediaToSave = 'video:' + msg.video.file_id;
                    else if (msg.animation) mediaToSave = 'video:' + msg.animation.file_id;
                    else if (text.startsWith('http')) mediaToSave = text; 

                    if (mediaToSave) {
                        if (settingsId) await supabase.from('settings').update({ welcome_image: mediaToSave }).eq('id', settingsId);
                        else await supabase.from('settings').insert([{ welcome_image: mediaToSave }]);
                        await tgAPI('sendMessage', { chat_id: chatId, text: "✅ <b>Media Updated successfully!</b>", parse_mode: 'HTML', reply_markup: backBtn });
                    } else {
                        await tgAPI('sendMessage', { chat_id: chatId, text: "❌ <b>Invalid media.</b> Please send a valid photo, video, or URL link.", parse_mode: 'HTML', reply_markup: backBtn });
                    }
                }
                else if (replyText.includes("new button name:")) {
                    if (settingsId) await supabase.from('settings').update({ button_text: text }).eq('id', settingsId);
                    else await supabase.from('settings').insert([{ button_text: text }]);
                    await tgAPI('sendMessage', { chat_id: chatId, text: "✅ <b>Button Name Updated successfully!</b>", parse_mode: 'HTML', reply_markup: backBtn });
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
                        await tgAPI('sendVideo', { chat_id: chatId, video: mediaInfo.replace('video:', ''), caption: caption, parse_mode: 'HTML', reply_markup: replyMarkup });
                    } else {
                        await tgAPI('sendPhoto', { chat_id: chatId, photo: mediaInfo.replace('photo:', ''), caption: caption, parse_mode: 'HTML', reply_markup: replyMarkup });
                    }
                } else {
                    await tgAPI('sendMessage', { chat_id: chatId, text: caption, parse_mode: 'HTML', reply_markup: replyMarkup });
                }
            }
            
            // 🟢 ADMIN PANEL OPEN COMMAND
            else if (isAdmin && text === '/admin') {
                const adminMenu = `👑 <b>𝗔𝗗𝗠𝗜𝗡 𝗖𝗢𝗡𝗧𝗥𝗢𝗟 𝗣𝗔𝗡𝗘𝗟</b> 👑\n━━━━━━━━━━━━━━━━━━━━\nWelcome Master! Fully customize your bot's welcome screen below.\n\n👇 <b>Select an option to edit:</b>`;
                await tgAPI('sendMessage', {
                    chat_id: chatId, text: adminMenu, parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "📝 Edit Welcome Text", callback_data: "edit_text" }],
                            [{ text: "📸/🎥 Edit Image/Video", callback_data: "edit_media" }],
                            [{ text: "🔘 Edit Button Name", callback_data: "edit_btn" }],
                            [{ text: "🗑 Remove Media", callback_data: "remove_media" }, { text: "👁 Preview", callback_data: "preview" }]
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
