const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { short_id, clicker_tg_id } = req.body;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) return res.status(500).json({ error: 'Vercel ENV variables missing' });
    const cleanUrl = supabaseUrl.trim().replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");

    try {
        const supabase = createClient(cleanUrl, supabaseKey.trim());
        const { data: linkData, error: linkErr } = await supabase.from('links').select('*').eq('short_id', short_id).single();
        if (linkErr || !linkData) return res.status(404).json({ error: 'Link not found' });

        const { data: adminSettings } = await supabase.from('settings').select('*').limit(1).single();
        const cpm = adminSettings && adminSettings.cpm ? adminSettings.cpm : 200;
        const earn_amount = cpm / 1000;

        if (clicker_tg_id) {
            await supabase.from('click_logs').insert([{ link_id: linkData.id, clicker_tg_id: clicker_tg_id }]);
        }

        await supabase.from('links').update({ clicks: (linkData.clicks || 0) + 1, earnings: (linkData.earnings || 0) + earn_amount }).eq('id', linkData.id);
        const { data: userData } = await supabase.from('users').select('*').eq('id', linkData.user_id).single();
        
        if (userData) {
            await supabase.from('users').update({
                balance: (userData.balance || 0) + earn_amount,
                today_earnings: (userData.today_earnings || 0) + earn_amount,
                total_earnings: (userData.total_earnings || 0) + earn_amount,
                total_clicks: (userData.total_clicks || 0) + 1,
                today_clicks: (userData.today_clicks || 0) + 1
            }).eq('id', userData.id);

            const referPercent = adminSettings && adminSettings.refer_percent ? adminSettings.refer_percent : 10;
            if (referPercent > 0) {
                const { data: referralData } = await supabase.from('referrals').select('referrer_tg_id').eq('referred_tg_id', userData.telegram_id).single();
                if (referralData && referralData.referrer_tg_id) {
                    const { data: referrerData } = await supabase.from('users').select('*').eq('telegram_id', referralData.referrer_tg_id).single();
                    if (referrerData) {
                        const referComm = earn_amount * (referPercent / 100);
                        await supabase.from('users').update({
                            balance: (referrerData.balance || 0) + referComm,
                            total_earnings: (referrerData.total_earnings || 0) + referComm
                        }).eq('id', referrerData.id);
                    }
                }
            }
        }
        return res.status(200).json({ success: true, message: 'Reward & Views added perfectly' });
    } catch (error) { return res.status(500).json({ error: error.message }); }
}
