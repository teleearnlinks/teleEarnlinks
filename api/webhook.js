/**
 * ============================================================================
 * teleEarn - Main Mini App Bot Webhook (api/webhook.js)
 * ============================================================================
 * Deploy on Vercel inside: `/api/webhook.js`
 *
 * Key Features:
 * 1. Premium /start Experience:
 *    - Sends a Photo, Video, or GIF along with a rich, premium HTML caption
 *      (including live CPM & Referral rates, user greeting, and Link Converter
 *      Bot @username) and sleek coloured Inline Buttons ("🚀 Open Dashboard"
 *      & "⚡ Link Converter Bot").
 *    - Automatically registers new users in Supabase `users` table and tracks
 *      referral links (`/start ref_<id>`) & deep links (`/start link_<id>`).
 * 2. Complete In-Bot Admin Panel (`/admin` or `/admin Priyans2109J`):
 *    - 🖼️ Change Welcome Photo / Video / GIF: Simply send any Photo, Video,
 *      GIF, or URL to the bot and it saves instantly!
 *    - 📝 Change Welcome Text / Caption: Supports HTML formatting, dynamic
 *      variables (`{name}`, `{cpm}`, `{ref}`, `{converter}`), and automatic
 *      Telegram Custom Emoji (`<tg-emoji>`) preservation.
 *    - 🤖 Change Link Converter Bot Username: Updates both the welcome text
 *      and the Converter Bot button link in 1 tap.
 *    - 🎨 Change Button Text, Button Colour (`🔵 Blue`, `🟢 Green`, `🔴 Red`,
 *      `⚪ Default`) & Automatic Custom Emoji ID (`icon_custom_emoji_id`)!
 * 3. Fast Cached Supabase Persistence:
 *    - Saves all Admin customizations in Supabase (`__main_bot_ui` config row)
 *      with in-memory caching for instant `/start` responses.
 * ============================================================================
 */

const { createClient } = require('@supabase/supabase-js');

// ============================================================================
// 1. CONFIGURATION
// ============================================================================
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zrhrvbkefmybketbiicw.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_Iwz3ILjEoOrr_PBqRc7nIQ_UunV1f1y';

// Main Mini App Bot Token (@teleEarnLinkbot)
const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || 'YOUR_MAIN_BOT_TOKEN_HERE';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Priyans2109J';

const BOT_USERNAME = 'teleEarnLinkbot';
const APP_SHORT_NAME = 'httpsteleearnlinksvercelapp';
const MINI_APP_WEB_URL = 'https://teleearnlinks.vercel.app/';
const MINI_APP_TG_URL = `https://t.me/${BOT_USERNAME}/${APP_SHORT_NAME}`;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false }
});

// Default Welcome Configuration (Fully editable from /admin inside the bot)
const DEFAULT_MAIN_UI = {
    admin_ids: [],
    converter_bot_username: '@teleEarnConverterBot',

    // Media settings: 'photo' | 'video' | 'animation' | 'none'
    media_type: 'photo',
    media_source: 'https://images.unsplash.com/photo-1639762681485-074b7f938ba0?auto=format&fit=crop&w=1200&q=80',

    // Custom Welcome Text (If empty, uses the built-in premium template with live CPM/Refer stats)
    custom_welcome_html: '',

    // Buttons configuration
    buttons: {
        dashboard: {
            text: '🚀 Open Dashboard',
            color: 'primary',     // 'primary' (Blue), 'success' (Green), 'danger' (Red), 'default'
            emoji_id: null
        },
        converter: {
            text: '⚡ Auto Link Converter Bot',
            color: 'success',
            emoji_id: null,
            enabled: true
        },
        channel: {
            text: '📢 Official Channel',
            color: 'default',
            emoji_id: null,
            enabled: true
        }
    }
};

// In-Memory Cache for Ultra-Fast Responses
const CACHE_TTL_MS = 60 * 1000;
let mainUiCache = { data: null, rowId: null, ts: 0 };
let appSettingsCache = { data: null, ts: 0 };
const adminStateMap = new Map(); // tgId -> { state, ts }

// ============================================================================
// 2. TELEGRAM API HELPER (WITH FALLBACK SAFETY)
// ============================================================================
function stripUnsupportedButtonProps(replyMarkup) {
    if (!replyMarkup || !replyMarkup.inline_keyboard) return replyMarkup;
    return {
        ...replyMarkup,
        inline_keyboard: replyMarkup.inline_keyboard.map(row =>
            row.map(btn => {
                const copy = { ...btn };
                delete copy.style;
                delete copy.icon_custom_emoji_id;
                return copy;
            })
        )
    };
}

async function tgApi(method, payload) {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
    let res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    let data = await res.json();

    // Auto-fallback if button style or custom emoji is rejected
    if (
        !data.ok &&
        payload?.reply_markup?.inline_keyboard &&
        /style|custom_emoji|button/i.test(data.description || '')
    ) {
        const fallbackPayload = {
            ...payload,
            reply_markup: stripUnsupportedButtonProps(payload.reply_markup)
        };
        res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fallbackPayload)
        });
        data = await res.json();
    }

    // Auto-fallback to text message if media URL / file_id fails to load
    if (!data.ok && (method === 'sendPhoto' || method === 'sendVideo' || method === 'sendAnimation')) {
        console.warn(`Media send failed (${data.description}), falling back to sendMessage.`);
        res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: payload.chat_id,
                text: payload.caption || '⚡ Welcome to teleEarn!',
                parse_mode: payload.parse_mode || 'HTML',
                reply_markup: payload.reply_markup
            })
        });
        data = await res.json();
    }

    return data;
}

async function registerBotCommands() {
    return tgApi('setMyCommands', {
        commands: [
            { command: 'start', description: '🚀 Launch teleEarn & Open Dashboard' },
            { command: 'admin', description: '🛠️ Bot Admin Panel (Customize Post & Buttons)' }
        ]
    });
}

// ============================================================================
// 3. CUSTOM EMOJI ID EXTRACTOR & HTML PARSER
// ============================================================================
function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function extractCustomEmojis(text = '', entities = []) {
    const list = [];
    if (!Array.isArray(entities)) return list;
    for (const ent of entities) {
        if (ent.type === 'custom_emoji' && ent.custom_emoji_id) {
            const char = text.slice(ent.offset, ent.offset + ent.length);
            list.push({
                id: String(ent.custom_emoji_id),
                char,
                offset: ent.offset,
                length: ent.length
            });
        }
    }
    return list;
}

function entitiesToHtml(text = '', entities = []) {
    if (!text) return '';
    if (!Array.isArray(entities) || entities.length === 0) {
        return escapeHtml(text);
    }

    const openTags = Array.from({ length: text.length + 1 }, () => []);
    const closeTags = Array.from({ length: text.length + 1 }, () => []);

    for (const ent of entities) {
        const start = ent.offset;
        const end = ent.offset + ent.length;
        if (start < 0 || end > text.length || start >= end) continue;

        let open = '';
        let close = '';

        switch (ent.type) {
            case 'custom_emoji':
                open = `<tg-emoji emoji-id="${ent.custom_emoji_id}">`;
                close = `</tg-emoji>`;
                break;
            case 'bold':
                open = '<b>';
                close = '</b>';
                break;
            case 'italic':
                open = '<i>';
                close = '</i>';
                break;
            case 'underline':
                open = '<u>';
                close = '</u>';
                break;
            case 'strikethrough':
                open = '<s>';
                close = '</s>';
                break;
            case 'code':
                open = '<code>';
                close = '</code>';
                break;
            case 'pre':
                open = '<pre>';
                close = '</pre>';
                break;
            case 'spoiler':
                open = '<tg-spoiler>';
                close = '</tg-spoiler>';
                break;
            case 'text_link':
                if (ent.url) {
                    open = `<a href="${escapeHtml(ent.url)}">`;
                    close = '</a>';
                }
                break;
            default:
                break;
        }

        if (open && close) {
            openTags[start].push(open);
            closeTags[end].unshift(close);
        }
    }

    let out = '';
    for (let i = 0; i < text.length; i++) {
        if (closeTags[i].length > 0) out += closeTags[i].join('');
        if (openTags[i].length > 0) out += openTags[i].join('');
        out += escapeHtml(text[i]);
    }
    if (closeTags[text.length].length > 0) {
        out += closeTags[text.length].join('');
    }
    return out;
}

// ============================================================================
// 4. SUPABASE DATA & CONFIG STORAGE (`__main_bot_ui`)
// ============================================================================
async function getMainUiConfig(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && mainUiCache.data && now - mainUiCache.ts < CACHE_TTL_MS) {
        return { ui: mainUiCache.data, rowId: mainUiCache.rowId };
    }

    const { data: row } = await supabase
        .from('links')
        .select('id, original_url')
        .eq('short_id', '__main_bot_ui')
        .maybeSingle();

    let merged = JSON.parse(JSON.stringify(DEFAULT_MAIN_UI));
    if (row && row.original_url) {
        try {
            const parsed = JSON.parse(row.original_url);
            merged = {
                ...merged,
                ...parsed,
                buttons: {
                    dashboard: { ...merged.buttons.dashboard, ...(parsed.buttons?.dashboard || {}) },
                    converter: { ...merged.buttons.converter, ...(parsed.buttons?.converter || {}) },
                    channel:   { ...merged.buttons.channel,   ...(parsed.buttons?.channel || {}) }
                }
            };
        } catch (e) {}
    }

    mainUiCache = { data: merged, rowId: row?.id || null, ts: now };
    return { ui: merged, rowId: row?.id || null };
}

async function saveMainUiConfig(ui) {
    const serialized = JSON.stringify(ui);
    mainUiCache = { data: ui, rowId: mainUiCache.rowId, ts: Date.now() };

    if (mainUiCache.rowId) {
        await supabase.from('links').update({ original_url: serialized }).eq('id', mainUiCache.rowId);
        return;
    }

    const { data: existing } = await supabase
        .from('links')
        .select('id')
        .eq('short_id', '__main_bot_ui')
        .maybeSingle();

    if (existing?.id) {
        mainUiCache.rowId = existing.id;
        await supabase.from('links').update({ original_url: serialized }).eq('id', existing.id);
    } else {
        const { data: created } = await supabase
            .from('links')
            .insert([{ short_id: '__main_bot_ui', original_url: serialized, user_id: null }])
            .select('id')
            .maybeSingle();
        if (created?.id) mainUiCache.rowId = created.id;
    }
}

async function getAppSettings() {
    const now = Date.now();
    if (appSettingsCache.data && now - appSettingsCache.ts < CACHE_TTL_MS) {
        return appSettingsCache.data;
    }
    const { data } = await supabase.from('settings').select('*').limit(1).maybeSingle();
    const settings = data || { cpm: 2.5, refer_percent: 10, min_withdraw: 5, tg_channel_url: '' };
    appSettingsCache = { data: settings, ts: now };
    return settings;
}

async function ensureUserRegistered(tgUser, startParam = '') {
    try {
        const { data: existUser } = await supabase
            .from('users')
            .select('id, telegram_id, is_blocked')
            .eq('telegram_id', tgUser.id)
            .maybeSingle();

        if (!existUser) {
            await supabase.from('users').insert([{
                telegram_id: tgUser.id,
                first_name: tgUser.first_name || 'User',
                username: tgUser.username || ''
            }]);

            if (startParam && startParam.startsWith('ref_')) {
                const referrerId = parseInt(startParam.replace('ref_', ''), 10);
                if (referrerId && referrerId !== tgUser.id) {
                    await supabase.from('referrals').insert([{
                        referrer_tg_id: referrerId,
                        referred_tg_id: tgUser.id,
                        status: 'pending'
                    }]);
                }
            }
        }
        return existUser;
    } catch (e) {
        return null;
    }
}

// ============================================================================
// 5. PREMIUM WELCOME MESSAGE & INLINE KEYBOARD BUILDERS
// ============================================================================
function buildStyledInlineBtn(btnSpec, actionObj) {
    const btn = {
        text: btnSpec.text || 'Open',
        ...actionObj
    };
    if (btnSpec.color && ['primary', 'success', 'danger'].includes(btnSpec.color)) {
        btn.style = btnSpec.color;
    }
    if (btnSpec.emoji_id) {
        btn.icon_custom_emoji_id = String(btnSpec.emoji_id);
    }
    return btn;
}

function formatConverterHandle(rawHandle = '@teleEarnConverterBot') {
    const trimmed = rawHandle.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        const cleanUser = trimmed.split('/').pop().replace('@', '');
        return { display: `@${cleanUser}`, url: `https://t.me/${cleanUser}` };
    }
    const cleanUser = trimmed.replace(/^@/, '');
    return { display: `@${cleanUser}`, url: `https://t.me/${cleanUser}` };
}

function buildWelcomeCaption(tgUser, ui, settings, startParam = '') {
    const firstName = escapeHtml(tgUser?.first_name || 'Partner');
    const cpmRate = parseFloat(settings?.cpm || 2.0).toFixed(2);
    const refPercent = settings?.refer_percent || 10;
    const minWithdraw = parseFloat(settings?.min_withdraw || 5.0).toFixed(2);
    const conv = formatConverterHandle(ui.converter_bot_username);

    // If user clicked a shortened link via /start link_xyz
    if (startParam && startParam.startsWith('link_')) {
        return (
            `🔓 <b>Your Link is Ready!</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `👋 Hello <b>${firstName}</b>, click the button below to unlock and view your destination link inside <b>teleEarn</b>!\n\n` +
            `🤖 <b>Auto Link Converter Bot:</b> ${conv.display}`
        );
    }

    // If Admin set a custom welcome caption, replace dynamic placeholders
    if (ui.custom_welcome_html && ui.custom_welcome_html.trim() !== '') {
        return ui.custom_welcome_html
            .replace(/\{name\}/gi, firstName)
            .replace(/\{cpm\}/gi, `$${cpmRate}`)
            .replace(/\{ref\}/gi, `${refPercent}%`)
            .replace(/\{min_withdraw\}/gi, `$${minWithdraw}`)
            .replace(/\{converter\}/gi, conv.display);
    }

    // Default Premium Welcome Caption
    return (
        `⚡ <b>Welcome to teleEarn — Premium Link Shortener!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `👋 Hey <b>${firstName}</b>! Turn every link and post into instant daily earnings with the highest payout rates on Telegram.\n\n` +
        `💎 <b>Why Creators Choose teleEarn:</b>\n` +
        `• 💰 <b>Global CPM Rate:</b> <code>$${cpmRate} / 1000 Views</code>\n` +
        `• 🤝 <b>Lifetime Referral Bonus:</b> <code>${refPercent}% Commission</code>\n` +
        `• ⚡ <b>Fast Payouts:</b> Minimum Withdraw just <code>$${minWithdraw}</code>\n\n` +
        `🤖 <b>Bulk Post & Link Converter Bot:</b>\n` +
        `👉 <b>${conv.display}</b>\n` +
        `<i>(Forward any DiskWala, TeraBox, or Filezen Photo/Video post to ${conv.display} to auto-convert links in 1 second!)</i>\n\n` +
        `👇 <b>Tap below to launch your Earnings Dashboard:</b>`
    );
}

function buildWelcomeKeyboard(ui, settings, tgId, startParam = '') {
    const b = ui.buttons;
    const conv = formatConverterHandle(ui.converter_bot_username);
    const isAdmin = Array.isArray(ui.admin_ids) && ui.admin_ids.includes(Number(tgId));

    const dashboardTargetUrl =
        startParam && startParam.startsWith('link_')
            ? `${MINI_APP_TG_URL}?startapp=${encodeURIComponent(startParam)}`
            : MINI_APP_WEB_URL;

    const dashAction =
        startParam && startParam.startsWith('link_')
            ? { url: dashboardTargetUrl }
            : { web_app: { url: MINI_APP_WEB_URL } };

    const dashBtnSpec =
        startParam && startParam.startsWith('link_')
            ? { ...b.dashboard, text: '🔓 Unlock & Open Link' }
            : b.dashboard;

    const rows = [
        [buildStyledInlineBtn(dashBtnSpec, dashAction)]
    ];

    if (b.converter?.enabled !== false) {
        rows.push([
            buildStyledInlineBtn(b.converter, { url: conv.url })
        ]);
    }

    if (b.channel?.enabled && settings?.tg_channel_url) {
        rows.push([
            buildStyledInlineBtn(b.channel, { url: settings.tg_channel_url })
        ]);
    }

    if (isAdmin) {
        rows.push([
            { text: '🛠️ Open Bot Admin Panel', callback_data: 'm_adm_open', style: 'primary' }
        ]);
    }

    return { inline_keyboard: rows };
}

async function sendWelcomePost(chatId, tgUser, ui, settings, startParam = '') {
    const caption = buildWelcomeCaption(tgUser, ui, settings, startParam);
    const replyMarkup = buildWelcomeKeyboard(ui, settings, tgUser.id, startParam);

    if (ui.media_type === 'photo' && ui.media_source) {
        return tgApi('sendPhoto', {
            chat_id: chatId,
            photo: ui.media_source,
            caption,
            parse_mode: 'HTML',
            reply_markup: replyMarkup
        });
    }

    if (ui.media_type === 'video' && ui.media_source) {
        return tgApi('sendVideo', {
            chat_id: chatId,
            video: ui.media_source,
            caption,
            parse_mode: 'HTML',
            reply_markup: replyMarkup
        });
    }

    if (ui.media_type === 'animation' && ui.media_source) {
        return tgApi('sendAnimation', {
            chat_id: chatId,
            animation: ui.media_source,
            caption,
            parse_mode: 'HTML',
            reply_markup: replyMarkup
        });
    }

    return tgApi('sendMessage', {
        chat_id: chatId,
        text: caption,
        parse_mode: 'HTML',
        disable_web_page_preview: false,
        reply_markup: replyMarkup
    });
}

// ============================================================================
// 6. BOT ADMIN PANEL UI BUILDERS (`/admin`)
// ============================================================================
function colorName(c) {
    if (c === 'primary') return '🔵 Blue';
    if (c === 'success') return '🟢 Green';
    if (c === 'danger')  return '🔴 Red';
    return '⚪ Default';
}

function buildAdminDashboardText(ui) {
    const b = ui.buttons;
    const mediaBadge =
        ui.media_type === 'photo'     ? '🖼️ Photo Set' :
        ui.media_type === 'video'     ? '🎬 Video Set' :
        ui.media_type === 'animation' ? '🎞️ GIF Set' : '📄 Text Only (No Media)';

    const textBadge = ui.custom_welcome_html
        ? '✅ Custom Text Set'
        : '✨ Default Premium Template (Auto CPM/Ref)';

    return (
        `🛠️ <b>teleEarn Main Bot — Admin Panel</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Yahan se aap <code>/start</code> post ki <b>Photo/Video, Welcome Text, Converter Bot @Username, Button Text, Button Colour aur Custom Emoji</b> live change kar sakte hain:\n\n` +
        `📌 <b>Current Configuration:</b>\n` +
        `• <b>Welcome Media:</b> ${mediaBadge}\n` +
        `• <b>Welcome Text:</b> ${textBadge}\n` +
        `• <b>Converter Bot:</b> <code>${escapeHtml(ui.converter_bot_username)}</code>\n` +
        `• <b>Dashboard Btn:</b> "${escapeHtml(b.dashboard.text)}" [${colorName(b.dashboard.color)}]${b.dashboard.emoji_id ? ` ✨<code>${b.dashboard.emoji_id}</code>` : ''}\n` +
        `• <b>Converter Btn:</b> "${escapeHtml(b.converter.text)}" [${colorName(b.converter.color)}]${b.converter.emoji_id ? ` ✨<code>${b.converter.emoji_id}</code>` : ''}\n\n` +
        `👇 <b>Select an option below to customize:</b>`
    );
}

function buildAdminDashboardKeyboard(ui) {
    const b = ui.buttons;
    return {
        inline_keyboard: [
            [
                { text: '🖼️ Change Photo / Video', callback_data: 'm_adm_set_media', style: 'primary' },
                { text: '🗑️ Remove Media', callback_data: 'm_adm_rm_media', style: 'danger' }
            ],
            [
                { text: '📝 Edit Welcome Text', callback_data: 'm_adm_set_text', style: 'success' },
                { text: '🔄 Default Text', callback_data: 'm_adm_reset_text', style: 'danger' }
            ],
            [
                { text: `🤖 Converter Bot (${ui.converter_bot_username})`, callback_data: 'm_adm_set_conv', style: 'primary' }
            ],
            [
                { text: '✏️ Dashboard Btn Text/Emoji', callback_data: 'm_adm_edit_btn:dashboard', style: 'primary' },
                {
                    text: `🎨 ${colorName(b.dashboard.color)}`,
                    callback_data: 'm_adm_color_btn:dashboard',
                    style: b.dashboard.color !== 'default' ? b.dashboard.color : undefined
                }
            ],
            [
                { text: '✏️ Converter Btn Text/Emoji', callback_data: 'm_adm_edit_btn:converter', style: 'primary' },
                {
                    text: `🎨 ${colorName(b.converter.color)}`,
                    callback_data: 'm_adm_color_btn:converter',
                    style: b.converter.color !== 'default' ? b.converter.color : undefined
                }
            ],
            [
                {
                    text: b.converter.enabled !== false ? '👁️ Converter Btn: ON ✅' : '👁️ Converter Btn: OFF ❌',
                    callback_data: 'm_adm_toggle_conv_btn'
                },
                {
                    text: b.channel.enabled !== false ? '📢 Channel Btn: ON ✅' : '📢 Channel Btn: OFF ❌',
                    callback_data: 'm_adm_toggle_chan_btn'
                }
            ],
            [
                { text: '👁️ Preview /start Post Now', callback_data: 'm_adm_preview', style: 'success' }
            ],
            [
                { text: '🔄 Reset Everything to Default', callback_data: 'm_adm_reset_all', style: 'danger' }
            ]
        ]
    };
}

// ============================================================================
// 7. VERCEL SERVERLESS WEBHOOK HANDLER
// ============================================================================
module.exports = async function handler(req, res) {
    if (req.method === 'GET') {
        await registerBotCommands();
        return res.status(200).json({
            ok: true,
            bot: 'teleEarn Main Mini App Bot Webhook',
            status: 'Active & Ready'
        });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const update = req.body;
        if (!update) return res.status(200).send('OK');

        // --------------------------------------------------------------------
        // A. HANDLE CALLBACK QUERIES (ADMIN PANEL CONTROLS)
        // --------------------------------------------------------------------
        if (update.callback_query) {
            const cb = update.callback_query;
            const chatId = cb.message.chat.id;
            const messageId = cb.message.message_id;
            const tgId = cb.from.id;
            const action = cb.data;

            const [{ ui }, settings] = await Promise.all([
                getMainUiConfig(false),
                getAppSettings()
            ]);

            const isAdmin = Array.isArray(ui.admin_ids) && ui.admin_ids.includes(Number(tgId));

            if (!isAdmin) {
                await tgApi('answerCallbackQuery', {
                    callback_query_id: cb.id,
                    text: '🚫 Admin Access Required! Send /admin',
                    show_alert: true
                });
                return res.status(200).send('OK');
            }

            if (action === 'm_adm_open') {
                adminStateMap.delete(tgId);
                await tgApi('answerCallbackQuery', { callback_query_id: cb.id });
                await tgApi('sendMessage', {
                    chat_id: chatId,
                    text: buildAdminDashboardText(ui),
                    parse_mode: 'HTML',
                    reply_markup: buildAdminDashboardKeyboard(ui)
                });
                return res.status(200).send('OK');
            }

            if (action === 'm_adm_preview') {
                adminStateMap.delete(tgId);
                await tgApi('answerCallbackQuery', { callback_query_id: cb.id, text: '👁️ Sending live preview...' });
                await sendWelcomePost(chatId, cb.from, ui, settings, '');
                return res.status(200).send('OK');
            }

            if (action === 'm_adm_set_media') {
                adminStateMap.set(tgId, { state: 'awaiting_media', ts: Date.now() });
                await tgApi('answerCallbackQuery', { callback_query_id: cb.id });
                await tgApi('sendMessage', {
                    chat_id: chatId,
                    text:
                        `🖼️ <b>Send the new Welcome Photo, Video, or GIF now:</b>\n\n` +
                        `• Aap seedha gallery se <b>Photo, Video, ya GIF</b> bhej sakte hain\n` +
                        `• Ya phir kisi image/video ka direct <code>https://...</code> URL bhej sakte hain!`,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'm_adm_open', style: 'danger' }]]
                    }
                });
                return res.status(200).send('OK');
            }

            if (action === 'm_adm_rm_media') {
                ui.media_type = 'none';
                ui.media_source = '';
                await saveMainUiConfig(ui);
                await tgApi('answerCallbackQuery', { callback_query_id: cb.id, text: '🗑️ Media removed (Text-only mode enabled)' });
                await tgApi('editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: buildAdminDashboardText(ui),
                    parse_mode: 'HTML',
                    reply_markup: buildAdminDashboardKeyboard(ui)
                });
                return res.status(200).send('OK');
            }

            if (action === 'm_adm_set_text') {
                adminStateMap.set(tgId, { state: 'awaiting_welcome_text', ts: Date.now() });
                await tgApi('answerCallbackQuery', { callback_query_id: cb.id });
                await tgApi('sendMessage', {
                    chat_id: chatId,
                    text:
                        `📝 <b>Send the new Welcome Text / Caption now:</b>\n\n` +
                        `✨ <b>Supported Dynamic Placeholders (Optional):</b>\n` +
                        `• <code>{name}</code> — User's First Name\n` +
                        `• <code>{cpm}</code> — Live Global CPM Rate\n` +
                        `• <code>{ref}</code> — Live Referral Commission %\n` +
                        `• <code>{min_withdraw}</code> — Minimum Withdraw Amount\n` +
                        `• <code>{converter}</code> — Converter Bot @Username\n\n` +
                        `<i>(Bold, Italic, Quotes aur Telegram Custom Emojis automatic save honge!)</i>`,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'm_adm_open', style: 'danger' }]]
                    }
                });
                return res.status(200).send('OK');
            }

            if (action === 'm_adm_reset_text') {
                ui.custom_welcome_html = '';
                await saveMainUiConfig(ui);
                await tgApi('answerCallbackQuery', { callback_query_id: cb.id, text: '✨ Restored Default Premium Welcome Text!' });
                await tgApi('editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: buildAdminDashboardText(ui),
                    parse_mode: 'HTML',
                    reply_markup: buildAdminDashboardKeyboard(ui)
                });
                return res.status(200).send('OK');
            }

            if (action === 'm_adm_set_conv') {
                adminStateMap.set(tgId, { state: 'awaiting_converter_username', ts: Date.now() });
                await tgApi('answerCallbackQuery', { callback_query_id: cb.id });
                await tgApi('sendMessage', {
                    chat_id: chatId,
                    text:
                        `🤖 <b>Send your Link Converter Bot's @Username:</b>\n\n` +
                        `Example: <code>@teleEarnConverterBot</code>`,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'm_adm_open', style: 'danger' }]]
                    }
                });
                return res.status(200).send('OK');
            }

            if (action.startsWith('m_adm_color_btn:')) {
                const btnKey = action.split(':')[1];
                if (ui.buttons[btnKey]) {
                    const order = ['primary', 'success', 'danger', 'default'];
                    const curr = ui.buttons[btnKey].color || 'primary';
                    const next = order[(order.indexOf(curr) + 1) % order.length];
                    ui.buttons[btnKey].color = next;
                    await saveMainUiConfig(ui);
                    await tgApi('answerCallbackQuery', {
                        callback_query_id: cb.id,
                        text: `🎨 Button colour set to ${colorName(next)}`
                    });
                    await tgApi('editMessageText', {
                        chat_id: chatId,
                        message_id: messageId,
                        text: buildAdminDashboardText(ui),
                        parse_mode: 'HTML',
                        reply_markup: buildAdminDashboardKeyboard(ui)
                    });
                }
                return res.status(200).send('OK');
            }

            if (action.startsWith('m_adm_edit_btn:')) {
                const btnKey = action.split(':')[1];
                if (ui.buttons[btnKey]) {
                    adminStateMap.set(tgId, { state: `awaiting_btn_text:${btnKey}`, ts: Date.now() });
                    await tgApi('answerCallbackQuery', { callback_query_id: cb.id });
                    await tgApi('sendMessage', {
                        chat_id: chatId,
                        text:
                            `✏️ <b>Send the new Button Text for [${btnKey.toUpperCase()}]:</b>\n\n` +
                            `Current Text: <code>${escapeHtml(ui.buttons[btnKey].text)}</code>\n` +
                            `Current Custom Emoji ID: <code>${ui.buttons[btnKey].emoji_id || 'None'}</code>\n\n` +
                            `<i>Tip: Agar aap text ke saath koi bhi Telegram Custom Emoji bhejte hain, toh bot automatic uski Emoji ID nikal kar button par laga dega!</i>`,
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'm_adm_open', style: 'danger' }]]
                        }
                    });
                }
                return res.status(200).send('OK');
            }

            if (action === 'm_adm_toggle_conv_btn') {
                ui.buttons.converter.enabled = ui.buttons.converter.enabled === false ? true : false;
                await saveMainUiConfig(ui);
                await tgApi('answerCallbackQuery', {
                    callback_query_id: cb.id,
                    text: ui.buttons.converter.enabled ? '✅ Converter Button Enabled' : '❌ Converter Button Hidden'
                });
                await tgApi('editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: buildAdminDashboardText(ui),
                    parse_mode: 'HTML',
                    reply_markup: buildAdminDashboardKeyboard(ui)
                });
                return res.status(200).send('OK');
            }

            if (action === 'm_adm_toggle_chan_btn') {
                ui.buttons.channel.enabled = ui.buttons.channel.enabled === false ? true : false;
                await saveMainUiConfig(ui);
                await tgApi('answerCallbackQuery', {
                    callback_query_id: cb.id,
                    text: ui.buttons.channel.enabled ? '✅ Channel Button Enabled' : '❌ Channel Button Hidden'
                });
                await tgApi('editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: buildAdminDashboardText(ui),
                    parse_mode: 'HTML',
                    reply_markup: buildAdminDashboardKeyboard(ui)
                });
                return res.status(200).send('OK');
            }

            if (action === 'm_adm_reset_all') {
                const preservedAdmins = ui.admin_ids || [];
                const freshUi = JSON.parse(JSON.stringify(DEFAULT_MAIN_UI));
                freshUi.admin_ids = preservedAdmins;
                await saveMainUiConfig(freshUi);
                await tgApi('answerCallbackQuery', { callback_query_id: cb.id, text: '🔄 Reset to factory defaults!' });
                await tgApi('editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: buildAdminDashboardText(freshUi),
                    parse_mode: 'HTML',
                    reply_markup: buildAdminDashboardKeyboard(freshUi)
                });
                return res.status(200).send('OK');
            }

            return res.status(200).send('OK');
        }

        // --------------------------------------------------------------------
        // B. HANDLE INCOMING MESSAGES (/start, /admin, AND ADMIN INPUT STATES)
        // --------------------------------------------------------------------
        const msg = update.message;
        if (!msg || !msg.from) return res.status(200).send('OK');

        const chatId = msg.chat.id;
        const tgId = msg.from.id;
        const rawText = msg.text || msg.caption || '';
        const entities = msg.entities || msg.caption_entities || [];
        const trimmed = rawText.trim();

        const [{ ui }, settings] = await Promise.all([
            getMainUiConfig(false),
            getAppSettings()
        ]);

        const isAdmin = Array.isArray(ui.admin_ids) && ui.admin_ids.includes(Number(tgId));
        const activeState = adminStateMap.get(tgId)?.state || null;

        // 1. Handle /cancel
        if (trimmed.toLowerCase() === '/cancel') {
            adminStateMap.delete(tgId);
            await tgApi('sendMessage', {
                chat_id: chatId,
                text: '✅ Action cancelled.'
            });
            return res.status(200).send('OK');
        }

        // 2. Handle /start (with optional deep-link parameter: ref_... or link_...)
        if (trimmed.startsWith('/start')) {
            adminStateMap.delete(tgId);
            const startParam = trimmed.slice('/start'.length).trim();

            // Run user registration and welcome post sending in parallel for instant response!
            await Promise.all([
                ensureUserRegistered(msg.from, startParam),
                sendWelcomePost(chatId, msg.from, ui, settings, startParam)
            ]);
            return res.status(200).send('OK');
        }

        // 3. Handle /admin command
        if (trimmed === '/admin' || trimmed.startsWith('/admin ')) {
            const passArg = trimmed.slice('/admin'.length).trim();
            if (isAdmin || passArg === ADMIN_PASSWORD) {
                if (!isAdmin) {
                    ui.admin_ids.push(Number(tgId));
                    await saveMainUiConfig(ui);
                }
                adminStateMap.delete(tgId);
                await tgApi('sendMessage', {
                    chat_id: chatId,
                    text: buildAdminDashboardText(ui),
                    parse_mode: 'HTML',
                    reply_markup: buildAdminDashboardKeyboard(ui)
                });
                return res.status(200).send('OK');
            }

            adminStateMap.set(tgId, { state: 'awaiting_admin_pwd', ts: Date.now() });
            await tgApi('sendMessage', {
                chat_id: chatId,
                text: '🔐 <b>Bot Admin Panel Login</b>\n\nPlease enter the Admin Password:',
                parse_mode: 'HTML'
            });
            return res.status(200).send('OK');
        }

        // 4. Handle Admin Interactive States
        if (activeState === 'awaiting_admin_pwd') {
            if (trimmed === ADMIN_PASSWORD) {
                if (!ui.admin_ids.includes(Number(tgId))) {
                    ui.admin_ids.push(Number(tgId));
                    await saveMainUiConfig(ui);
                }
                adminStateMap.delete(tgId);
                await tgApi('sendMessage', {
                    chat_id: chatId,
                    text: '✅ <b>Admin Access Granted!</b>\n\n' + buildAdminDashboardText(ui),
                    parse_mode: 'HTML',
                    reply_markup: buildAdminDashboardKeyboard(ui)
                });
            } else {
                await tgApi('sendMessage', {
                    chat_id: chatId,
                    text: '❌ <b>Incorrect Password!</b> Try again or send /cancel.',
                    parse_mode: 'HTML'
                });
            }
            return res.status(200).send('OK');
        }

        if (isAdmin && activeState === 'awaiting_media') {
            if (msg.photo && msg.photo.length > 0) {
                ui.media_type = 'photo';
                ui.media_source = msg.photo[msg.photo.length - 1].file_id;
            } else if (msg.video) {
                ui.media_type = 'video';
                ui.media_source = msg.video.file_id;
            } else if (msg.animation) {
                ui.media_type = 'animation';
                ui.media_source = msg.animation.file_id;
            } else if (/^https?:\/\/\S+/i.test(trimmed)) {
                ui.media_type = /\.(mp4|mov|webm)(\?.*)?$/i.test(trimmed) ? 'video' : 'photo';
                ui.media_source = trimmed;
            } else {
                await tgApi('sendMessage', {
                    chat_id: chatId,
                    text: '⚠️ Please send a valid <b>Photo, Video, GIF</b> or direct <code>https://...</code> URL!',
                    parse_mode: 'HTML'
                });
                return res.status(200).send('OK');
            }

            adminStateMap.delete(tgId);
            await saveMainUiConfig(ui);
            await tgApi('sendMessage', {
                chat_id: chatId,
                text: `✅ <b>Welcome ${ui.media_type.toUpperCase()} Updated Successfully!</b>`,
                parse_mode: 'HTML',
                reply_markup: buildAdminDashboardKeyboard(ui)
            });
            return res.status(200).send('OK');
        }

        if (isAdmin && activeState === 'awaiting_welcome_text') {
            ui.custom_welcome_html = entitiesToHtml(rawText, entities);
            const cEmojis = extractCustomEmojis(rawText, entities);
            adminStateMap.delete(tgId);
            await saveMainUiConfig(ui);

            await tgApi('sendMessage', {
                chat_id: chatId,
                text:
                    `✅ <b>Welcome Text Updated Successfully!</b>` +
                    (cEmojis.length > 0
                        ? `\n✨ <b>Custom Emojis Saved:</b> <code>${cEmojis.map(e => e.id).join(', ')}</code>`
                        : ''),
                parse_mode: 'HTML',
                reply_markup: buildAdminDashboardKeyboard(ui)
            });
            return res.status(200).send('OK');
        }

        if (isAdmin && activeState === 'awaiting_converter_username') {
            const clean = trimmed.startsWith('@') || trimmed.startsWith('http')
                ? trimmed
                : `@${trimmed}`;
            ui.converter_bot_username = clean;
            adminStateMap.delete(tgId);
            await saveMainUiConfig(ui);

            await tgApi('sendMessage', {
                chat_id: chatId,
                text: `✅ <b>Link Converter Bot Username set to:</b> <code>${escapeHtml(clean)}</code>`,
                parse_mode: 'HTML',
                reply_markup: buildAdminDashboardKeyboard(ui)
            });
            return res.status(200).send('OK');
        }

        if (isAdmin && activeState && activeState.startsWith('awaiting_btn_text:')) {
            const btnKey = activeState.split(':')[1];
            if (ui.buttons[btnKey]) {
                const cEmojis = extractCustomEmojis(rawText, entities);
                let newLabel = rawText.trim();
                let emojiId = ui.buttons[btnKey].emoji_id;

                if (cEmojis.length > 0) {
                    emojiId = cEmojis[0].id;
                    const first = cEmojis[0];
                    const stripped = (rawText.slice(0, first.offset) + rawText.slice(first.offset + first.length)).trim();
                    if (stripped) newLabel = stripped;
                }

                ui.buttons[btnKey].text = newLabel;
                ui.buttons[btnKey].emoji_id = emojiId;
                adminStateMap.delete(tgId);
                await saveMainUiConfig(ui);

                await tgApi('sendMessage', {
                    chat_id: chatId,
                    text:
                        `✅ <b>Button Updated!</b>\n\n` +
                        `• <b>Text:</b> ${escapeHtml(newLabel)}\n` +
                        `• <b>Custom Emoji ID:</b> ${emojiId ? `<code>${emojiId}</code>` : '<i>None</i>'}`,
                    parse_mode: 'HTML',
                    reply_markup: buildAdminDashboardKeyboard(ui)
                });
                return res.status(200).send('OK');
            }
        }

        // Default response for any other text sent to Main Bot
        await sendWelcomePost(chatId, msg.from, ui, settings, '');
        return res.status(200).send('OK');
    } catch (error) {
        console.error('Main Webhook Error:', error);
        return res.status(200).send('OK');
    }
};
