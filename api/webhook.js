export default async function handler(req, res) {
    // Browser test
    if (req.method === 'GET') {
        return res.status(200).send('Webhook is Super Active!');
    }

    try {
        const BOT_TOKEN = process.env.BOT_TOKEN;
        if (!BOT_TOKEN) {
            return res.status(200).send('Token Error'); 
        }

        const update = req.body;

        // Message Check
        if (update && update.message && update.message.text) {
            const chatId = update.message.chat.id;
            const text = update.message.text;

            // Agar /start dabaya gaya hai
            if (text.startsWith('/start')) {
                const param = text.split(' ')[1] || '';
                let finalUrl = 'https://t.me/teleEarnLinkbot/httpsteleearnlinksvercelapp';
                
                if (param) {
                    finalUrl += `?startapp=${param}`;
                }

                // Mast Text Message (Bina image ke, taaki fast jaye aur fail na ho)
                const messageText = `🚀 <b>Welcome to teleEarn!</b>\n\nThe most advanced and highest-paying URL shortener on Telegram.\n\n🔗 Shorten your links\n💸 Share with friends\n💰 Earn real cash directly to your wallet!\n\n👇 <b>Click below to open your dashboard!</b>`;

                // Send Message
                await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: chatId,
                        text: messageText,
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [[{ text: "✨ Open teleEarn ✨", url: finalUrl }]]
                        }
                    })
                });
            }
        }

        res.status(200).send('OK');
    } catch (error) {
        res.status(200).send('Error');
    }
}
