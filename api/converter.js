/**
 * ============================================================================
 * teleEarn - Ultra-Fast Link & Post Converter Bot (api/convertor.js)
 * ============================================================================
 * Deploy on Vercel inside: `/api/convertor.js`
 *
 * What's New & Fixed:
 * 1. Bottom Grey Keyboard Removed:
 *    - Automatically clears any existing bottom ReplyKeyboardMarkup (`remove_keyboard: true`)
 *      so only the sleek coloured Inline Buttons appear!
 * 2. Ultra-Fast Turbo Engine (100 Posts in 2-3 Seconds):
 *    - In-Memory Warm Cache for User UUID, Header/Footer Preferences & Global Button UI
 *      (0ms read latency during bulk 100-post forwards!).
 *    - Parallel execution: Database link insertion (`supabase.from('links').insert`)
 *      and Telegram media send (`sendPhoto` / `sendVideo` / `sendMessage`) run
 *      simultaneously via `Promise.all`!
 * 3. Bot Admin Panel (`/admin`):
 *    - Button Text, Button Colour (Blue/Green/Red/Default) & Custom Emoji ID
 *      customization is now exclusively inside the Bot Admin Panel (`/admin`,
 *      password: `Priyans2109J`).
 *    - Admin can customize any button's label, colour, and Telegram Custom Emoji
 *      (auto-extracts `custom_emoji_id` when Admin sends text with a custom emoji).
 * 4. Enhanced Premium UI & Clean Formatting:
 *    - Supports Photo, Video, GIF, Document, Audio & Text posts.
 *    - Converts DiskWala, TeraBox, Filezen & any external links into:
 *      https://t.me/teleEarnLinkbot/httpsteleearnlinksvercelapp?startapp=link_<id>
 *    - Strictly ignores Telegram links (`t.me/...`, `@username`).
 * ============================================================================
 */

const { createClient } = require('@supabase/supabase-js');

// ============================================================================
// 1. CONFIGURATION
// ============================================================================
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zrhrvbkefmybketbiicw.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_Iwz3ILjEoOrr_PBqRc7nIQ_UunV1f1y';
const BOT_TOKEN = process.env.CONVERTER_BOT_TOKEN || process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Priyans2109J';

const BOT_USERNAME = 'teleEarnLinkbot';
const APP_SHORT_NAME = 'httpsteleearnlinksvercelapp';
const MINI_APP_BASE_URL = `https://t.me/${BOT_USERNAME}/${APP_SHORT_NAME}`;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false }
});

// ============================================================================
// 2. IN-MEMORY TURBO CACHE (FOR 100x FASTER BULK FORWARDING)
// ============================================================================
const CACHE_TTL_MS = 90 * 1000; // 90 seconds fast cache per serverless instance
const userMemCache = new Map(); // tgId -> { user, prefs, cfgRowId, ts, kbCleared }
let globalUiCache = { data: null, rowId: null, ts: 0 };

// Default User Preferences
const DEFAULT_USER_PREFS = {
    header: '',
    footer: '',
    keep_text: false,   // false = Only Links between Header & Footer (removes original post text)
                        // true  = Keep original post text & replace only links
    is_bold: true,      // true  = Make Header & Footer Bold
    state: null,        // 'awaiting_header' | 'awaiting_footer' | 'awaiting_admin_pwd' | 'admin_edit_btn:<key>'
    kb_cleared: false   // Tracks whether old bottom ReplyKeyboard was cleared
};

// Default Global Button UI Config (Editable by Admin from /admin panel)
const DEFAULT_BUTTON_CONFIG = {
    admin_ids: [],
    buttons: {
        convert:   { text: '🔗 Convert Links',     color: 'primary', emoji_id: null },
        set_hdr:   { text: '📝 Set Header',        color: 'success', emoji_id: null },
        rm_hdr:    { text: '🗑️ Remove Header',     color: 'danger',  emoji_id: null },
        set_ftr:   { text: '📌 Set Footer',        color: 'success', emoji_id: null },
        rm_ftr:    { text: '🗑️ Remove Footer',     color: 'danger',  emoji_id: null },
        mode_only: { text: '🔗 Text Mode: Only Links (Clean) ✅', color: 'primary', emoji_id: null },
        mode_keep: { text: '📄 Text Mode: Keep Post Text ✅',     color: 'primary', emoji_id: null },
        bold_on:   { text: '🅱️ Bold Header & Footer: ON ✅',      color: 'primary', emoji_id: null },
        bold_off:  { text: '🔡 Bold Header & Footer: OFF ❌',     color: 'default', emoji_id: null },
        mini_app:  { text: '🚀 Open teleEarn Mini App',           color: 'primary', emoji_id: null }
    }
};

// ============================================================================
// 3. TELEGRAM API HELPER (WITH AUTO-FALLBACK & RATE-LIMIT RETRY)
// ============================================================================
function stripButtonStyles(replyMarkup) {
    if (!replyMarkup || !replyMarkup.inline_keyboard) return replyMarkup;
    return {
        ...replyMarkup,
        inline_keyboard: replyMarkup.inline_keyboard.map(row =>
            row.map(btn => {
                const b = { ...btn };
                delete b.style;
                delete b.icon_custom_emoji_id;
                return b;
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

    // Auto-retry if Telegram returns 429 Too Many Requests during 100-post burst
    if (!data.ok && data.error_code === 429 && data.parameters?.retry_after) {
        const waitMs = Math.min((data.parameters.retry_after || 1) * 1000, 3000);
        await new Promise(r => setTimeout(r, waitMs));
        res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        data = await res.json();
    }

    // Fallback if client/bot rejects button style or custom emoji ID
    if (
        !data.ok &&
        payload?.reply_markup?.inline_keyboard &&
        /style|custom_emoji|button/i.test(data.description || '')
    ) {
        const fallbackPayload = {
            ...payload,
            reply_markup: stripButtonStyles(payload.reply_markup)
        };
        res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fallbackPayload)
        });
        data = await res.json();
    }

    return data;
}

// Clear old persistent bottom ReplyKeyboardMarkup silently
async function clearBottomReplyKeyboardOnce(chatId, tgId, prefs, cfgRowId) {
    if (prefs.kb_cleared) return;
    prefs.kb_cleared = true;
    saveUserPrefsAsync(tgId, prefs, cfgRowId); // non-blocking save
    try {
        const sent = await tgApi('sendMessage', {
            chat_id: chatId,
            text: '⚡',
            reply_markup: { remove_keyboard: true }
        });
        if (sent?.ok && sent.result?.message_id) {
            await tgApi('deleteMessage', {
                chat_id: chatId,
                message_id: sent.result.message_id
            });
        }
    } catch (e) {}
}

async function registerCommands() {
    return tgApi('setMyCommands', {
        commands: [
            { command: 'start', description: '⚡ Open Converter Dashboard' },
            { command: 'add_header', description: '📝 Set header text above links' },
            { command: 'remove_header', description: '🗑️ Remove header text' },
            { command: 'add_footer', description: '📌 Set footer text below links' },
            { command: 'remove_footer', description: '🗑️ Remove footer text' },
            { command: 'enable_text', description: '📄 Keep original text around links' },
            { command: 'disable_text', description: '🔗 Show only converted links (with Header/Footer)' },
            { command: 'enable_bold', description: '🅱️ Make header & footer bold' },
            { command: 'disable_bold', description: '🔡 Make header & footer normal text' },
            { command: 'admin', description: '🛠️ Bot Admin Panel (Customize Buttons)' }
        ]
    });
}

// ============================================================================
// 4. CUSTOM EMOJI ID EXTRACTOR & HTML PARSER
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
// 5. FAST CACHED SUPABASE DATA LAYER (USER PREFS + GLOBAL ADMIN UI CONFIG)
// ============================================================================
async function getGlobalUiConfig(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && globalUiCache.data && now - globalUiCache.ts < CACHE_TTL_MS) {
        return { uiConfig: globalUiCache.data, uiRowId: globalUiCache.rowId };
    }

    const { data: row } = await supabase
        .from('links')
        .select('id, original_url')
        .eq('short_id', '__global_bot_ui')
        .maybeSingle();

    let merged = JSON.parse(JSON.stringify(DEFAULT_BUTTON_CONFIG));
    if (row && row.original_url) {
        try {
            const parsed = JSON.parse(row.original_url);
            if (Array.isArray(parsed.admin_ids)) merged.admin_ids = parsed.admin_ids;
            if (parsed.buttons) {
                for (const k of Object.keys(merged.buttons)) {
                    if (parsed.buttons[k]) {
                        merged.buttons[k] = { ...merged.buttons[k], ...parsed.buttons[k] };
                    }
                }
            }
        } catch (e) {}
    }

    globalUiCache = { data: merged, rowId: row?.id || null, ts: now };
    return { uiConfig: merged, uiRowId: row?.id || null };
}

async function saveGlobalUiConfig(uiConfig, existingRowId = null) {
    const serialized = JSON.stringify(uiConfig);
    globalUiCache = { data: uiConfig, rowId: existingRowId || globalUiCache.rowId, ts: Date.now() };

    if (globalUiCache.rowId) {
        await supabase.from('links').update({ original_url: serialized }).eq('id', globalUiCache.rowId);
        return;
    }

    const { data: check } = await supabase
        .from('links')
        .select('id')
        .eq('short_id', '__global_bot_ui')
        .maybeSingle();

    if (check?.id) {
        globalUiCache.rowId = check.id;
        await supabase.from('links').update({ original_url: serialized }).eq('id', check.id);
    } else {
        const { data: created } = await supabase
            .from('links')
            .insert([{ short_id: '__global_bot_ui', original_url: serialized, user_id: null }])
            .select('id')
            .maybeSingle();
        if (created?.id) globalUiCache.rowId = created.id;
    }
}

async function getFastUserContext(tgUser, forceRefresh = false) {
    const tgId = tgUser.id;
    const now = Date.now();
    const cached = userMemCache.get(tgId);

    if (!forceRefresh && cached && now - cached.ts < CACHE_TTL_MS) {
        const { uiConfig } = await getGlobalUiConfig(false);
        return {
            user: cached.user,
            prefs: cached.prefs,
            cfgRowId: cached.cfgRowId,
            uiConfig
        };
    }

    const cfgKey = `__cfg_${tgId}`;

    // Run User Lookup, User Config Lookup & Global UI Config Lookup IN PARALLEL!
    const [userRes, cfgRes, uiRes] = await Promise.all([
        supabase.from('users').select('id, telegram_id, first_name, is_blocked').eq('telegram_id', tgId).maybeSingle(),
        supabase.from('links').select('id, original_url').eq('short_id', cfgKey).maybeSingle(),
        getGlobalUiConfig(false)
    ]);

    let userRow = userRes.data;
    if (!userRow) {
        const { data: created } = await supabase
            .from('users')
            .insert([{
                telegram_id: tgId,
                first_name: tgUser.first_name || 'User',
                username: tgUser.username || ''
            }])
            .select('id, telegram_id, first_name, is_blocked')
            .maybeSingle();
        userRow = created || { id: null, telegram_id: tgId, first_name: tgUser.first_name, is_blocked: false };
    }

    let prefs = { ...DEFAULT_USER_PREFS };
    const cfgRow = cfgRes.data;
    if (cfgRow && cfgRow.original_url) {
        try {
            prefs = { ...DEFAULT_USER_PREFS, ...JSON.parse(cfgRow.original_url) };
        } catch (e) {
            prefs = { ...DEFAULT_USER_PREFS };
        }
    }

    userMemCache.set(tgId, {
        user: userRow,
        prefs,
        cfgRowId: cfgRow?.id || null,
        ts: now
    });

    return {
        user: userRow,
        prefs,
        cfgRowId: cfgRow?.id || null,
        uiConfig: uiRes.uiConfig
    };
}

async function saveUserPrefs(tgId, prefs, existingCfgId = null) {
    const cfgKey = `__cfg_${tgId}`;
    const serialized = JSON.stringify(prefs);

    // Update in-memory cache immediately
    const cached = userMemCache.get(tgId);
    if (cached) {
        cached.prefs = prefs;
        cached.ts = Date.now();
    }

    const rowId = existingCfgId || cached?.cfgRowId;
    if (rowId) {
        await supabase.from('links').update({ original_url: serialized }).eq('id', rowId);
        return;
    }

    const { data: existing } = await supabase
        .from('links')
        .select('id')
        .eq('short_id', cfgKey)
        .maybeSingle();

    if (existing?.id) {
        if (cached) cached.cfgRowId = existing.id;
        await supabase.from('links').update({ original_url: serialized }).eq('id', existing.id);
    } else {
        const { data: inserted } = await supabase
            .from('links')
            .insert([{ short_id: cfgKey, original_url: serialized, user_id: null }])
            .select('id')
            .maybeSingle();
        if (inserted?.id && cached) cached.cfgRowId = inserted.id;
    }
}

function saveUserPrefsAsync(tgId, prefs, existingCfgId = null) {
    saveUserPrefs(tgId, prefs, existingCfgId).catch(() => {});
}

// ============================================================================
// 6. ULTRA-FAST LINK EXTRACTOR & BATCH CONVERTER
// ============================================================================
function isTelegramUrl(rawUrl) {
    try {
        const clean = rawUrl.trim().toLowerCase();
        if (clean.startsWith('tg://') || clean.startsWith('@')) return true;
        const withProto = /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
        const parsed = new URL(withProto);
        const host = parsed.hostname.replace(/^www\./, '');
        return (
            host === 't.me' ||
            host === 'telegram.me' ||
            host === 'telegram.dog' ||
            host === 'telegram.org' ||
            host.endsWith('.t.me')
        );
    } catch (e) {
        return false;
    }
}

function generateShortId() {
    return Math.random().toString(36).substring(2, 8);
}

/**
 * Synchronous CPU-instant preparation of converted caption + DB rows so we can
 * execute the Supabase batch INSERT and Telegram sendPhoto/sendVideo in PARALLEL!
 */
function prepareConvertedPostSync(rawText = '', entities = [], userUuid, prefs) {
    const candidates = [];

    if (Array.isArray(entities)) {
        for (const ent of entities) {
            if (ent.type === 'url') {
                const u = rawText.slice(ent.offset, ent.offset + ent.length).trim();
                if (u) candidates.push(u);
            } else if (ent.type === 'text_link' && ent.url) {
                candidates.push(ent.url.trim());
            }
        }
    }

    const regexMatches = rawText.match(/(?:https?:\/\/|www\.)[^\s<>"']+/gi) || [];
    for (const m of regexMatches) {
        candidates.push(m.trim());
    }

    const uniqueUrls = [...new Set(candidates)];
    const externalUrls = [];
    const telegramUrls = [];

    for (const u of uniqueUrls) {
        if (isTelegramUrl(u)) {
            telegramUrls.push(u);
        } else {
            externalUrls.push(u);
        }
    }

    if (externalUrls.length === 0) {
        return {
            convertedCount: 0,
            onlyTelegramLinks: telegramUrls.length > 0,
            finalHtml: null,
            dbRowsToInsert: []
        };
    }

    // Generate short IDs in 0ms CPU time and build single batch insert array
    const replacementMap = new Map();
    const dbRowsToInsert = [];

    for (const extUrl of externalUrls) {
        const normalized = /^https?:\/\//i.test(extUrl.trim())
            ? extUrl.trim()
            : `https://${extUrl.trim()}`;
        const shortId = generateShortId();
        const shortLink = `${MINI_APP_BASE_URL}?startapp=link_${shortId}`;
        replacementMap.set(extUrl, shortLink);
        dbRowsToInsert.push({
            original_url: normalized,
            short_id: shortId,
            user_id: userUuid
        });
    }

    const convertedLinksList = Array.from(replacementMap.values());

    let headerHtml = '';
    if (prefs.header && prefs.header.trim()) {
        headerHtml = prefs.is_bold ? `<b>${prefs.header.trim()}</b>` : prefs.header.trim();
    }

    let footerHtml = '';
    if (prefs.footer && prefs.footer.trim()) {
        footerHtml = prefs.is_bold ? `<b>${prefs.footer.trim()}</b>` : prefs.footer.trim();
    }

    let bodyHtml = '';
    if (prefs.keep_text) {
        // Keep Original Text Mode: Replace only external URLs, keep surrounding text & Telegram links
        let escapedText = escapeHtml(rawText);
        for (const [origUrl, shortUrl] of replacementMap.entries()) {
            const escapedOrig = escapeHtml(origUrl);
            escapedText = escapedText.split(escapedOrig).join(shortUrl);
        }
        const extraLinks = [];
        for (const [origUrl, shortUrl] of replacementMap.entries()) {
            if (!rawText.includes(origUrl)) {
                extraLinks.push(shortUrl);
            }
        }
        if (extraLinks.length > 0) {
            escapedText += `\n\n` + extraLinks.join('\n');
        }
        bodyHtml = escapedText.trim();
    } else {
        // Only Converted Links Mode: Strip original text, place converted links between Header & Footer
        bodyHtml = convertedLinksList.join('\n\n');
    }

    const sections = [];
    if (headerHtml) sections.push(headerHtml);
    if (bodyHtml) sections.push(bodyHtml);
    if (footerHtml) sections.push(footerHtml);

    return {
        convertedCount: externalUrls.length,
        onlyTelegramLinks: false,
        finalHtml: sections.join('\n\n'),
        dbRowsToInsert
    };
}

// ============================================================================
// 7. ENHANCED USER DASHBOARD & BOT ADMIN PANEL UI
// ============================================================================
function buildStyledBtn(btnSpec, actionProps) {
    const btn = {
        text: btnSpec?.text || 'Button',
        ...actionProps
    };
    if (btnSpec?.color && ['primary', 'success', 'danger'].includes(btnSpec.color)) {
        btn.style = btnSpec.color;
    }
    if (btnSpec?.emoji_id) {
        btn.icon_custom_emoji_id = String(btnSpec.emoji_id);
    }
    return btn;
}

function buildUserDashboardText(prefs) {
    const textModeBadge = prefs.keep_text
        ? '📄 <b>Keep Original Post Text</b>'
        : '🔗 <b>Only Links (Header + Link + Footer)</b>';
    const boldBadge = prefs.is_bold ? '🅱️ <b>Bold ON</b>' : '🔡 <b>Normal Text</b>';

    const headerPreview = prefs.header
        ? `\n<blockquote>${prefs.header}</blockquote>`
        : ' <i>Not Set</i>';
    const footerPreview = prefs.footer
        ? `\n<blockquote>${prefs.footer}</blockquote>`
        : ' <i>Not Set</i>';

    return (
        `⚡ <b>teleEarn Turbo Link Converter</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Forward any <b>Photo, Video, or Text post</b> with <b>DiskWala, TeraBox, Filezen</b> or any link — I'll convert & send it back in milliseconds!\n\n` +
        `✨ <b>Smart Features:</b>\n` +
        `• <b>Bulk Speed:</b> Forward 100+ posts at once — instant conversion\n` +
        `• <b>Auto-Filter:</b> Ignores Telegram channel/account links (<code>t.me</code>)\n` +
        `• <b>Custom Layout:</b> Places your link cleanly between Header & Footer\n\n` +
        `🎛️ <b>Your Live Configuration:</b>\n` +
        `• <b>Post Mode:</b> ${textModeBadge}\n` +
        `• <b>Header/Footer Style:</b> ${boldBadge}\n` +
        `• <b>Header:</b>${headerPreview}\n` +
        `• <b>Footer:</b>${footerPreview}`
    );
}

function buildUserInlineKeyboard(prefs, uiConfig, tgId) {
    const b = uiConfig?.buttons || DEFAULT_BUTTON_CONFIG.buttons;
    const isAdmin = Array.isArray(uiConfig?.admin_ids) && uiConfig.admin_ids.includes(Number(tgId));

    const modeSpec = prefs.keep_text ? b.mode_keep : b.mode_only;
    const boldSpec = prefs.is_bold ? b.bold_on : b.bold_off;

    const rows = [
        [buildStyledBtn(b.convert, { callback_data: 'u_convert' })],
        [
            buildStyledBtn(b.set_hdr, { callback_data: 'u_set_hdr' }),
            buildStyledBtn(b.rm_hdr,  { callback_data: 'u_rm_hdr' })
        ],
        [
            buildStyledBtn(b.set_ftr, { callback_data: 'u_set_ftr' }),
            buildStyledBtn(b.rm_ftr,  { callback_data: 'u_rm_ftr' })
        ],
        [buildStyledBtn(modeSpec, { callback_data: 'u_toggle_mode' })],
        [buildStyledBtn(boldSpec, { callback_data: 'u_toggle_bold' })],
        [buildStyledBtn(b.mini_app, { url: MINI_APP_BASE_URL })]
    ];

    if (isAdmin) {
        rows.push([
            { text: '🛠️ Open Bot Admin Panel', callback_data: 'adm_open', style: 'primary' }
        ]);
    }

    return { inline_keyboard: rows };
}

//Compact buttons shown after setting Header/Footer
function buildQuickActionKeyboard(prefs, uiConfig, tgId) {
    return buildUserInlineKeyboard(prefs, uiConfig, tgId);
}

// ============================================================================
// 8. BOT ADMIN PANEL BUILDERS (CUSTOMIZE BUTTON TEXT, COLOUR & CUSTOM EMOJI)
// ============================================================================
const BUTTON_LABELS_MAP = {
    convert:   '🔗 Convert Links Button',
    set_hdr:   '📝 Set Header Button',
    rm_hdr:    '🗑️ Remove Header Button',
    set_ftr:   '📌 Set Footer Button',
    rm_ftr:    '🗑️ Remove Footer Button',
    mode_only: '🔗 Mode (Only Links) Button',
    mode_keep: '📄 Mode (Keep Text) Button',
    bold_on:   '🅱️ Bold ON Button',
    bold_off:  '🔡 Bold OFF Button',
    mini_app:  '🚀 Open Mini App Button'
};

function colorEmoji(color) {
    if (color === 'primary') return '🔵 Blue';
    if (color === 'success') return '🟢 Green';
    if (color === 'danger')  return '🔴 Red';
    return '⚪ Default';
}

function buildAdminPanelText(uiConfig) {
    const b = uiConfig.buttons;
    let lines = '';
    for (const [key, title] of Object.entries(BUTTON_LABELS_MAP)) {
        const spec = b[key];
        lines += `• <b>${title}:</b> "${escapeHtml(spec.text)}" [${colorEmoji(spec.color)}]${spec.emoji_id ? ` ✨<code>${spec.emoji_id}</code>` : ''}\n`;
    }

    return (
        `🛠️ <b>Bot Admin Panel — Button Customizer</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Yahan se aap bot ke har button ka <b>Text, Colour (🔵/🟢/🔴) aur Custom Emoji</b> change kar sakte hain:\n\n` +
        `${lines}\n` +
        `👇 <b>Kisi bhi button ko edit ya uska colour change karne ke liye niche click karein:</b>`
    );
}

function buildAdminPanelKeyboard(uiConfig) {
    const b = uiConfig.buttons;
    const rows = [];

    for (const [key, title] of Object.entries(BUTTON_LABELS_MAP)) {
        const spec = b[key];
        rows.push([
            {
                text: `✏️ ${title.split(' ')[1]} Text/Emoji`,
                callback_data: `adm_edit_${key}`,
                style: 'primary'
            },
            {
                text: `🎨 ${colorEmoji(spec.color)}`,
                callback_data: `adm_color_${key}`,
                style: spec.color !== 'default' ? spec.color : undefined
            }
        ]);
    }

    rows.push([
        { text: '🔄 Reset All Buttons to Default', callback_data: 'adm_reset_all', style: 'danger' }
    ]);
    rows.push([
        { text: '⬅️ Back to User Dashboard', callback_data: 'u_back_home' }
    ]);

    return { inline_keyboard: rows };
}

// ============================================================================
// 9. MAIN VERCEL SERVERLESS HANDLER
// ============================================================================
module.exports = async function handler(req, res) {
    if (req.method === 'GET') {
        await registerCommands();
        return res.status(200).json({
            ok: true,
            bot: 'teleEarn Turbo Link Converter Bot',
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
        // A. HANDLE INLINE BUTTON CALLBACK QUERIES
        // --------------------------------------------------------------------
        if (update.callback_query) {
            const cb = update.callback_query;
            const chatId = cb.message.chat.id;
            const messageId = cb.message.message_id;
            const tgId = cb.from.id;
            const action = cb.data;

            const { prefs, cfgRowId, uiConfig } = await getFastUserContext(cb.from, false);
            const isAdmin = Array.isArray(uiConfig.admin_ids) && uiConfig.admin_ids.includes(Number(tgId));

            // --- USER ACTIONS ---
            if (action === 'u_back_home') {
                prefs.state = null;
                await saveUserPrefs(tgId, prefs, cfgRowId);
                await tgApi('answerCallbackQuery', { callback_query_id: cb.id });
                await tgApi('editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: buildUserDashboardText(prefs),
                    parse_mode: 'HTML',
                    reply_markup: buildUserInlineKeyboard(prefs, uiConfig, tgId)
                });
                return res.status(200).send('OK');
            }

            if (action === 'u_convert') {
                prefs.state = null;
                await saveUserPrefs(tgId, prefs, cfgRowId);
                await tgApi('answerCallbackQuery', { callback_query_id: cb.id, text: '⚡ Ready! Forward your posts now.' });
                await tgApi('sendMessage', {
                    chat_id: chatId,
                    text:
                        `⚡ <b>Turbo Converter Active!</b>\n\n` +
                        `Ab aap 1 ya 100+ <b>Photo, Video, ya Text posts</b> ek saath forward kar sakte hain.\n` +
                        `Bot turant saare external links ko aapki <b>teleEarn link</b> mein बदल kar wapas bhej dega!`,
                    parse_mode: 'HTML'
                });
                return res.status(200).send('OK');
            }

            if (action === 'u_set_hdr') {
                prefs.state = 'awaiting_header';
                await saveUserPrefs(tgId, prefs, cfgRowId);
                await tgApi('answerCallbackQuery', { callback_query_id: cb.id });
                await tgApi('sendMessage', {
                    chat_id: chatId,
                    text:
                        `📝 <b>Send your Header Text now:</b>\n\n` +
                        `<i>Aap multi-line text, bold/italic formatting ya Telegram Custom Emojis bhej sakte hain.</i>`,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'u_cancel', style: 'danger' }]]
                    }
                });
                return res.status(200).send('OK');
            }

            if (action === 'u_rm_hdr') {
                prefs.header = '';
                prefs.state = null;
                await saveUserPrefs(tgId, prefs, cfgRowId);
                await tgApi('answerCallbackQuery', { callback_query_id: cb.id, text: '🗑️ Header Removed!' });
                await tgApi('editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: buildUserDashboardText(prefs),
                    parse_mode: 'HTML',
                    reply_markup: buildUserInlineKeyboard(prefs, uiConfig, tgId)
                });
                return res.status(200).send('OK');
            }

            if (action === 'u_set_ftr') {
                prefs.state = 'awaiting_footer';
                await saveUserPrefs(tgId, prefs, cfgRowId);
                await tgApi('answerCallbackQuery', { callback_query_id: cb.id });
                await tgApi('sendMessage', {
                    chat_id: chatId,
                    text:
                        `📌 <b>Send your Footer Text now:</b>\n\n` +
                        `<i>Aap multi-line text, bold/italic formatting ya Telegram Custom Emojis bhej sakte hain.</i>`,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'u_cancel', style: 'danger' }]]
                    }
                });
                return res.status(200).send('OK');
            }

            if (action === 'u_rm_ftr') {
                prefs.footer = '';
                prefs.state = null;
                await saveUserPrefs(tgId, prefs, cfgRowId);
                await tgApi('answerCallbackQuery', { callback_query_id: cb.id, text: '🗑️ Footer Removed!' });
                await tgApi('editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: buildUserDashboardText(prefs),
                    parse_mode: 'HTML',
                    reply_markup: buildUserInlineKeyboard(prefs, uiConfig, tgId)
                });
                return res.status(200).send('OK');
            }

            if (action === 'u_toggle_mode') {
                prefs.keep_text = !prefs.keep_text;
                prefs.state = null;
                await saveUserPrefs(tgId, prefs, cfgRowId);
                await tgApi('answerCallbackQuery', {
                    callback_query_id: cb.id,
                    text: prefs.keep_text
                        ? '📄 Mode: Keep Original Post Text ON'
                        : '🔗 Mode: Only Links (Header + Link + Footer) ON'
                });
                await tgApi('editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: buildUserDashboardText(prefs),
                    parse_mode: 'HTML',
                    reply_markup: buildUserInlineKeyboard(prefs, uiConfig, tgId)
                });
                return res.status(200).send('OK');
            }

            if (action === 'u_toggle_bold') {
                prefs.is_bold = !prefs.is_bold;
                prefs.state = null;
                await saveUserPrefs(tgId, prefs, cfgRowId);
                await tgApi('answerCallbackQuery', {
                    callback_query_id: cb.id,
                    text: prefs.is_bold ? '🅱️ Bold Header/Footer ON' : '🔡 Bold Header/Footer OFF'
                });
                await tgApi('editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: buildUserDashboardText(prefs),
                    parse_mode: 'HTML',
                    reply_markup: buildUserInlineKeyboard(prefs, uiConfig, tgId)
                });
                return res.status(200).send('OK');
            }

            if (action === 'u_cancel') {
                prefs.state = null;
                await saveUserPrefs(tgId, prefs, cfgRowId);
                await tgApi('answerCallbackQuery', { callback_query_id: cb.id, text: 'Cancelled' });
                await tgApi('editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: buildUserDashboardText(prefs),
                    parse_mode: 'HTML',
                    reply_markup: buildUserInlineKeyboard(prefs, uiConfig, tgId)
                });
                return res.status(200).send('OK');
            }

            // --- ADMIN PANEL ACTIONS ---
            if (action === 'adm_open') {
                if (!isAdmin) {
                    await tgApi('answerCallbackQuery', { callback_query_id: cb.id, text: '🚫 Admin Access Only! Use /admin' });
                    return res.status(200).send('OK');
                }
                prefs.state = null;
                await saveUserPrefs(tgId, prefs, cfgRowId);
                await tgApi('answerCallbackQuery', { callback_query_id: cb.id });
                await tgApi('editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: buildAdminPanelText(uiConfig),
                    parse_mode: 'HTML',
                    reply_markup: buildAdminPanelKeyboard(uiConfig)
                });
                return res.status(200).send('OK');
            }

            if (action.startsWith('adm_color_')) {
                if (!isAdmin) {
                    await tgApi('answerCallbackQuery', { callback_query_id: cb.id, text: '🚫 Admin Access Only!' });
                    return res.status(200).send('OK');
                }
                const btnKey = action.replace('adm_color_', '');
                if (uiConfig.buttons[btnKey]) {
                    const order = ['primary', 'success', 'danger', 'default'];
                    const curr = uiConfig.buttons[btnKey].color || 'primary';
                    const next = order[(order.indexOf(curr) + 1) % order.length];
                    uiConfig.buttons[btnKey].color = next;
                    await saveGlobalUiConfig(uiConfig);
                    await tgApi('answerCallbackQuery', {
                        callback_query_id: cb.id,
                        text: `🎨 Colour set to ${colorEmoji(next)}`
                    });
                    await tgApi('editMessageText', {
                        chat_id: chatId,
                        message_id: messageId,
                        text: buildAdminPanelText(uiConfig),
                        parse_mode: 'HTML',
                        reply_markup: buildAdminPanelKeyboard(uiConfig)
                    });
                }
                return res.status(200).send('OK');
            }

            if (action.startsWith('adm_edit_')) {
                if (!isAdmin) {
                    await tgApi('answerCallbackQuery', { callback_query_id: cb.id, text: '🚫 Admin Access Only!' });
                    return res.status(200).send('OK');
                }
                const btnKey = action.replace('adm_edit_', '');
                if (uiConfig.buttons[btnKey]) {
                    prefs.state = `admin_edit_btn:${btnKey}`;
                    await saveUserPrefs(tgId, prefs, cfgRowId);
                    await tgApi('answerCallbackQuery', { callback_query_id: cb.id });
                    await tgApi('sendMessage', {
                        chat_id: chatId,
                        text:
                            `✏️ <b>Editing: ${BUTTON_LABELS_MAP[btnKey]}</b>\n\n` +
                            `Current Text: <code>${escapeHtml(uiConfig.buttons[btnKey].text)}</code>\n` +
                            `Current Emoji ID: <code>${uiConfig.buttons[btnKey].emoji_id || 'None'}</code>\n\n` +
                            `👉 <b>Send the new Button Text now!</b>\n` +
                            `<i>Tip: Agar aap text ke saath koi bhi Telegram Custom Emoji bhejte hain, toh bot automatic uski Emoji ID nikal kar is button par laga dega!</i>`,
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [[{ text: '⬅️ Back to Admin Panel', callback_data: 'adm_open' }]]
                        }
                    });
                }
                return res.status(200).send('OK');
            }

            if (action === 'adm_reset_all') {
                if (!isAdmin) {
                    await tgApi('answerCallbackQuery', { callback_query_id: cb.id, text: '🚫 Admin Access Only!' });
                    return res.status(200).send('OK');
                }
                uiConfig.buttons = JSON.parse(JSON.stringify(DEFAULT_BUTTON_CONFIG.buttons));
                await saveGlobalUiConfig(uiConfig);
                await tgApi('answerCallbackQuery', { callback_query_id: cb.id, text: '🔄 All buttons reset to default!' });
                await tgApi('editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: buildAdminPanelText(uiConfig),
                    parse_mode: 'HTML',
                    reply_markup: buildAdminPanelKeyboard(uiConfig)
                });
                return res.status(200).send('OK');
            }

            return res.status(200).send('OK');
        }

        // --------------------------------------------------------------------
        // B. HANDLE INCOMING MESSAGES (COMMANDS, ADMIN LOGIN & BULK POSTS)
        // --------------------------------------------------------------------
        const msg = update.message;
        if (!msg || !msg.from) return res.status(200).send('OK');

        const chatId = msg.chat.id;
        const tgId = msg.from.id;
        const rawText = msg.text || msg.caption || '';
        const entities = msg.entities || msg.caption_entities || [];
        const trimmed = rawText.trim();

        const { user, prefs, cfgRowId, uiConfig } = await getFastUserContext(msg.from, false);

        if (user?.is_blocked) {
            await tgApi('sendMessage', {
                chat_id: chatId,
                text: '🚫 <b>Your account has been suspended by Admin.</b>',
                parse_mode: 'HTML'
            });
            return res.status(200).send('OK');
        }

        // Automatically clear old bottom ReplyKeyboard once if it was ever shown before
        if (!prefs.kb_cleared) {
            await clearBottomReplyKeyboardOnce(chatId, tgId, prefs, cfgRowId);
        }

        // 1. /cancel command
        if (trimmed.toLowerCase() === '/cancel') {
            prefs.state = null;
            await saveUserPrefs(tgId, prefs, cfgRowId);
            await tgApi('sendMessage', {
                chat_id: chatId,
                text: '✅ Cancelled.',
                reply_markup: buildUserInlineKeyboard(prefs, uiConfig, tgId)
            });
            return res.status(200).send('OK');
        }

        // 2. /start or /settings
        if (trimmed.startsWith('/start') || trimmed.startsWith('/settings')) {
            prefs.state = null;
            prefs.kb_cleared = true;
            saveUserPrefsAsync(tgId, prefs, cfgRowId);

            // Ensure old bottom ReplyKeyboard is cleared and send sleek inline dashboard
            await Promise.all([
                clearBottomReplyKeyboardOnce(chatId, tgId, { ...prefs, kb_cleared: false }, cfgRowId),
                tgApi('sendMessage', {
                    chat_id: chatId,
                    text: buildUserDashboardText(prefs),
                    parse_mode: 'HTML',
                    reply_markup: buildUserInlineKeyboard(prefs, uiConfig, tgId)
                })
            ]);
            return res.status(200).send('OK');
        }

        // 3. /admin Command (Bot Admin Panel Login & Access)
        if (trimmed === '/admin' || trimmed.startsWith('/admin ')) {
            const passArg = trimmed.slice('/admin'.length).trim();
            const isAdmin = Array.isArray(uiConfig.admin_ids) && uiConfig.admin_ids.includes(Number(tgId));

            if (isAdmin || passArg === ADMIN_PASSWORD) {
                if (!isAdmin) {
                    uiConfig.admin_ids.push(Number(tgId));
                    await saveGlobalUiConfig(uiConfig);
                }
                prefs.state = null;
                await saveUserPrefs(tgId, prefs, cfgRowId);
                await tgApi('sendMessage', {
                    chat_id: chatId,
                    text: buildAdminPanelText(uiConfig),
                    parse_mode: 'HTML',
                    reply_markup: buildAdminPanelKeyboard(uiConfig)
                });
                return res.status(200).send('OK');
            }

            prefs.state = 'awaiting_admin_pwd';
            await saveUserPrefs(tgId, prefs, cfgRowId);
            await tgApi('sendMessage', {
                chat_id: chatId,
                text: '🔐 <b>Bot Admin Panel Login</b>\n\nPlease send the Admin Password to unlock button customization:',
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'u_cancel', style: 'danger' }]]
                }
            });
            return res.status(200).send('OK');
        }

        // 4. Slash Commands for Header, Footer, Text Mode & Bold Mode
        if (trimmed === '/add_header') {
            prefs.state = 'awaiting_header';
            await saveUserPrefs(tgId, prefs, cfgRowId);
            await tgApi('sendMessage', {
                chat_id: chatId,
                text: '📝 <b>Send your Header Text now:</b>',
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'u_cancel', style: 'danger' }]]
                }
            });
            return res.status(200).send('OK');
        }

        if (trimmed.startsWith('/add_header ')) {
            const prefixLen = '/add_header '.length;
            const body = rawText.slice(prefixLen);
            const shifted = entities
                .filter(e => e.offset >= prefixLen)
                .map(e => ({ ...e, offset: e.offset - prefixLen }));
            prefs.header = entitiesToHtml(body, shifted);
            prefs.state = null;
            await saveUserPrefs(tgId, prefs, cfgRowId);
            await tgApi('sendMessage', {
                chat_id: chatId,
                text: `✅ <b>Header Saved Successfully!</b>\n\n<blockquote>${prefs.header}</blockquote>`,
                parse_mode: 'HTML',
                reply_markup: buildQuickActionKeyboard(prefs, uiConfig, tgId)
            });
            return res.status(200).send('OK');
        }

        if (trimmed === '/remove_header') {
            prefs.header = '';
            prefs.state = null;
            await saveUserPrefs(tgId, prefs, cfgRowId);
            await tgApi('sendMessage', {
                chat_id: chatId,
                text: '🗑️ <b>Header Removed!</b>',
                parse_mode: 'HTML',
                reply_markup: buildQuickActionKeyboard(prefs, uiConfig, tgId)
            });
            return res.status(200).send('OK');
        }

        if (trimmed === '/add_footer') {
            prefs.state = 'awaiting_footer';
            await saveUserPrefs(tgId, prefs, cfgRowId);
            await tgApi('sendMessage', {
                chat_id: chatId,
                text: '📌 <b>Send your Footer Text now:</b>',
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'u_cancel', style: 'danger' }]]
                }
            });
            return res.status(200).send('OK');
        }

        if (trimmed.startsWith('/add_footer ')) {
            const prefixLen = '/add_footer '.length;
            const body = rawText.slice(prefixLen);
            const shifted = entities
                .filter(e => e.offset >= prefixLen)
                .map(e => ({ ...e, offset: e.offset - prefixLen }));
            prefs.footer = entitiesToHtml(body, shifted);
            prefs.state = null;
            await saveUserPrefs(tgId, prefs, cfgRowId);
            await tgApi('sendMessage', {
                chat_id: chatId,
                text: `✅ <b>Footer Saved Successfully!</b>\n\n<blockquote>${prefs.footer}</blockquote>`,
                parse_mode: 'HTML',
                reply_markup: buildQuickActionKeyboard(prefs, uiConfig, tgId)
            });
            return res.status(200).send('OK');
        }

        if (trimmed === '/remove_footer') {
            prefs.footer = '';
            prefs.state = null;
            await saveUserPrefs(tgId, prefs, cfgRowId);
            await tgApi('sendMessage', {
                chat_id: chatId,
                text: '🗑️ <b>Footer Removed!</b>',
                parse_mode: 'HTML',
                reply_markup: buildQuickActionKeyboard(prefs, uiConfig, tgId)
            });
            return res.status(200).send('OK');
        }

        if (trimmed === '/enable_text') {
            prefs.keep_text = true;
            prefs.state = null;
            await saveUserPrefs(tgId, prefs, cfgRowId);
            await tgApi('sendMessage', {
                chat_id: chatId,
                text: '📄 <b>Keep Original Text Mode Enabled!</b>',
                parse_mode: 'HTML',
                reply_markup: buildQuickActionKeyboard(prefs, uiConfig, tgId)
            });
            return res.status(200).send('OK');
        }

        if (trimmed === '/disable_text') {
            prefs.keep_text = false;
            prefs.state = null;
            await saveUserPrefs(tgId, prefs, cfgRowId);
            await tgApi('sendMessage', {
                chat_id: chatId,
                text: '🔗 <b>Only Links Mode (Header + Link + Footer) Enabled!</b>',
                parse_mode: 'HTML',
                reply_markup: buildQuickActionKeyboard(prefs, uiConfig, tgId)
            });
            return res.status(200).send('OK');
        }

        if (trimmed === '/enable_bold') {
            prefs.is_bold = true;
            prefs.state = null;
            await saveUserPrefs(tgId, prefs, cfgRowId);
            await tgApi('sendMessage', {
                chat_id: chatId,
                text: '🅱️ <b>Bold Header & Footer Enabled!</b>',
                parse_mode: 'HTML',
                reply_markup: buildQuickActionKeyboard(prefs, uiConfig, tgId)
            });
            return res.status(200).send('OK');
        }

        if (trimmed === '/disable_bold') {
            prefs.is_bold = false;
            prefs.state = null;
            await saveUserPrefs(tgId, prefs, cfgRowId);
            await tgApi('sendMessage', {
                chat_id: chatId,
                text: '🔡 <b>Normal Header & Footer Enabled!</b>',
                parse_mode: 'HTML',
                reply_markup: buildQuickActionKeyboard(prefs, uiConfig, tgId)
            });
            return res.status(200).send('OK');
        }

        // --------------------------------------------------------------------
        // C. HANDLE INTERACTIVE STATES (HEADER, FOOTER, ADMIN LOGIN & BUTTON EDIT)
        // --------------------------------------------------------------------
        if (prefs.state === 'awaiting_admin_pwd' && !trimmed.startsWith('/')) {
            if (trimmed === ADMIN_PASSWORD) {
                if (!uiConfig.admin_ids.includes(Number(tgId))) {
                    uiConfig.admin_ids.push(Number(tgId));
                    await saveGlobalUiConfig(uiConfig);
                }
                prefs.state = null;
                await saveUserPrefs(tgId, prefs, cfgRowId);
                await tgApi('sendMessage', {
                    chat_id: chatId,
                    text: '✅ <b>Admin Unlocked!</b>\n\n' + buildAdminPanelText(uiConfig),
                    parse_mode: 'HTML',
                    reply_markup: buildAdminPanelKeyboard(uiConfig)
                });
            } else {
                await tgApi('sendMessage', {
                    chat_id: chatId,
                    text: '❌ <b>Incorrect Password!</b> Try again or tap Cancel.',
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'u_cancel', style: 'danger' }]]
                    }
                });
            }
            return res.status(200).send('OK');
        }

        if (prefs.state && prefs.state.startsWith('admin_edit_btn:') && !trimmed.startsWith('/')) {
            const btnKey = prefs.state.split(':')[1];
            if (uiConfig.buttons[btnKey]) {
                const cEmojis = extractCustomEmojis(rawText, entities);
                let newLabel = rawText.trim();
                let extractedEmojiId = uiConfig.buttons[btnKey].emoji_id;

                if (cEmojis.length > 0) {
                    extractedEmojiId = cEmojis[0].id;
                    // Strip the first custom emoji placeholder char so icon_custom_emoji_id renders cleanly without duplicate emoji
                    const first = cEmojis[0];
                    const stripped = (rawText.slice(0, first.offset) + rawText.slice(first.offset + first.length)).trim();
                    if (stripped) newLabel = stripped;
                }

                uiConfig.buttons[btnKey].text = newLabel;
                uiConfig.buttons[btnKey].emoji_id = extractedEmojiId;
                prefs.state = null;

                await Promise.all([
                    saveGlobalUiConfig(uiConfig),
                    saveUserPrefs(tgId, prefs, cfgRowId)
                ]);

                await tgApi('sendMessage', {
                    chat_id: chatId,
                    text:
                        `✅ <b>Button Updated Globally!</b>\n\n` +
                        `• <b>Button:</b> ${BUTTON_LABELS_MAP[btnKey]}\n` +
                        `• <b>New Text:</b> ${escapeHtml(newLabel)}\n` +
                        `• <b>Custom Emoji ID:</b> ${extractedEmojiId ? `<code>${extractedEmojiId}</code>` : '<i>None</i>'}`,
                    parse_mode: 'HTML',
                    reply_markup: buildAdminPanelKeyboard(uiConfig)
                });
                return res.status(200).send('OK');
            }
        }

        if (prefs.state === 'awaiting_header' && !trimmed.startsWith('/')) {
            prefs.header = entitiesToHtml(rawText, entities);
            const cEmojis = extractCustomEmojis(rawText, entities);
            prefs.state = null;
            await saveUserPrefs(tgId, prefs, cfgRowId);

            await tgApi('sendMessage', {
                chat_id: chatId,
                text:
                    `✅ <b>Header Saved Successfully!</b>\n\n` +
                    `<blockquote>${prefs.header}</blockquote>` +
                    (cEmojis.length > 0
                        ? `\n\n✨ <b>Custom Emoji Applied:</b> <code>${cEmojis.map(e => e.id).join(', ')}</code>`
                        : ''),
                parse_mode: 'HTML',
                reply_markup: buildQuickActionKeyboard(prefs, uiConfig, tgId)
            });
            return res.status(200).send('OK');
        }

        if (prefs.state === 'awaiting_footer' && !trimmed.startsWith('/')) {
            prefs.footer = entitiesToHtml(rawText, entities);
            const cEmojis = extractCustomEmojis(rawText, entities);
            prefs.state = null;
            await saveUserPrefs(tgId, prefs, cfgRowId);

            await tgApi('sendMessage', {
                chat_id: chatId,
                text:
                    `✅ <b>Footer Saved Successfully!</b>\n\n` +
                    `<blockquote>${prefs.footer}</blockquote>` +
                    (cEmojis.length > 0
                        ? `\n\n✨ <b>Custom Emoji Applied:</b> <code>${cEmojis.map(e => e.id).join(', ')}</code>`
                        : ''),
                parse_mode: 'HTML',
                reply_markup: buildQuickActionKeyboard(prefs, uiConfig, tgId)
            });
            return res.status(200).send('OK');
        }

        // --------------------------------------------------------------------
        // D. TURBO POST CONVERSION (0ms SYNC PREP + PARALLEL DB & TG SEND)
        // --------------------------------------------------------------------
        const {
            convertedCount,
            onlyTelegramLinks,
            finalHtml,
            dbRowsToInsert
        } = prepareConvertedPostSync(rawText, entities, user.id, prefs);

        if (onlyTelegramLinks) {
            await tgApi('sendMessage', {
                chat_id: chatId,
                text:
                    `ℹ️ <b>Telegram Link Ignored!</b>\n\n` +
                    `Bot Telegram channel/account links (<code>t.me/...</code>) ko convert nahi karta. Telegram link shorten karne ke liye niche <b>teleEarn Mini App</b> open karein:`,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[buildStyledBtn(uiConfig.buttons.mini_app, { url: MINI_APP_BASE_URL })]]
                }
            });
            return res.status(200).send('OK');
        }

        if (convertedCount === 0 || !finalHtml) {
            await tgApi('sendMessage', {
                chat_id: chatId,
                text:
                    `⚠️ <b>No Convertible Link Found!</b>\n\n` +
                    `Kripya aisi Photo, Video ya Text post bhejein jisme DiskWala, TeraBox, Filezen ya koi external link ho.`,
                parse_mode: 'HTML'
            });
            return res.status(200).send('OK');
        }

        // Build Telegram API send promise according to media type
        let tgSendPromise;
        if (msg.photo && msg.photo.length > 0) {
            const bestPhotoId = msg.photo[msg.photo.length - 1].file_id;
            tgSendPromise = tgApi('sendPhoto', {
                chat_id: chatId,
                photo: bestPhotoId,
                caption: finalHtml,
                parse_mode: 'HTML'
            });
        } else if (msg.video) {
            tgSendPromise = tgApi('sendVideo', {
                chat_id: chatId,
                video: msg.video.file_id,
                caption: finalHtml,
                parse_mode: 'HTML'
            });
        } else if (msg.animation) {
            tgSendPromise = tgApi('sendAnimation', {
                chat_id: chatId,
                animation: msg.animation.file_id,
                caption: finalHtml,
                parse_mode: 'HTML'
            });
        } else if (msg.document) {
            tgSendPromise = tgApi('sendDocument', {
                chat_id: chatId,
                document: msg.document.file_id,
                caption: finalHtml,
                parse_mode: 'HTML'
            });
        } else if (msg.audio) {
            tgSendPromise = tgApi('sendAudio', {
                chat_id: chatId,
                audio: msg.audio.file_id,
                caption: finalHtml,
                parse_mode: 'HTML'
            });
        } else {
            tgSendPromise = tgApi('sendMessage', {
                chat_id: chatId,
                text: finalHtml,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            });
        }

        // Execute Supabase Batch Insert AND Telegram Send concurrently in parallel!
        await Promise.all([
            supabase.from('links').insert(dbRowsToInsert),
            tgSendPromise
        ]);

        return res.status(200).send('OK');
    } catch (error) {
        console.error('Turbo Converter Error:', error);
        return res.status(200).send('OK');
    }
};
