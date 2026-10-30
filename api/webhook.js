export default async function handler(req, res) {
    // Return 200 quickly so Telegram knows we received the message
    if (req.method !== 'POST') {
        return res.status(200).send('Webhook is running!');
    }

    const BOT_TOKEN = process.env.BOT_TOKEN;
    if (!BOT_TOKEN) return res.status(500).send('BOT_TOKEN missing');

    const update = req.body;

    // Check if the update is a regular message with text
    if (update.message && update.message.text) {
        const chatId = update.message.chat.id;
        const text = update.message.text;

        // If user sends /start
        if (text.startsWith('/start')) {
            
            // Check if there is a startapp parameter (like ref_123 or link_abc)
            const param = text.split(' ')[1] || '';
            let finalUrl = 'https://t.me/teleEarnLinkbot/httpsteleearnlinksvercelapp';
            if (param) {
                finalUrl += `?startapp=${param}`;
            }

            // Beautiful Caption
            const caption = `🚀 <b>Welcome to teleEarn!</b>\n\nThe most advanced and highest-paying URL shortener on Telegram.\n\n🔗 Shorten your links\n💸 Share with friends\n💰 Earn real cash directly to your wallet!\n\n👇 <b>Click below to open your dashboard!</b>`;

            // Attractive Image URL (Aap chahein toh is image URL ko apne kisi bhi image link se change kar sakte hain)
            const photoUrl = 'https://images.unsplash.com/photo-1639762681485-074b7f4ec672?q=80&w=800&auto=format&fit=crop';

            // Send the attractive response back to the user
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    photo: photoUrl,
                    caption: caption,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [[{
                            text: "✨ Open teleEarn ✨",
                            url: finalUrl
                        }]]
                    }
                })
            });
        }
    }

    // Always respond 200 OK to Telegram
    res.status(200).send('OK');
}
