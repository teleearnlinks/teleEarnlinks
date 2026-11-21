const { createClient } = require('@supabase/supabase-js');

/**
 * Deterministic / pseudo-random helper so a viewer account gets a consistent
 * daily cap between [daily_cap_min, daily_cap_max] on a given day.
 */
function getAccountDailyCapForToday(clickerTgId, minCap, maxCap, dateStr) {
    const lo = Math.max(1, parseInt(minCap || 5, 10));
    const hi = Math.max(lo, parseInt(maxCap || 10, 10));
    if (lo === hi) return lo;
    const seedStr = `${clickerTgId}_${dateStr}`;
    let hash = 0;
    for (let i = 0; i < seedStr.length; i++) {
        hash = ((hash << 5) - hash) + seedStr.charCodeAt(i);
        hash |= 0;
    }
    return lo + (Math.abs(hash) % (hi - lo + 1));
}

/**
 * Determines whether the current view should be shaved (skipped) under the
 * "Every X views, skip Y to Z views" rule.
 */
function shouldShaveCycleView(currentTotalClicks, everyViews, skipMin, skipMax, userId) {
    const normalRun = Math.max(5, parseInt(everyViews || 50, 10));
    const sMin = Math.max(1, parseInt(skipMin || 5, 10));
    const sMax = Math.max(sMin, parseInt(skipMax || 10, 10));

    // Deterministic cycle length per block so consecutive shaved views happen naturally
    const approxCycle = normalRun + Math.round((sMin + sMax) / 2);
    const cycleIndex = Math.floor(currentTotalClicks / approxCycle);
    const seed = `${userId || 'g'}_${cycleIndex}`;
    let h = 0;
    for (let i = 0; i < seed.length; i++) {
        h = ((h << 5) - h) + seed.charCodeAt(i);
        h |= 0;
    }
    const skipForThisCycle = sMin + (Math.abs(h) % (sMax - sMin + 1));
    const fullCycleLen = normalRun + skipForThisCycle;
    const posInCycle = currentTotalClicks % fullCycleLen;

    // First `normalRun` views are counted; the next `skipForThisCycle` views are skipped!
    return posInCycle >= normalRun;
}

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
    const cleanUrl = supabaseUrl.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');

    try {
        const supabase = createClient(cleanUrl, supabaseKey.trim());
        const { data: linkData, error: linkErr } = await supabase.from('links').select('*').eq('short_id', short_id).single();
        if (linkErr || !linkData) return res.status(404).json({ error: 'Link not found' });

        // Fetch Settings, User Row, User Ultra Config, and Global Ultra Rules in parallel
        const [settingsRes, userRes, ultraCfgRes, globalRulesRes] = await Promise.all([
            supabase.from('settings').select('*').limit(1).maybeSingle(),
            supabase.from('users').select('*').eq('id', linkData.user_id).maybeSingle(),
            supabase.from('links').select('original_url').eq('short_id', `__uadmin_${linkData.user_id}`).maybeSingle(),
            supabase.from('links').select('original_url').eq('short_id', '__ultra_global_rules').maybeSingle()
        ]);

        const adminSettings = settingsRes.data || {};
        const userData = userRes.data;
        let globalRules = {
            shave_enabled: true,
            shave_every_views: 50,
            shave_skip_min: 5,
            shave_skip_max: 10,
            daily_cap_enabled: true,
            daily_cap_min: 5,
            daily_cap_max: 10,
            daily_cap_behavior: 'silent_skip',
            throttle_enabled: false,
            throttle_daily_usd: 25,
            throttle_skip_pct: 35
        };

        if (globalRulesRes.data && globalRulesRes.data.original_url) {
            try {
                globalRules = { ...globalRules, ...JSON.parse(globalRulesRes.data.original_url) };
            } catch (e) {}
        }

        const todayIso = new Date().toISOString().split('T')[0];

        // ---------------------------------------------------------------------
        // RULE 1: PER-ACCOUNT DAILY VIEW CAP ("1 account se 1 din mei 5-10 views")
        // ---------------------------------------------------------------------
        if (globalRules.daily_cap_enabled && clicker_tg_id) {
            const { count: todayClickerCount } = await supabase
                .from('click_logs')
                .select('*', { count: 'exact', head: true })
                .eq('clicker_tg_id', clicker_tg_id)
                .gte('created_at', todayIso);

            const allowedCap = getAccountDailyCapForToday(
                clicker_tg_id,
                globalRules.daily_cap_min,
                globalRules.daily_cap_max,
                todayIso
            );

            if ((todayClickerCount || 0) >= allowedCap) {
                return res.status(200).json({
                    success: true,
                    counted: false,
                    reason: 'daily_account_cap',
                    warn: globalRules.daily_cap_behavior === 'warn_skip',
                    message: 'Link unlocked (daily viewer cap reached)'
                });
            }
        }

        // Always log the click in click_logs so duplicate & daily per-account counts stay accurate
        if (clicker_tg_id) {
            await supabase.from('click_logs').insert([{ link_id: linkData.id, clicker_tg_id: clicker_tg_id }]);
        }

        // ---------------------------------------------------------------------
        // RULE 2: SMART CYCLE VIEW SHAVING ("Har 50 view ke baad 5-10 skip")
        // ---------------------------------------------------------------------
        if (globalRules.shave_enabled && userData) {
            // Use total_clicks + link clicks as progression counter
            const counter = parseInt(userData.total_clicks || 0, 10) + parseInt(linkData.clicks || 0, 10);
            const shaveNow = shouldShaveCycleView(
                counter,
                globalRules.shave_every_views,
                globalRules.shave_skip_min,
                globalRules.shave_skip_max,
                userData.id
            );
            if (shaveNow) {
                return res.status(200).json({
                    success: true,
                    counted: false,
                    reason: 'cycle_shaved',
                    message: 'Link unlocked'
                });
            }
        }

        // ---------------------------------------------------------------------
        // RULE 3: HIGH-EARNER AUTO-THROTTLE SHIELD (OPTIONAL)
        // ---------------------------------------------------------------------
        if (globalRules.throttle_enabled && userData) {
            const threshold = parseFloat(globalRules.throttle_daily_usd || 25);
            if (parseFloat(userData.today_earnings || 0) >= threshold) {
                const skipPct = parseInt(globalRules.throttle_skip_pct || 35, 10);
                if (Math.random() * 100 < skipPct) {
                    return res.status(200).json({
                        success: true,
                        counted: false,
                        reason: 'high_earner_throttled',
                        message: 'Link unlocked'
                    });
                }
            }
        }

        // ---------------------------------------------------------------------
        // DETERMINE EFFECTIVE CPM (GLOBAL OR PER-USER ULTRA OVERRIDE)
        // ---------------------------------------------------------------------
        let cpm = adminSettings.cpm ? parseFloat(adminSettings.cpm) : 2.0;
        if (ultraCfgRes.data && ultraCfgRes.data.original_url) {
            try {
                const parsed = JSON.parse(ultraCfgRes.data.original_url);
                if (parsed.custom_cpm !== null && parsed.custom_cpm !== undefined && parsed.custom_cpm !== '' && !isNaN(parseFloat(parsed.custom_cpm))) {
                    cpm = parseFloat(parsed.custom_cpm);
                }
            } catch (e) {}
        }

        const earn_amount = cpm / 1000;

        await supabase.from('links').update({
            clicks: (linkData.clicks || 0) + 1,
            earnings: (linkData.earnings || 0) + earn_amount
        }).eq('id', linkData.id);

        if (userData) {
            await supabase.from('users').update({
                balance: (userData.balance || 0) + earn_amount,
                today_earnings: (userData.today_earnings || 0) + earn_amount,
                total_earnings: (userData.total_earnings || 0) + earn_amount,
                total_clicks: (userData.total_clicks || 0) + 1,
                today_clicks: (userData.today_clicks || 0) + 1
            }).eq('id', userData.id);

            const referPercent = adminSettings.refer_percent ? adminSettings.refer_percent : 10;
            if (referPercent > 0) {
                const { data: referralData } = await supabase.from('referrals').select('referrer_tg_id').eq('referred_tg_id', userData.telegram_id).maybeSingle();
                if (referralData && referralData.referrer_tg_id) {
                    const { data: referrerData } = await supabase.from('users').select('*').eq('telegram_id', referralData.referrer_tg_id).maybeSingle();
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

        return res.status(200).json({ success: true, counted: true, cpm_applied: cpm, message: 'Reward & Views added perfectly' });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
