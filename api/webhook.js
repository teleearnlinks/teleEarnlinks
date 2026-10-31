const { createClient } = require('@supabase/supabase-js');

export default async function handler(req, res) {
    if (req.method === 'GET') return res.status(200).send('Public Converter Webhook Active!');

    try {
        const BOT_TOKEN = process.env.BOT_TOKEN;
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
        const ADMIN_ID = parseInt(process.env.ADMIN_ID); 
        
        // ⚠️ Agar aapne BotFather me short name 'app' kar liya hai, toh isko 'app' kar dena.
        const APP_SHORT_NAME = 'httpsteleearnlinksvercelapp'; 

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
                 await tgAPI('editMessageText', { chat_id: chatId, message_id: query.message.message_id, text: `🎛 <b>teleEarn Master Admin Panel</b>\n\nConfigure Welcome Screen & Link Converter:`, parse_mode: 'HTML', reply_markup: mainAdminMenu });
            } 
            else if (data === 'edit_text') await tgAPI('sendMessage', { chat_id: chatId, text: `📝 <b>Welcome Text Setup</b>\n📌 <b>Reply (Swipe Left)</b> with your new welcome text.`, parse_mode: 'HTML', reply_markup: { force_reply: true } });
            else if (data === 'edit_media') await tgAPI('sendMessage', { chat_id: chatId, text: `📸 <b>Media Setup</b>\n📌 <b>Reply (Swipe Left)</b> with a Photo or Video.`, parse_mode: 'HTML', reply_markup: { force_reply: true } });
            else if (data === 'edit_btn') await tgAPI('sendMessage', { chat_id: chatId, text: `🔘 <b>Button Setup</b>\n📌 <b>Reply (Swipe Left)</b> with your new Button Text.`, parse_mode: 'HTML', reply_markup: { force_reply: true } });
            else if (data === 'edit_header') await tgAPI('sendMessage', { chat_id: chatId, text: `🔝 <b>Converter Header Setup</b>\n📌 <b>Reply (Swipe Left)</b> with the Header text.`, parse_mode: 'HTML', reply_markup: { force_reply: true } });
            else if (data === 'edit_footer') await tgAPI('sendMessage', { chat_id: chatId, text: `🔚 <b>Converter Footer Setup</b>\n📌 <b>Reply (Swipe Left)</b> with the Footer text.`, parse_mode: 'HTML', reply_markup: { force_reply: true } });
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
                const replyMarkup = { inline_keyboard: [[{ text: currentSettings?.button_text || "🚀 Open Dashboard", url: `https://t.me/teleEarnLinkbot/${APP_SHORT_NAME}`, style: currentSettings?.button_color || "primary" }]] };
                
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
            const text = msg.text || msg.caption || ''; 
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
                const param = text.split(' ')[1] || '';
                let finalUrl = `https://t.me/teleEarnLinkbot/${APP_SHORT_NAME}`;
                if (param) finalUrl += `?startapp=${param}`;
                
                let caption = currentSettings?.welcome_text || `🌟 <b>Welcome to teleEarn!</b> 🌟\n\nClick below to open your Dashboard!`;
                let mediaInfo = currentSettings?.welcome_image || '';
                const replyMarkup = { inline_keyboard: [[{ text: currentSettings?.button_text || "🚀 Open Dashboard", url: finalUrl, style: currentSettings?.button_color || "primary" }]] };

                if (mediaInfo.startsWith('video:')) await tgAPI('sendVideo', { chat_id: chatId, video: mediaInfo.replace('video:', ''), caption: caption, parse_mode: 'HTML', reply_markup: replyMarkup });
                else if (mediaInfo.startsWith('photo:')) await tgAPI('sendPhoto', { chat_id: chatId, photo: mediaInfo.replace('photo:', ''), caption: caption, parse_mode: 'HTML', reply_markup: replyMarkup });
                else await tgAPI('sendMessage', { chat_id: chatId, text: caption, parse_mode: 'HTML', reply_markup: replyMarkup });
                return res.status(200).send('OK');
            }
            
            // 🟢 HELP COMMAND (Premium Feature)
            if (text.startsWith('/help')) {
                const helpMsg = `🤖 <b>teleEarn - Ultimate Help Guide</b>\n━━━━━━━━━━━━━━━━━━━━\n\n🔗 <b>1. Link Converter (Auto-Magic)</b>\nJust forward any post or message containing links (like TeraBox, Drive) directly to this bot. I will instantly replace them with your Monetized Links and send the post back to you!\n\n💸 <b>2. Refer & Earn</b>\nInvite your friends and earn a lifetime commission from their earnings.\n\n⚡ <b>3. Fast Withdrawals</b>\nWithdraw your earnings instantly to your preferred wallet directly from the Mini App.\n\n👇 <i>Click the button below to get started!</i>`;
                const replyMarkup = { inline_keyboard: [[{ text: currentSettings?.button_text || "🚀 Open Dashboard", url: `https://t.me/teleEarnLinkbot/${APP_SHORT_NAME}`, style: currentSettings?.button_color || "primary" }]] };
                await tgAPI('sendMessage', { chat_id: chatId, text: helpMsg, parse_mode: 'HTML', reply_markup: replyMarkup });
                return res.status(200).send('OK');
            }

            if (isAdmin && text === '/admin') {
                await tgAPI('sendMessage', { chat_id: chatId, text: `🎛 <b>teleEarn Master Admin Panel</b>\n\nConfigure Welcome Screen & Link Converter:`, parse_mode: 'HTML', reply_markup: mainAdminMenu });
                return res.status(200).send('OK');
            }

            // ==========================================
            // 🔗 AUTO-LINK CONVERTER ENGINE (PUBLIC & FAST)
            // ==========================================
            if (!text.startsWith('/')) { // Ignore commands
                const urlRegex = /(https?:\/\/[^\s]+)/g;
                const extractedUrls = text.match(urlRegex);

                if (extractedUrls && extractedUrls.length > 0) {
                    const validUrls = extractedUrls.filter(url => !url.includes('t.me') && !url.includes('telegram.me') && !url.includes('telegram.dog'));

                    if (validUrls.length > 0) {
                        // Premium Action: Show Typing/Uploading
                        const actionType = msg.photo ? 'upload_photo' : (msg.video ? 'upload_video' : 'typing');
                        await tgAPI('sendChatAction', { chat_id: chatId, action: actionType });

                        // 1. User DB Check
                        let { data: userData } = await supabase.from('users').select('id').eq('telegram_id', chatId).single();
                        if (!userData) {
                            const { data: newUser } = await supabase.from('users').insert([{ telegram_id: chatId, first_name: msg.chat.first_name, username: msg.chat.username }]).select().single();
                            userData = newUser;
                        }

                        // 2. ⚡ LIGHTNING FAST BATCH INSERT
                        const linksToInsert = validUrls.map(url => ({
                            original_url: url,
                            short_id: Math.random().toString(36).substring(2, 8),
                            user_id: userData.id
                        }));
                        await supabase.from('links').insert(linksToInsert);

                        // 3. 📏 BUILD SPACED TEXT (Gap between links)
                        let convertedLinksText = '';
                        linksToInsert.forEach(link => {
                            const teleEarnUrl = `https://t.me/teleEarnLinkbot/${APP_SHORT_NAME}?startapp=link_${link.short_id}`;
                            convertedLinksText += `🔗 ${teleEarnUrl}\n\n`; // Double newline for proper GAP
                        });

                        // 4. Header + Links + Footer
                        const header = currentSettings?.converter_header ? `${currentSettings.converter_header}\n\n` : ``;
                        const footer = currentSettings?.converter_footer ? `\n${currentSettings.converter_footer}` : ``;
                        const finalCaption = `${header}${convertedLinksText}${footer}`;

                        // 5. Send Back Format
                        if (msg.photo) {
                            await tgAPI('sendPhoto', { chat_id: chatId, photo: msg.photo[msg.photo.length - 1].file_id, caption: finalCaption, parse_mode: 'HTML' });
                        } else if (msg.video) {
                            await tgAPI('sendVideo', { chat_id: chatId, video: msg.video.file_id, caption: finalCaption, parse_mode: 'HTML' });
                        } else if (msg.animation) {
                            await tgAPI('sendAnimation', { chat_id: chatId, animation: msg.animation.file_id, caption: finalCaption, parse_mode: 'HTML' });
                        } else {
                            await tgAPI('sendMessage', { chat_id: chatId, text: finalCaption, parse_mode: 'HTML', disable_web_page_preview: true });
                        }
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
