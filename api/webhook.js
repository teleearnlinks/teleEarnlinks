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
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
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
                const msg = `📝 <b>Welcome Text Setup</b>\n\n📌 <b>Reply to this exact message (Swipe Left)</b> with your new welcome text.\n<i>(HTML tags like &lt;b&gt;bold&lt;/b&gt; are supported!)</i>`;
                await tgAPI('sendMessage', { chat_id: chatId, text: msg, parse_mode: 'HTML', reply_markup: { force_reply: true } });
            } 
            else if (data === 'edit_media') {
                const msg = `📸 <b>Media Setup</b>\n\n📌 <b>Reply to this exact message (Swipe Left)</b> with a Photo or a Video.`;
                await tgAPI('sendMessage', { chat_id: chatId, text: msg, parse_mode: 'HTML', reply_markup: { force_reply: true } });
            } 
            else if (data === 'edit_btn') {
                const msg = `🔘 <b>Button Name Setup</b>\n\n📌 <b>Reply to this exact message (Swipe Left)</b> with your new Button Text.`;
                await tgAPI('sendMessage', { chat_id: chatId, text: msg, parse_mode: 'HTML', reply_markup: { force_reply: true } });
            } 
            else if (data === 'remove_media') {
                if (settingsId) {
                    const { error } = await supabase.from('settings').update({ welcome_image: null }).eq('id', settingsId);
                    if (error) return await tgAPI('sendMessage', { chat_id: chatId, text: `❌ DB Error: ${error.message}` });
                }
                await tgAPI('editMessageText', { chat_id: chatId, message_id: query.message.message_id, text: "✅ <b>Media removed successfully!</b>", parse_mode: 'HTML', reply_markup: backBtn });
            } 
            else if (data === 'preview') {
                let caption = currentSettings?.welcome_text || `🌟 <b>Welcome to teleEarn!</b> 🌟\n\nClick below to open your Dashboard!`;
                let mediaInfo = currentSettings?.welcome_image || '';
                let buttonText = currentSettings?.button_text || "🚀 Open teleEarn Dashboard 🚀";

                const finalUrl = 'https://t.me/teleEarnLinkbot/httpsteleearnlinksvercelapp';
                // (Telegram Crash Fix: Removed invalid style attributes from URL button)
                const replyMarkup = { inline_keyboard: [[{ text: buttonText, url: finalUrl }]] };

                let tgRes;
                if (mediaInfo) {
                    if (mediaInfo.startsWith('video:')) {
                        tgRes = await tgAPI('sendVideo', { chat_id: chatId, video: mediaInfo.replace('video:', ''), caption: caption, parse_mode: 'HTML', reply_markup: replyMarkup });
                    } else {
                        tgRes = await tgAPI('sendPhoto', { chat_id: chatId, photo: mediaInfo.replace('photo:', ''), caption: caption, parse_mode: 'HTML', reply_markup: replyMarkup });
                    }
                } else {
                    tgRes = await tgAPI('sendMessage', { chat_id: chatId, text: caption, parse_mode: 'HTML', reply_markup: replyMarkup });
                }
                
                // Alert Admin if Telegram rejects the preview
                if(!tgRes.ok) {
                    await tgAPI('sendMessage', { chat_id: chatId, text: `❌ <b>Telegram API Error:</b> ${tgRes.description}`, parse_mode: 'HTML' });
                }
            }
            return res.status(200).send('OK');
        }

        // ==========================================
        // 2️⃣ MESSAGES & ADMIN REPLIES
        // ==========================================
        if (update && update.message) {
            const msg = update.message;
            const chatId = msg.chat.id;
            const text = msg.text || '';
            const isAdmin = (chatId === ADMIN_ID);

            const backBtn = { inline_keyboard: [[{ text: "⬅️ Back to Admin", callback_data: "admin_home" }]] };

            // 🟢 ADMIN REPLIES (Data Save)
            if (isAdmin && msg.reply_to_message) {
                const replyText = msg.reply_to_message.text || '';
                
                // Helper to save to DB with strict error checking
                const saveToDB = async (updateObj) => {
                    if (settingsId) {
                        const { error } = await supabase.from('settings').update(updateObj).eq('id', settingsId);
                        if (error) throw error;
                    } else {
                        // Creating default row if it doesn't exist
                        const { error } = await supabase.from('settings').insert([{ ...updateObj, cpm: 2, ads_per_link: 1, ad_timer: 5, min_withdraw: 5 }]);
                        if (error) throw error;
                    }
                };

                try {
                    if (replyText.includes("Welcome Text Setup")) {
                        await saveToDB({ welcome_text: text });
                        await tgAPI('sendMessage', { chat_id: chatId, text: "✅ <b>Text Updated successfully!</b>", parse_mode: 'HTML', reply_markup: backBtn });
                    } 
                    else if (replyText.includes("Media Setup")) {
                        let mediaToSave = '';
                        if (msg.photo && msg.photo.length > 0) mediaToSave = 'photo:' + msg.photo[msg.photo.length - 1].file_id;
                        else if (msg.video) mediaToSave = 'video:' + msg.video.file_id;
                        else if (msg.animation) mediaToSave = 'video:' + msg.animation.file_id;

                        if (mediaToSave) {
                            await saveToDB({ welcome_image: mediaToSave });
                            await tgAPI('sendMessage', { chat_id: chatId, text: "✅ <b>Media Updated successfully!</b>", parse_mode: 'HTML', reply_markup: backBtn });
                        } else {
                            await tgAPI('sendMessage', { chat_id: chatId, text: "❌ <b>Invalid media.</b> Please reply with an actual Photo or Video from your gallery.", parse_mode: 'HTML', reply_markup: backBtn });
                        }
                    }
                    else if (replyText.includes("Button Name Setup")) {
                        await saveToDB({ button_text: text });
                        await tgAPI('sendMessage', { chat_id: chatId, text: "✅ <b>Button Name Updated successfully!</b>", parse_mode: 'HTML', reply_markup: backBtn });
                    }
                } catch (dbError) {
                    await tgAPI('sendMessage', { chat_id: chatId, text: `❌ <b>Database Error:</b> ${dbError.message}`, parse_mode: 'HTML', reply_markup: backBtn });
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
                    if (mediaInfo.startsWith('video:')) {
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
                const adminMenu = `🎛 <b>teleEarn Admin Control Center</b>\n\nConfigure your bot's Welcome Screen easily. Select an option below:`;
                await tgAPI('sendMessage', { chat_id: chatId, text: adminMenu, parse_mode: 'HTML', reply_markup: mainAdminMenu });
            }
        }
        res.status(200).send('OK');
    } catch (error) {
        console.error(error);
        res.status(200).send('Error');
    }
}
