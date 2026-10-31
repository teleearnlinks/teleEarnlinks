const { createClient } = require('@supabase/supabase-js');

export default async function handler(req, res) {
    if (req.method === 'GET') return res.status(200).send('Converter Webhook Active!');

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
                [{ text: "📝 Edit Welcome Text", callback_data: "edit_text" }, { text: "📸 Edit Welcome Media", callback_data: "edit_media" }],
                [{ text: "🔘 Edit Button Name", callback_data: "edit_btn" }, { text: "🎨 Edit Button Color", callback_data: "edit_color" }],
                [{ text: "🔝 Set Converter Header", callback_data: "edit_header" }, { text: "🔚 Set Converter Footer", callback_data: "edit_footer" }],
                [{ text: "👁 Preview Welcome", callback_data: "preview" }, { text: "🗑 Remove Media", callback_data: "remove_media" }]
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
                 const menu = `🎛 <b>teleEarn Master Admin Panel</b>\n\nConfigure Welcome Screen & Link Converter:`;
                 await tgAPI('editMessageText', { chat_id: chatId, message_id: query.message.message_id, text: menu, parse_mode: 'HTML', reply_markup: mainAdminMenu });
            } 
            else if (data === 'edit_text') {
                await tgAPI('sendMessage', { chat_id: chatId, text: `📝 <b>Welcome Text Setup</b>\n📌 <b>Reply (Swipe Left)</b> with your new welcome text.`, parse_mode: 'HTML', reply_markup: { force_reply: true } });
            } 
            else if (data === 'edit_media') {
                await tgAPI('sendMessage', { chat_id: chatId, text: `📸 <b>Media Setup</b>\n📌 <b>Reply (Swipe Left)</b> with a Photo or Video.`, parse_mode: 'HTML', reply_markup: { force_reply: true } });
            } 
            else if (data === 'edit_btn') {
                await tgAPI('sendMessage', { chat_id: chatId, text: `🔘 <b>Button Setup</b>\n📌 <b>Reply (Swipe Left)</b> with your new Button Text.`, parse_mode: 'HTML', reply_markup: { force_reply: true } });
            } 
            else if (data === 'edit_header') {
                await tgAPI('sendMessage', { chat_id: chatId, text: `🔝 <b>Converter Header Setup</b>\n📌 <b>Reply (Swipe Left)</b> with the Header text for converted posts.`, parse_mode: 'HTML', reply_markup: { force_reply: true } });
            } 
            else if (data === 'edit_footer') {
                await tgAPI('sendMessage', { chat_id: chatId, text: `🔚 <b>Converter Footer Setup</b>\n📌 <b>Reply (Swipe Left)</b> with the Footer text for converted posts.`, parse_mode: 'HTML', reply_markup: { force_reply: true } });
            }
            else if (data === 'edit_color') {
                const colorMenu = { inline_keyboard: [[{ text: "🟦 Blue", callback_data: "set_color_primary" }, { text: "🟩 Green", callback_data: "set_color_success" }, { text: "🟥 Red", callback_data: "set_color_danger" }], [{ text: "⬅️ Back", callback_data: "admin_home" }]] };
                await tgAPI('editMessageText', { chat_id: chatId, message_id: query.message.message_id, text: `🎨 <b>Select Button Color:</b>`, parse_mode: 'HTML', reply_markup: colorMenu });
            }
            else if (data.startsWith('set_color_')) {
                const newColor = data.replace('set_color_', '');
                if (settingsId) await supabase.from('settings').update({ button_color: newColor }).eq('id', settingsId);
                await tgAPI('editMessageText', { chat_id: chatId, message_id: query.message.message_id, text: `✅ Button color set to ${newColor.toUpperCase()}!`, reply_markup: backBtn });
            }
            else if (data === 'remove_media') {
                if (settingsId) await supabase.from('settings').update({ welcome_image: null }).eq('id', settingsId);
                await tgAPI('editMessageText', { chat_id: chatId, message_id: query.message.message_id, text: "✅ Media removed!", parse_mode: 'HTML', reply_markup: backBtn });
            } 
            else if (data === 'preview') {
                let caption = currentSettings?.welcome_text || `🌟 Welcome!`;
                let mediaInfo = currentSettings?.welcome_image || '';
                let buttonText = currentSettings?.button_text || "🚀 Open Dashboard";
                let buttonColor = currentSettings?.button_color || "primary";

                const replyMarkup = { inline_keyboard: [[{ text: buttonText, url: 'https://t.me/teleEarnLinkbot/httpsteleearnlinksvercelapp', style: buttonColor }]] };
                if (mediaInfo.startsWith('video:')) await tgAPI('sendVideo', { chat_id: chatId, video: mediaInfo.replace('video:', ''), caption: caption, parse_mode: 'HTML', reply_markup: replyMarkup });
                else if (mediaInfo.startsWith('photo:')) await tgAPI('sendPhoto', { chat_id: chatId, photo: mediaInfo.replace('photo:', ''), caption: caption, parse_mode: 'HTML', reply_markup: replyMarkup });
                else await tgAPI('sendMessage', { chat_id: chatId, text: caption, parse_mode: 'HTML', reply_markup: replyMarkup });
            }
            return res.status(200).send('OK');
        }

        // ==========================================
        // 2️⃣ MESSAGES & LINK CONVERTER ENGINE
        // ==========================================
        if (update && update.message) {
            const msg = update.message;
            const chatId = msg.chat.id;
            const text = msg.text || msg.caption || ''; // Reads both normal text & media captions
            const isAdmin = (chatId === ADMIN_ID);
            const backBtn = { inline_keyboard: [[{ text: "⬅️ Back to Admin", callback_data: "admin_home" }]] };

            const saveToDB = async (updateObj) => {
                if (settingsId) await supabase.from('settings').update(updateObj).eq('id', settingsId);
                else await supabase.from('settings').insert([{ ...updateObj, cpm: 2 }]);
            };

            // 🟢 ADMIN REPLIES
            if (isAdmin && msg.reply_to_message) {
                const replyText = msg.reply_to_message.text || '';
                try {
                    if (replyText.includes("Welcome Text Setup")) { await saveToDB({ welcome_text: text }); await tgAPI('sendMessage', { chat_id: chatId, text: "✅ Text Updated!", reply_markup: backBtn }); } 
                    else if (replyText.includes("Converter Header Setup")) { await saveToDB({ converter_header: text }); await tgAPI('sendMessage', { chat_id: chatId, text: "✅ Header Updated!", reply_markup: backBtn }); } 
                    else if (replyText.includes("Converter Footer Setup")) { await saveToDB({ converter_footer: text }); await tgAPI('sendMessage', { chat_id: chatId, text: "✅ Footer Updated!", reply_markup: backBtn }); } 
                    else if (replyText.includes("Media Setup")) {
                        let mediaToSave = '';
                        if (msg.photo) mediaToSave = 'photo:' + msg.photo[msg.photo.length - 1].file_id;
                        else if (msg.video) mediaToSave = 'video:' + msg.video.file_id;
                        if (mediaToSave) { await saveToDB({ welcome_image: mediaToSave }); await tgAPI('sendMessage', { chat_id: chatId, text: "✅ Media Updated!", reply_markup: backBtn }); }
                    }
                    else if (replyText.includes("Button Setup")) { await saveToDB({ button_text: text }); await tgAPI('sendMessage', { chat_id: chatId, text: "✅ Button Updated!", reply_markup: backBtn }); }
                } catch (e) { await tgAPI('sendMessage', { chat_id: chatId, text: `❌ DB Error: ${e.message}` }); }
                return res.status(200).send('OK');
            }

            // 🟢 COMMANDS
            if (text.startsWith('/start')) {
                // (Normal /start logic... we don't convert /start)
                const param = text.split(' ')[1] || '';
                let finalUrl = 'https://t.me/teleEarnLinkbot/httpsteleearnlinksvercelapp';
                if (param) finalUrl += `?startapp=${param}`;
                let caption = currentSettings?.welcome_text || `🌟 Welcome to teleEarn!`;
                let mediaInfo = currentSettings?.welcome_image || '';
                let buttonText = currentSettings?.button_text || "🚀 Open Dashboard";
                let buttonColor = currentSettings?.button_color || "primary";
                const replyMarkup = { inline_keyboard: [[{ text: buttonText, url: finalUrl, style: buttonColor }]] };

                if (mediaInfo.startsWith('video:')) await tgAPI('sendVideo', { chat_id: chatId, video: mediaInfo.replace('video:', ''), caption: caption, parse_mode: 'HTML', reply_markup: replyMarkup });
                else if (mediaInfo.startsWith('photo:')) await tgAPI('sendPhoto', { chat_id: chatId, photo: mediaInfo.replace('photo:', ''), caption: caption, parse_mode: 'HTML', reply_markup: replyMarkup });
                else await tgAPI('sendMessage', { chat_id: chatId, text: caption, parse_mode: 'HTML', reply_markup: replyMarkup });
                return res.status(200).send('OK');
            }
            if (isAdmin && text === '/admin') {
                const adminMenu = `🎛 <b>teleEarn Master Admin Panel</b>\n\nConfigure Welcome Screen & Link Converter:`;
                await tgAPI('sendMessage', { chat_id: chatId, text: adminMenu, parse_mode: 'HTML', reply_markup: mainAdminMenu });
                return res.status(200).send('OK');
            }

            // ==========================================
            // 🔗 AUTO-LINK CONVERTER ENGINE
            // ==========================================
            // Find all URLs in the message text using Regex
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            const extractedUrls = text.match(urlRegex);

            if (extractedUrls && extractedUrls.length > 0) {
                
                // Filter out Telegram Links (ignore them)
                const validUrls = extractedUrls.filter(url => !url.includes('t.me') && !url.includes('telegram.me') && !url.includes('telegram.dog'));

                if (validUrls.length > 0) {
                    
                    // 1. Get User ID from Supabase (Create if doesn't exist)
                    let { data: userData } = await supabase.from('users').select('id').eq('telegram_id', chatId).single();
                    if (!userData) {
                        const { data: newUser } = await supabase.from('users').insert([{ telegram_id: chatId, first_name: msg.chat.first_name, username: msg.chat.username }]).select().single();
                        userData = newUser;
                    }

                    // 2. Generate short links for all valid URLs
                    let convertedLinksText = '';
                    for (const url of validUrls) {
                        const shortId = Math.random().toString(36).substring(2, 8);
                        await supabase.from('links').insert([{ original_url: url, short_id: shortId, user_id: userData.id }]);
                        const teleEarnUrl = `https://t.me/teleEarnLinkbot/httpsteleearnlinksvercelapp?startapp=link_${shortId}`;
                        convertedLinksText += `🔗 ${teleEarnUrl}\n`;
                    }

                    // 3. Build Final Caption (Header + Links + Footer)
                    const header = currentSettings?.converter_header ? `${currentSettings.converter_header}\n\n` : `🔥 <b>New Exclusive Content!</b> 🔥\n\n`;
                    const footer = currentSettings?.converter_footer ? `\n\n${currentSettings.converter_footer}` : `\n\n<i>Powered by teleEarn</i>`;
                    
                    const finalCaption = `${header}${convertedLinksText}${footer}`;

                    // 4. Send Back the same Media with New Caption
                    if (msg.photo) {
                        const fileId = msg.photo[msg.photo.length - 1].file_id;
                        await tgAPI('sendPhoto', { chat_id: chatId, photo: fileId, caption: finalCaption, parse_mode: 'HTML' });
                    } 
                    else if (msg.video) {
                        await tgAPI('sendVideo', { chat_id: chatId, video: msg.video.file_id, caption: finalCaption, parse_mode: 'HTML' });
                    } 
                    else if (msg.animation) {
                        await tgAPI('sendAnimation', { chat_id: chatId, animation: msg.animation.file_id, caption: finalCaption, parse_mode: 'HTML' });
                    } 
                    else if (msg.document) {
                        await tgAPI('sendDocument', { chat_id: chatId, document: msg.document.file_id, caption: finalCaption, parse_mode: 'HTML' });
                    }
                    else {
                        // It was just a text message
                        await tgAPI('sendMessage', { chat_id: chatId, text: finalCaption, parse_mode: 'HTML', disable_web_page_preview: true });
                    }
                }
            }
        }
        res.status(200).send('OK');
    } catch (error) {
        console.error(error);
        res.status(200).send('Error');
    }
}
