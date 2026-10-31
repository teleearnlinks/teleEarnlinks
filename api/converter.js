const { createClient } = require('@supabase/supabase-js');

export default async function handler(req, res) {
    if (req.method === 'GET') return res.status(200).send('Converter Bot Active!');

    try {
        // Naye Bot ka Token Vercel ENV se aayega
        const BOT_TOKEN = process.env.CONVERTER_BOT_TOKEN; 
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
        const APP_SHORT_NAME = 'app'; // Mini App ka short name

        if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_KEY) return res.status(200).send('Env missing');

        const update = req.body;
        const cleanUrl = SUPABASE_URL.trim().replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
        const supabase = createClient(cleanUrl, SUPABASE_KEY.trim());

        const tgAPI = async (method, body) => {
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        };

        if (update && update.message) {
            const msg = update.message;
            const chatId = msg.chat.id;
            let text = msg.text || msg.caption || '';

            // 1. Get or Create User in DB to load their custom settings
            let { data: user } = await supabase.from('users').select('*').eq('telegram_id', chatId).single();
            if (!user) {
                const { data: newUser } = await supabase.from('users').insert([{ telegram_id: chatId, first_name: msg.chat.first_name, username: msg.chat.username }]).select().single();
                user = newUser;
            }

            // 2. DISKWALA STYLE COMMANDS
            if (text.startsWith('/start') || text.startsWith('/help')) {
                const helpMsg = `🤖 <b>Welcome to teleEarn Converter Bot!</b>\n\nSend me posts with links and I'll convert them into <b>your</b> monetized links instantly.\n\n<b>How it works:</b>\n• Send complete posts with photos/videos\n• I'll find & replace all external links\n• Telegram links (t.me) are ignored!\n\n<b>⚙️ Customization Commands:</b>\n<code>/add_header TEXT</code> — Add text above links\n<code>/remove_header</code> — Remove header\n<code>/add_footer TEXT</code> — Add text below links\n<code>/remove_footer</code> — Remove footer\n<code>/enable_text</code> — Keep original surrounding text\n<code>/disable_text</code> — Show only converted links\n<code>/enable_bold</code> — Make header & footer bold\n<code>/disable_bold</code> — Normal text`;
                await tgAPI('sendMessage', { chat_id: chatId, text: helpMsg, parse_mode: 'HTML' });
                return res.status(200).send('OK');
            }
            if (text.startsWith('/add_header ')) {
                const val = text.replace('/add_header ', '');
                await supabase.from('users').update({ converter_header: val }).eq('id', user.id);
                await tgAPI('sendMessage', { chat_id: chatId, text: `✅ Header updated to:\n${val}` });
                return res.status(200).send('OK');
            }
            if (text === '/remove_header') {
                await supabase.from('users').update({ converter_header: '' }).eq('id', user.id);
                await tgAPI('sendMessage', { chat_id: chatId, text: `✅ Header removed.` });
                return res.status(200).send('OK');
            }
            if (text.startsWith('/add_footer ')) {
                const val = text.replace('/add_footer ', '');
                await supabase.from('users').update({ converter_footer: val }).eq('id', user.id);
                await tgAPI('sendMessage', { chat_id: chatId, text: `✅ Footer updated to:\n${val}` });
                return res.status(200).send('OK');
            }
            if (text === '/remove_footer') {
                await supabase.from('users').update({ converter_footer: '' }).eq('id', user.id);
                await tgAPI('sendMessage', { chat_id: chatId, text: `✅ Footer removed.` });
                return res.status(200).send('OK');
            }
            if (text === '/enable_text') {
                await supabase.from('users').update({ keep_text: true }).eq('id', user.id);
                await tgAPI('sendMessage', { chat_id: chatId, text: `✅ Original text will be kept around links.` });
                return res.status(200).send('OK');
            }
            if (text === '/disable_text') {
                await supabase.from('users').update({ keep_text: false }).eq('id', user.id);
                await tgAPI('sendMessage', { chat_id: chatId, text: `✅ Only converted links will be shown.` });
                return res.status(200).send('OK');
            }
            if (text === '/enable_bold') {
                await supabase.from('users').update({ bold_text: true }).eq('id', user.id);
                await tgAPI('sendMessage', { chat_id: chatId, text: `✅ Header & Footer will be BOLD.` });
                return res.status(200).send('OK');
            }
            if (text === '/disable_bold') {
                await supabase.from('users').update({ bold_text: false }).eq('id', user.id);
                await tgAPI('sendMessage', { chat_id: chatId, text: `✅ Header & Footer will be NORMAL text.` });
                return res.status(200).send('OK');
            }

            // 3. ⚡ FAST LINK CONVERTER ENGINE
            if (!text.startsWith('/')) {
                const urlRegex = /(https?:\/\/[^\s]+)/g;
                const extractedUrls = text.match(urlRegex);

                if (extractedUrls && extractedUrls.length > 0) {
                    const validUrls = extractedUrls.filter(url => !url.includes('t.me') && !url.includes('telegram.me') && !url.includes('telegram.dog'));

                    if (validUrls.length > 0) {
                        const actionType = msg.photo ? 'upload_photo' : (msg.video ? 'upload_video' : 'typing');
                        await tgAPI('sendChatAction', { chat_id: chatId, action: actionType });

                        // Batch DB Insert (Super Fast)
                        const linksToInsert = validUrls.map(url => ({
                            original_url: url,
                            short_id: Math.random().toString(36).substring(2, 8),
                            user_id: user.id
                        }));
                        await supabase.from('links').insert(linksToInsert);

                        // Build Text
                        let convertedLinksText = '';
                        linksToInsert.forEach(link => {
                            convertedLinksText += `🔗 https://t.me/teleEarnLinkbot/${APP_SHORT_NAME}?startapp=link_${link.short_id}\n\n`;
                        });

                        let head = user.converter_header ? `${user.converter_header}\n\n` : ``;
                        let foot = user.converter_footer ? `\n${user.converter_footer}` : ``;
                        if (user.bold_text) {
                            if (head) head = `<b>${head.trim()}</b>\n\n`;
                            if (foot) foot = `\n<b>${foot.trim()}</b>`;
                        }

                        let finalCaption = '';
                        if (user.keep_text) {
                            // Replace old URLs with new ones inside original text
                            let newOriginalText = text;
                            validUrls.forEach((oldUrl, index) => {
                                const newUrl = `https://t.me/teleEarnLinkbot/${APP_SHORT_NAME}?startapp=link_${linksToInsert[index].short_id}`;
                                newOriginalText = newOriginalText.replace(oldUrl, newUrl);
                            });
                            finalCaption = `${head}${newOriginalText}${foot}`;
                        } else {
                            finalCaption = `${head}${convertedLinksText.trim()}${foot}`;
                        }

                        // Send back media + new caption
                        if (msg.photo) await tgAPI('sendPhoto', { chat_id: chatId, photo: msg.photo[msg.photo.length - 1].file_id, caption: finalCaption, parse_mode: 'HTML' });
                        else if (msg.video) await tgAPI('sendVideo', { chat_id: chatId, video: msg.video.file_id, caption: finalCaption, parse_mode: 'HTML' });
                        else if (msg.animation) await tgAPI('sendAnimation', { chat_id: chatId, animation: msg.animation.file_id, caption: finalCaption, parse_mode: 'HTML' });
                        else await tgAPI('sendMessage', { chat_id: chatId, text: finalCaption, parse_mode: 'HTML', disable_web_page_preview: true });
                    }
                }
            }
        }
        res.status(200).send('OK');
    } catch (error) { res.status(200).send('Error'); }
}
