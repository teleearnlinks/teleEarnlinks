const { createClient } = require('@supabase/supabase-js');

export default async function handler(req, res) {
    if (req.method === 'GET') return res.status(200).send('Premium Converter Bot Active!');

    try {
        const BOT_TOKEN = process.env.CONVERTER_BOT_TOKEN; 
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
        const APP_SHORT_NAME = 'httpsteleearnlinksvercelapp'; 
        const MAIN_BOT_USERNAME = 'teleEarnLinkbot'; 

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

        const getMenu = (user) => {
            return {
                inline_keyboard: [
                    [{ text: "🔝 Set Header", callback_data: "set_header" }, { text: "🔚 Set Footer", callback_data: "set_footer" }],
                    [{ text: `📝 Keep Original Text: ${user.keep_text ? "ON ✅" : "OFF ❌"}`, callback_data: "toggle_text" }],
                    [{ text: `🔠 Bold Header/Footer: ${user.bold_text ? "ON ✅" : "OFF ❌"}`, callback_data: "toggle_bold" }],
                    [{ text: "❓ How to Convert", callback_data: "help_convert" }, { text: "🗑 Clear Settings", callback_data: "clear_settings" }]
                ]
            };
        };

        const getOrCreateUser = async (chatId, msg) => {
            let { data: user } = await supabase.from('users').select('*').eq('telegram_id', chatId).maybeSingle();
            if (!user) {
                const { data: newUser } = await supabase.from('users').insert([{ telegram_id: chatId, first_name: msg?.chat?.first_name || 'User', username: msg?.chat?.username || '' }]).select().maybeSingle();
                user = newUser;
            }
            return user;
        };

        // ==========================================
        // 1️⃣ INTERACTIVE DASHBOARD (BUTTON CLICKS)
        // ==========================================
        if (update.callback_query) {
            const query = update.callback_query;
            const chatId = query.message.chat.id;
            const msgId = query.message.message_id;
            const data = query.data;

            await tgAPI('answerCallbackQuery', { callback_query_id: query.id });
            let user = await getOrCreateUser(chatId, query.message);

            const setState = async (stateVal, msgText) => {
                const { error } = await supabase.from('users').update({ current_action: stateVal }).eq('id', user.id);
                if (error) {
                    await tgAPI('sendMessage', { chat_id: chatId, text: `⚠️ <b>Database Error:</b> Column 'current_action' missing!`, parse_mode: 'HTML' });
                } else {
                    await tgAPI('sendMessage', { chat_id: chatId, text: msgText, parse_mode: 'HTML' });
                }
            };

            if (data === 'set_header') {
                await setState('set_header', `🔝 <b>Header Setup</b>\n\nJust send your new Header text normally below.\n<i>(Send /cancel to abort)</i>`);
            } 
            else if (data === 'set_footer') {
                await setState('set_footer', `🔚 <b>Footer Setup</b>\n\nJust send your new Footer text normally below.\n<i>(Send /cancel to abort)</i>`);
            } 
            else if (data === 'toggle_text') {
                const newState = !user.keep_text;
                await supabase.from('users').update({ keep_text: newState, current_action: '' }).eq('id', user.id);
                user.keep_text = newState;
                await tgAPI('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: getMenu(user) });
            } 
            else if (data === 'toggle_bold') {
                const newState = !user.bold_text;
                await supabase.from('users').update({ bold_text: newState, current_action: '' }).eq('id', user.id);
                user.bold_text = newState;
                await tgAPI('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: getMenu(user) });
            } 
            else if (data === 'clear_settings') {
                await supabase.from('users').update({ converter_header: '', converter_footer: '', keep_text: false, bold_text: false, current_action: '' }).eq('id', user.id);
                user = { ...user, converter_header: '', converter_footer: '', keep_text: false, bold_text: false, current_action: '' };
                await tgAPI('editMessageText', { chat_id: chatId, message_id: msgId, text: `✅ <b>Settings Cleared!</b>\n\nConfigure your converter below:`, parse_mode: 'HTML', reply_markup: getMenu(user) });
            }
            else if (data === 'help_convert') {
                await supabase.from('users').update({ current_action: '' }).eq('id', user.id);
                await tgAPI('sendMessage', { chat_id: chatId, text: `💡 <b>How to Convert Links?</b>\n\nJust <b>Forward</b> or <b>Send</b> me any post containing external links. I will instantly extract them, convert them into your Monetized links, and send the post back to you! 🚀`, parse_mode: 'HTML' });
            }
            return res.status(200).send('OK');
        }

        // ==========================================
        // 2️⃣ MESSAGES & LINK CONVERTER ENGINE
        // ==========================================
        if (update && update.message) {
            const msg = update.message;
            const chatId = msg.chat.id;
            let text = msg.text || msg.caption || '';
            let user = await getOrCreateUser(chatId, msg);

            // 🟢 EMERGENCY ESCAPE / COMMANDS
            if (text === '/start' || text === '/help' || text === '/cancel') {
                // RESET STATE INSTANTLY
                await supabase.from('users').update({ current_action: '' }).eq('id', user.id);
                user.current_action = '';

                if (text === '/cancel') {
                    await tgAPI('sendMessage', { chat_id: chatId, text: "❌ <b>Action Cancelled!</b>", parse_mode: 'HTML', reply_markup: getMenu(user) });
                    return res.status(200).send('OK');
                }
                
                const welcomeText = `⚙️ <b>teleEarn Link Converter</b>\n━━━━━━━━━━━━━━━━━━━━\nSend me any post with external links, and I will magically replace them with your Monetized Links! ✨\n\n👇 <b>Customize your post format below:</b>`;
                await tgAPI('sendMessage', { chat_id: chatId, text: welcomeText, parse_mode: 'HTML', reply_markup: getMenu(user) });
                return res.status(200).send('OK');
            }

            // 🟢 ZERO-LAG STATE HANDLER (Handling Header/Footer Input)
            if (user.current_action === 'set_header' || user.current_action === 'set_footer') {
                try {
                    let actionMsg = "";
                    if (user.current_action === 'set_header') {
                        // 1. MUST RESET ACTION FIRST TO PREVENT STICKING
                        await supabase.from('users').update({ converter_header: text, current_action: '' }).eq('id', user.id);
                        user.converter_header = text;
                        actionMsg = "✅ <b>Header Saved Successfully!</b>";
                    } else if (user.current_action === 'set_footer') {
                        // 1. MUST RESET ACTION FIRST TO PREVENT STICKING
                        await supabase.from('users').update({ converter_footer: text, current_action: '' }).eq('id', user.id);
                        user.converter_footer = text;
                        actionMsg = "✅ <b>Footer Saved Successfully!</b>";
                    }
                    // Then Send Reply
                    await tgAPI('sendMessage', { chat_id: chatId, text: actionMsg, parse_mode: 'HTML', reply_markup: getMenu(user) });
                } catch (err) {
                    await supabase.from('users').update({ current_action: '' }).eq('id', user.id);
                    await tgAPI('sendMessage', { chat_id: chatId, text: `❌ DB Error: ${err.message}` });
                }
                return res.status(200).send('OK');
            }

            // ⚡ FAST LINK CONVERTER ENGINE (Runs only when state is clear)
            if (!user.current_action && !text.startsWith('/')) {
                const urlRegex = /(https?:\/\/[^\s]+)/g;
                const extractedUrls = text.match(urlRegex);

                if (extractedUrls && extractedUrls.length > 0) {
                    const validUrls = extractedUrls.filter(url => !url.includes('t.me') && !url.includes('telegram.me') && !url.includes('telegram.dog'));

                    if (validUrls.length > 0) {
                        const actionType = msg.photo ? 'upload_photo' : (msg.video ? 'upload_video' : 'typing');
                        await tgAPI('sendChatAction', { chat_id: chatId, action: actionType });

                        const linksToInsert = validUrls.map(url => ({
                            original_url: url,
                            short_id: Math.random().toString(36).substring(2, 8),
                            user_id: user.id
                        }));
                        await supabase.from('links').insert(linksToInsert);

                        let convertedLinksText = '';
                        linksToInsert.forEach(link => {
                            convertedLinksText += `🔗 https://t.me/${MAIN_BOT_USERNAME}/${APP_SHORT_NAME}?startapp=link_${link.short_id}\n\n`;
                        });

                        let head = user.converter_header ? `${user.converter_header}\n\n` : ``;
                        let foot = user.converter_footer ? `\n${user.converter_footer}` : ``;
                        if (user.bold_text) {
                            if (head) head = `<b>${head.trim()}</b>\n\n`;
                            if (foot) foot = `\n<b>${foot.trim()}</b>`;
                        }

                        let finalCaption = '';
                        if (user.keep_text) {
                            let safeOriginalText = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
                            validUrls.forEach((oldUrl, index) => {
                                const newUrl = `https://t.me/${MAIN_BOT_USERNAME}/${APP_SHORT_NAME}?startapp=link_${linksToInsert[index].short_id}`;
                                safeOriginalText = safeOriginalText.replace(oldUrl, newUrl);
                            });
                            finalCaption = `${head}${safeOriginalText}\n${foot}`;
                        } else {
                            finalCaption = `${head}${convertedLinksText.trim()}\n${foot}`;
                        }

                        let tgRes;
                        if (msg.photo) tgRes = await tgAPI('sendPhoto', { chat_id: chatId, photo: msg.photo[msg.photo.length - 1].file_id, caption: finalCaption, parse_mode: 'HTML' });
                        else if (msg.video) tgRes = await tgAPI('sendVideo', { chat_id: chatId, video: msg.video.file_id, caption: finalCaption, parse_mode: 'HTML' });
                        else if (msg.animation) tgRes = await tgAPI('sendAnimation', { chat_id: chatId, animation: msg.animation.file_id, caption: finalCaption, parse_mode: 'HTML' });
                        else tgRes = await tgAPI('sendMessage', { chat_id: chatId, text: finalCaption, parse_mode: 'HTML', disable_web_page_preview: true });

                        if (!tgRes.ok) {
                            await tgAPI('sendMessage', { chat_id: chatId, text: `❌ <b>Formatting Error</b>\nTelegram rejected the message! Please ensure your Header/Footer doesn't have broken HTML tags.\n<i>Detail: ${tgRes.description}</i>`, parse_mode: 'HTML' });
                        }
                    }
                }
            }
        }
        res.status(200).send('OK');
    } catch (error) { 
        console.error('CONVERTER ERROR:', error);
        res.status(200).send('Error'); 
    }
}
