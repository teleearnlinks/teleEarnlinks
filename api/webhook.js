const { createClient } = require('@supabase/supabase-js');

export default async function handler(req, res) {
    if (req.method === 'GET') return res.status(200).send('Webhook is Active!');

    try {
        const BOT_TOKEN = process.env.BOT_TOKEN;
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
        const ADMIN_ID = parseInt(process.env.ADMIN_ID); // Aapki Telegram ID yahan aayegi

        if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_KEY) return res.status(200).send('Env missing');

        const update = req.body;

        if (update && update.message && update.message.text) {
            const chatId = update.message.chat.id;
            const text = update.message.text;
            const isAdmin = (chatId === ADMIN_ID);

            const cleanUrl = SUPABASE_URL.trim().replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
            const supabase = createClient(cleanUrl, SUPABASE_KEY.trim());

            // Fetch current settings
            const { data: currentSettings } = await supabase.from('settings').select('*').limit(1).single();
            const settingsId = currentSettings ? currentSettings.id : null;

            // Helper to send simple messages
            const sendMsg = async (msgText) => {
                await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: chatId, text: msgText, parse_mode: 'HTML' })
                });
            };

            // 🟢 NORMAL USER: /start
            if (text.startsWith('/start')) {
                const param = text.split(' ')[1] || '';
                let finalUrl = 'https://t.me/teleEarnLinkbot/httpsteleearnlinksvercelapp';
                if (param) finalUrl += `?startapp=${param}`;

                let caption = currentSettings?.welcome_text || `🌟 <b>Welcome to teleEarn!</b> 🌟\n\nClick below to open your Dashboard!`;
                let photoUrl = currentSettings?.welcome_image || '';
                let buttonText = currentSettings?.button_text || "🚀 Open teleEarn Dashboard 🚀";

                const replyMarkup = { inline_keyboard: [[{ text: buttonText, url: finalUrl }]] };

                if (photoUrl && photoUrl.startsWith('http')) {
                    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ chat_id: chatId, photo: photoUrl, caption: caption, parse_mode: 'HTML', reply_markup: replyMarkup })
                    });
                } else {
                    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ chat_id: chatId, text: caption, parse_mode: 'HTML', reply_markup: replyMarkup })
                    });
                }
            }
            
            // 🔴 ADMIN ONLY: Bot panel commands
            else if (isAdmin && text === '/admin') {
                const adminMenu = `🛠 <b>Bot Admin Panel</b>\n\nSend these commands to change bot UI:\n\n1️⃣ <b>Change Text:</b>\n<code>/settext Aapka naya message yahan...</code>\n\n2️⃣ <b>Change Image:</b>\n<code>/setimg https://link-to-image.jpg</code>\n<i>(Image hatane ke liye type karein: <code>/setimg none</code>)</i>\n\n3️⃣ <b>Change Button Name:</b>\n<code>/setbtn 🚀 Click Here</code>`;
                await sendMsg(adminMenu);
            }
            else if (isAdmin && text.startsWith('/settext ')) {
                const newText = text.replace('/settext ', '');
                if(settingsId) await supabase.from('settings').update({ welcome_text: newText }).eq('id', settingsId);
                else await supabase.from('settings').insert([{ welcome_text: newText }]);
                await sendMsg("✅ Welcome Text Updated! Check by typing /start");
            }
            else if (isAdmin && text.startsWith('/setimg ')) {
                let newImg = text.replace('/setimg ', '').trim();
                if(newImg.toLowerCase() === 'none') newImg = null;
                if(settingsId) await supabase.from('settings').update({ welcome_image: newImg }).eq('id', settingsId);
                else await supabase.from('settings').insert([{ welcome_image: newImg }]);
                await sendMsg("✅ Welcome Image Updated! Check by typing /start");
            }
            else if (isAdmin && text.startsWith('/setbtn ')) {
                const newBtn = text.replace('/setbtn ', '');
                if(settingsId) await supabase.from('settings').update({ button_text: newBtn }).eq('id', settingsId);
                else await supabase.from('settings').insert([{ button_text: newBtn }]);
                await sendMsg("✅ Button Text Updated! Check by typing /start");
            }
        }
        res.status(200).send('OK');
    } catch (error) {
        console.error(error);
        res.status(200).send('Error');
    }
}
