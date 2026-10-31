/**
 * ============================================================================
 * teleEarn - Advanced Link & Post Converter Bot (api/convertor.js)
 * ============================================================================
 * Deploy on Vercel inside `/api/convertor.js`
 *
 * Key Features:
 * 1. Converts any post (Photo, Video, Document, Animation/GIF, Audio, or Text)
 *    containing DiskWala, TeraBox, Filezen, or any external URL into the user's
 *    own direct teleEarn Mini App link:
 *    https://t.me/teleEarnLinkbot/httpsteleearnlinksvercelapp?startapp=link_<id>
 * 2. Automatically ignores Telegram links (t.me, telegram.me, telegram.dog, @username).
 *    If a post only has Telegram links, guides the user to use the Mini App.
 * 3. Interactive Dashboard on /start with 1-Tap Buttons for all features:
 *    - Convert Links
 *    - Set Header / Remove Header (Interactive step — no "/add_header TEXT" needed!)
 *    - Set Footer / Remove Footer (Interactive step — no "/add_footer TEXT" needed!)
 *    - Mode Toggle: "Only Links (Header + Link + Footer)" vs "Keep Original Text"
 *    - Bold Toggle: Make Header & Footer Bold ON/OFF
 *    - Button Customizer: Customize Button Text, Colour (Blue/Green/Red) & Custom Emoji
 * 4. Automatic Custom Emoji ID Extractor:
 *    - Whenever you send text with a Telegram Premium Custom Emoji (in Header,
 *      Footer, or Button Text), the bot automatically extracts `custom_emoji_id`
 *      from `msg.entities` and applies `<tg-emoji emoji-id="...">` in text/captions
 *      and `icon_custom_emoji_id` on buttons.
 * 5. Zero-Migration Persistent Storage in Supabase:
 *    - Saves Header, Footer, Mode, Button Colour & Emoji ID reliably in Supabase
 *      using a reserved config record (`__cfg_<telegram_id>`) so settings never
 *      disappear across Vercel serverless restarts.
 * ============================================================================
 */

const { createClient } = require('@supabase/supabase-js');

// ============================================================================
// 1. CONFIGURATION
// ============================================================================
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zrhrvbkefmybketbiicw.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_Iwz3ILjEoOrr_PBqRc7nIQ_UunV1f1y';

// Set CONVERTER_BOT_TOKEN (or BOT_TOKEN) in your Vercel Environment Variables
const BOT_TOKEN = process.env.CONVERTER_BOT_TOKEN || process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE';

const BOT_USERNAME = 'teleEarnLinkbot';
const APP_SHORT_NAME = 'httpsteleearnlinksvercelapp';
const MINI_APP_BASE_URL = `https://t.me/${BOT_USERNAME}/${APP_SHORT_NAME}`;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const DEFAULT_PREFS = {
    header: '',
    footer: '',
    keep_text: false,       // false = Remove original post text; place ONLY converted links between Header & Footer
                            // true  = Keep original post text & only replace external links
    is_bold: true,          // true  = Bold Header & Footer
    state: null,            // 'awaiting_header' | 'awaiting_footer' | 'awaiting_btn_custom'
    btn_color: 'primary',   // 'primary' (Blue), 'success' (Green), 'danger' (Red), 'default'
    btn_emoji_id: null,     // Auto-extracted custom_emoji_id for buttons
    custom_btn_enabled: false,
    custom_btn_text: '👉 Open Link 👈',
    custom_btn_url: ''
};

// ============================================================================
// 2. TELEGRAM BOT API HELPER (WITH AUTO-FALLBACK SAFETY)
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

    // Fallback if Telegram rejects custom button style/icon_custom_emoji_id on older clients
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

    if (!data.ok) {
        console.error(`Telegram API Error [${method}]:`, data.description);
    }
    return data;
}

// Registers clean slash commands (without "TEXT" in command names)
async function registerCommands() {
    return tgApi('setMyCommands', {
        commands: [
            { command: 'start', description: '🚀 Open Converter Dashboard & Buttons' },
            { command: 'add_header', description: '📝 Set header text above converted links' },
            { command: 'remove_header', description: '🗑️ Remove header text' },
            { command: 'add_footer', description: '📌 Set footer text below converted links' },
            { command: 'remove_footer', description: '🗑️ Remove footer text' },
            { command: 'enable_text', description: '📄 Keep original text around links' },
            { command: 'disable_text', description: '🔗 Show only converted links (with Header/Footer)' },
            { command: 'enable_bold', description: '🅱️ Make header & footer bold' },
            { command: 'disable_bold', description: '🔡 Make header & footer normal text' }
        ]
    });
}

// ============================================================================
// 3. AUTOMATIC CUSTOM EMOJI ID EXTRACTOR & HTML FORMATTER
// ============================================================================
function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Automatically finds all Telegram Premium Custom Emojis (`type === 'custom_emoji'`)
 * in `msg.entities` or `msg.caption_entities` and extracts their `custom_emoji_id`.
 */
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

/**
 * Converts Telegram text + entities into HTML while automatically wrapping every
 * custom emoji in `<tg-emoji emoji-id="ID">char</tg-emoji>` so custom emojis
 * render in headers, footers, and converted posts!
 */
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
// 4. SUPABASE STORAGE (PERSISTENT HEADER/FOOTER WITHOUT SCHEMA ERRORS)
// ============================================================================
async function getOrCreateUserAndPrefs(tgUser) {
    const tgId = tgUser.id;

    // 1. Ensure user exists in `users` table
    let { data: userRow } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', tgId)
        .maybeSingle();

    if (!userRow) {
        const { data: created } = await supabase
            .from('users')
            .insert([{
                telegram_id: tgId,
                first_name: tgUser.first_name || 'User',
                username: tgUser.username || ''
            }])
            .select('*')
            .maybeSingle();
        userRow = created || { id: null, telegram_id: tgId, first_name: tgUser.first_name };
    }

    // 2. Load converter preferences from reserved config entry `__cfg_<tgId>` in `links`
    // (`user_id: null` keeps it completely hidden from the user's "My Links" list in Mini App)
    const cfgKey = `__cfg_${tgId}`;
    const { data: cfgRow } = await supabase
        .from('links')
        .select('id, original_url')
        .eq('short_id', cfgKey)
        .maybeSingle();

    let prefs = { ...DEFAULT_PREFS };
    if (cfgRow && cfgRow.original_url) {
        try {
            prefs = { ...DEFAULT_PREFS, ...JSON.parse(cfgRow.original_url) };
        } catch (e) {
            prefs = { ...DEFAULT_PREFS };
        }
    }

    return { user: userRow, prefs, cfgRowId: cfgRow?.id || null };
}

async function saveUserPrefs(tgId, prefs, existingCfgId = null) {
    const cfgKey = `__cfg_${tgId}`;
    const serialized = JSON.stringify(prefs);

    if (existingCfgId) {
        await supabase
            .from('links')
            .update({ original_url: serialized })
            .eq('id', existingCfgId);
        return;
    }

    const { data: existing } = await supabase
        .from('links')
        .select('id')
        .eq('short_id', cfgKey)
        .maybeSingle();

    if (existing?.id) {
        await supabase
            .from('links')
            .update({ original_url: serialized })
            .eq('id', existing.id);
    } else {
        await supabase
            .from('links')
            .insert([{
                short_id: cfgKey,
                original_url: serialized,
                user_id: null
            }]);
    }
}

// ============================================================================
// 5. LINK EXTRACTOR, TELEGRAM FILTER & TELEEARN SHORTENER
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

async function createTeleEarnShortLink(originalUrl, userUuid) {
    const normalized = /^https?:\/\//i.test(originalUrl.trim())
        ? originalUrl.trim()
        : `https://${originalUrl.trim()}`;
    const shortId = generateShortId();

    await supabase.from('links').insert([{
        original_url: normalized,
        short_id: shortId,
        user_id: userUuid
    }]);

    return `${MINI_APP_BASE_URL}?startapp=link_${shortId}`;
}

/**
 * Extracts all URLs from message text and entities, ignores Telegram links
 * (`t.me/...`), converts all external links (DiskWala, TeraBox, Filezen, etc.)
 * into direct teleEarn Mini App links, and builds the final HTML caption/message.
 */
async function convertPostContent(rawText = '', entities = [], userUuid, prefs) {
    const candidates = [];

    // 1. Collect URLs from Telegram `url` and `text_link` entities
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

    // 2. Also match http/https or known file-host domains via regex
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
            firstConvertedLink: null
        };
    }

    // Shorten all external links in parallel
    const replacementMap = new Map();
    await Promise.all(
        externalUrls.map(async (extUrl) => {
            const shortLink = await createTeleEarnShortLink(extUrl, userUuid);
            replacementMap.set(extUrl, shortLink);
        })
    );

    const convertedLinksList = Array.from(replacementMap.values());

    // Prepare Header & Footer blocks
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
        // KEEP ORIGINAL TEXT MODE:
        // Keep everything as written in the post, only replace external URLs with teleEarn links.
        // Telegram channel/account links remain untouched.
        let escapedText = escapeHtml(rawText);
        for (const [origUrl, shortUrl] of replacementMap.entries()) {
            const escapedOrig = escapeHtml(origUrl);
            escapedText = escapedText.split(escapedOrig).join(shortUrl);
        }
        // Append any hidden text_link URLs that weren't literal substrings in rawText
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
        // ONLY CONVERTED LINKS MODE (Default requested behaviour):
        // Remove all original caption text & Telegram channel links, and place ONLY
        // the converted teleEarn link(s) in the middle between Header and Footer!
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
        firstConvertedLink: convertedLinksList[0] || null
    };
}

// ============================================================================
// 6. UI & BUTTON BUILDERS (WITH COLOUR & CUSTOM EMOJI ID SUPPORT)
// ============================================================================
function createColoredButton(text, actionProps, styleColor = null, customEmojiId = null) {
    const btn = { text, ...actionProps };
    if (styleColor && ['primary', 'success', 'danger'].includes(styleColor)) {
        btn.style = styleColor;
    }
    if (customEmojiId) {
        btn.icon_custom_emoji_id = String(customEmojiId);
    }
    return btn;
}

function buildDashboardMessage(prefs) {
    const modeDesc = prefs.keep_text
        ? '📄 <b>Keep Original Text</b> (Replaces only links)'
        : '🔗 <b>Only Links + Header/Footer</b> (Removes original text)';
    const boldDesc = prefs.is_bold ? '✅ <b>Bold ON</b>' : '🔡 <b>Normal Text</b>';
    const colorName =
        prefs.btn_color === 'primary' ? '🔵 Blue (Primary)' :
        prefs.btn_color === 'success' ? '🟢 Green (Success)' :
        prefs.btn_color === 'danger'  ? '🔴 Red (Danger)' : '⚪ Default';

    const headerBox = prefs.header
        ? `\n<blockquote>${prefs.header}</blockquote>`
        : ' <i>Not Set</i>';
    const footerBox = prefs.footer
        ? `\n<blockquote>${prefs.footer}</blockquote>`
        : ' <i>Not Set</i>';

    return (
        `⚡ <b>Welcome to teleEarn Link Converter Bot!</b>\n\n` +
        `Send me posts from <b>DiskWala, TeraBox, Filezen</b> or any link and I'll convert them into <b>your own teleEarn links</b>.\n\n` +
        `✨ <b>How it works:</b>\n` +
        `• Send one or multiple URLs, or forward a complete <b>Photo / Video post</b>\n` +
        `• Extracts & converts links into:\n  <code>${MINI_APP_BASE_URL}?startapp=link_...</code>\n` +
        `• Ignores Telegram channel/account links (<code>t.me/...</code>)\n` +
        `• Places converted links between your <b>Header</b> & <b>Footer</b>!\n\n` +
        `⚙️ <b>Your Current Settings:</b>\n` +
        `• <b>Text Mode:</b> ${modeDesc}\n` +
        `• <b>Header/Footer Style:</b> ${boldDesc}\n` +
        `• <b>Button Colour:</b> ${colorName}\n` +
        `• <b>Button Custom Emoji ID:</b> ${prefs.btn_emoji_id ? `<code>${prefs.btn_emoji_id}</code>` : '<i>Auto / None</i>'}\n` +
        `• <b>Header:</b>${headerBox}\n` +
        `• <b>Footer:</b>${footerBox}\n\n` +
        `👇 <b>Tap any button below to control your settings:</b>`
    );
}

function buildDashboardInlineKeyboard(prefs) {
    const emojiId = prefs.btn_emoji_id || null;
    const userColor = prefs.btn_color || 'primary';

    const textToggleBtnLabel = prefs.keep_text
        ? '📄 Text Mode: Keep Original Text ✅'
        : '🔗 Text Mode: Only Links (Remove Text) ✅';

    const boldToggleBtnLabel = prefs.is_bold
        ? '🅱️ Bold Header & Footer: ON ✅'
        : '🔡 Bold Header & Footer: OFF ❌';

    const colorBtnLabel =
        prefs.btn_color === 'primary' ? '🎨 Button Colour: Blue 🔵' :
        prefs.btn_color === 'success' ? '🎨 Button Colour: Green 🟢' :
        prefs.btn_color === 'danger'  ? '🎨 Button Colour: Red 🔴' :
                                        '🎨 Button Colour: Default ⚪';

    return {
        inline_keyboard: [
            [
                createColoredButton('🔗 Convert Links', { callback_data: 'ui_convert' }, userColor, emojiId)
            ],
            [
                createColoredButton('📝 Set Header', { callback_data: 'ui_set_header' }, 'success', emojiId),
                createColoredButton('🗑️ Remove Header', { callback_data: 'ui_rm_header' }, 'danger', null)
            ],
            [
                createColoredButton('📌 Set Footer', { callback_data: 'ui_set_footer' }, 'success', emojiId),
                createColoredButton('🗑️ Remove Footer', { callback_data: 'ui_rm_footer' }, 'danger', null)
            ],
            [
                createColoredButton(textToggleBtnLabel, { callback_data: 'ui_toggle_text' }, userColor, null)
            ],
            [
                createColoredButton(boldToggleBtnLabel, { callback_data: 'ui_toggle_bold' }, userColor, null)
            ],
            [
                createColoredButton(colorBtnLabel, { callback_data: 'ui_cycle_color' }, userColor, null),
                createColoredButton('✨ Button Text & Emoji', { callback_data: 'ui_set_btn_emoji' }, userColor, emojiId)
            ],
            [
                createColoredButton(
                    prefs.custom_btn_enabled ? '🔘 Post Button: ON ✅' : '🔘 Post Button: OFF ❌',
                    { callback_data: 'ui_toggle_post_btn' },
                    prefs.custom_btn_enabled ? 'success' : 'default',
                    emojiId
                )
            ],
            [
                createColoredButton('🚀 Open teleEarn Mini App', { url: MINI_APP_BASE_URL }, 'primary', emojiId)
            ]
        ]
    };
}

function buildPersistentReplyKeyboard(prefs) {
    return {
        keyboard: [
            [
                { text: '🔗 Convert Links' },
                { text: '⚙️ Dashboard' }
            ],
            [
                { text: '📝 Set Header' },
                { text: '📌 Set Footer' }
            ],
            [
                { text: '🗑️ Remove Header' },
                { text: '🗑️ Remove Footer' }
            ],
            [
                { text: prefs.keep_text ? '🔗 Disable Text (Only Links)' : '📄 Enable Text (Keep Post)' },
                { text: prefs.is_bold ? '🔡 Disable Bold' : '🅱️ Enable Bold' }
            ]
        ],
        resize_keyboard: true,
        is_persistent: true
    };
}

function buildConvertedPostMarkup(prefs, firstConvertedLink) {
    if (!prefs.custom_btn_enabled) return undefined;
    const targetUrl = prefs.custom_btn_url || firstConvertedLink || MINI_APP_BASE_URL;
    return {
        inline_keyboard: [
            [
                createColoredButton(
                    prefs.custom_btn_text || '👉 Open Link 👈',
                    { url: targetUrl },
                    prefs.btn_color,
                    prefs.btn_emoji_id
                )
            ]
        ]
    };
}

// ============================================================================
// 7. VERCEL SERVERLESS WEBHOOK HANDLER
// ============================================================================
module.exports = async function handler(req, res) {
    if (req.method === 'GET') {
        await registerCommands();
        return res.status(200).json({
            ok: true,
            bot: 'teleEarn Link Converter Bot',
            message: 'Webhook endpoint is live and commands are registered!'
        });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const update = req.body;
        if (!update) return res.status(200).send('OK');

        // --------------------------------------------------------------------
        // A. HANDLE INLINE KEYBOARD BUTTON CLICKS
        // --------------------------------------------------------------------
        if (update.callback_query) {
            const cb = update.callback_query;
            const chatId = cb.message.chat.id;
            const messageId = cb.message.message_id;
            const action = cb.data;

            const { prefs, cfgRowId } = await getOrCreateUserAndPrefs(cb.from);

            if (action === 'ui_convert') {
                prefs.state = null;
                await saveUserPrefs(cb.from.id, prefs, cfgRowId);
                await tgApi('answerCallbackQuery', { callback_query_id: cb.id, text: 'Ready! Send any post or link.' });
                await tgApi('sendMessage', {
                    chat_id: chatId,
                    text:
                        `📤 <b>Send or Forward your Post / Link now!</b>\n\n` +
                        `• Supports <b>Photo, Video, GIF, Document & Text</b> posts\n` +
                        `• Converts DiskWala, TeraBox, Filezen & other links into your teleEarn link\n` +
                        `• Automatically adds your Header & Footer!`,
                    parse_mode: 'HTML'
                });
                return res.status(200).send('OK');
            }

            if (action === 'ui_set_header') {
                prefs.state = 'awaiting_header';
                await saveUserPrefs(cb.from.id, prefs, cfgRowId);
                await tgApi('answerCallbackQuery', { callback_query_id: cb.id });
                await tgApi('sendMessage', {
                    chat_id: chatId,
                    text:
                        `📝 <b>Send your Header text now:</b>\n\n` +
                        `<i>You can include multi-line text, formatting, or Telegram Custom Emojis (I will automatically extract their Emoji ID and apply them!).</i>`,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'ui_cancel' }]]
                    }
                });
                return res.status(200).send('OK');
            }

            if (action === 'ui_rm_header') {
                prefs.header = '';
                prefs.state = null;
                await saveUserPrefs(cb.from.id, prefs, cfgRowId);
                await tgApi('answerCallbackQuery', { callback_query_id: cb.id, text: '🗑️ Header Removed!' });
                await tgApi('editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: buildDashboardMessage(prefs),
                    parse_mode: 'HTML',
                    reply_markup: buildDashboardInlineKeyboard(prefs)
                });
                return res.status(200).send('OK');
            }

            if (action === 'ui_set_footer') {
                prefs.state = 'awaiting_footer';
                await saveUserPrefs(cb.from.id, prefs, cfgRowId);
                await tgApi('answerCallbackQuery', { callback_query_id: cb.id });
                await tgApi('sendMessage', {
                    chat_id: chatId,
                    text:
                        `📌 <b>Send your Footer text now:</b>\n\n` +
                        `<i>You can include multi-line text, formatting, or Telegram Custom Emojis (I will automatically extract their Emoji ID and apply them!).</i>`,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'ui_cancel' }]]
                    }
                });
                return res.status(200).send('OK');
            }

            if (action === 'ui_rm_footer') {
                prefs.footer = '';
                prefs.state = null;
                await saveUserPrefs(cb.from.id, prefs, cfgRowId);
                await tgApi('answerCallbackQuery', { callback_query_id: cb.id, text: '🗑️ Footer Removed!' });
                await tgApi('editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: buildDashboardMessage(prefs),
                    parse_mode: 'HTML',
                    reply_markup: buildDashboardInlineKeyboard(prefs)
                });
                return res.status(200).send('OK');
            }

            if (action === 'ui_toggle_text') {
                prefs.keep_text = !prefs.keep_text;
                prefs.state = null;
                await saveUserPrefs(cb.from.id, prefs, cfgRowId);
                await tgApi('answerCallbackQuery', {
                    callback_query_id: cb.id,
                    text: prefs.keep_text
                        ? '📄 Keep Original Text ON'
                        : '🔗 Only Links (Remove Post Text) ON'
                });
                await tgApi('editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: buildDashboardMessage(prefs),
                    parse_mode: 'HTML',
                    reply_markup: buildDashboardInlineKeyboard(prefs)
                });
                return res.status(200).send('OK');
            }

            if (action === 'ui_toggle_bold') {
                prefs.is_bold = !prefs.is_bold;
                prefs.state = null;
                await saveUserPrefs(cb.from.id, prefs, cfgRowId);
                await tgApi('answerCallbackQuery', {
                    callback_query_id: cb.id,
                    text: prefs.is_bold ? '🅱️ Bold Header/Footer ON' : '🔡 Bold Header/Footer OFF'
                });
                await tgApi('editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: buildDashboardMessage(prefs),
                    parse_mode: 'HTML',
                    reply_markup: buildDashboardInlineKeyboard(prefs)
                });
                return res.status(200).send('OK');
            }

            if (action === 'ui_cycle_color') {
                const colors = ['primary', 'success', 'danger', 'default'];
                const nextColor = colors[(colors.indexOf(prefs.btn_color) + 1) % colors.length];
                prefs.btn_color = nextColor;
                await saveUserPrefs(cb.from.id, prefs, cfgRowId);
                await tgApi('answerCallbackQuery', {
                    callback_query_id: cb.id,
                    text: `🎨 Button Colour changed to ${nextColor.toUpperCase()}`
                });
                await tgApi('editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: buildDashboardMessage(prefs),
                    parse_mode: 'HTML',
                    reply_markup: buildDashboardInlineKeyboard(prefs)
                });
                return res.status(200).send('OK');
            }

            if (action === 'ui_set_btn_emoji') {
                prefs.state = 'awaiting_btn_custom';
                await saveUserPrefs(cb.from.id, prefs, cfgRowId);
                await tgApi('answerCallbackQuery', { callback_query_id: cb.id });
                await tgApi('sendMessage', {
                    chat_id: chatId,
                    text:
                        `✨ <b>Customize Button Text & Custom Emoji:</b>\n\n` +
                        `Send your button label along with any <b>Telegram Custom Emoji</b> (for example: <code>🔥 Watch Full Video</code>).\n\n` +
                        `I will automatically extract the Custom Emoji's ID and attach it to your buttons + update your Post Button text!\n\n` +
                        `<i>(Send <code>clear</code> to remove the custom emoji).</i>`,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'ui_cancel' }]]
                    }
                });
                return res.status(200).send('OK');
            }

            if (action === 'ui_toggle_post_btn') {
                prefs.custom_btn_enabled = !prefs.custom_btn_enabled;
                await saveUserPrefs(cb.from.id, prefs, cfgRowId);
                await tgApi('answerCallbackQuery', {
                    callback_query_id: cb.id,
                    text: prefs.custom_btn_enabled
                        ? '🔘 Post Button Enabled (Added below converted posts)'
                        : '🔘 Post Button Disabled'
                });
                await tgApi('editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: buildDashboardMessage(prefs),
                    parse_mode: 'HTML',
                    reply_markup: buildDashboardInlineKeyboard(prefs)
                });
                return res.status(200).send('OK');
            }

            if (action === 'ui_cancel') {
                prefs.state = null;
                await saveUserPrefs(cb.from.id, prefs, cfgRowId);
                await tgApi('answerCallbackQuery', { callback_query_id: cb.id, text: 'Cancelled' });
                await tgApi('editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: buildDashboardMessage(prefs),
                    parse_mode: 'HTML',
                    reply_markup: buildDashboardInlineKeyboard(prefs)
                });
                return res.status(200).send('OK');
            }

            return res.status(200).send('OK');
        }

        // --------------------------------------------------------------------
        // B. HANDLE INCOMING MESSAGES (COMMANDS, BUTTON REPLIES & POSTS)
        // --------------------------------------------------------------------
        const msg = update.message;
        if (!msg || !msg.from) return res.status(200).send('OK');

        const chatId = msg.chat.id;
        const rawText = msg.text || msg.caption || '';
        const entities = msg.entities || msg.caption_entities || [];
        const trimmed = rawText.trim();

        const { user, prefs, cfgRowId } = await getOrCreateUserAndPrefs(msg.from);

        if (user?.is_blocked) {
            await tgApi('sendMessage', {
                chat_id: chatId,
                text: '🚫 <b>Your account has been blocked by the administrator.</b>',
                parse_mode: 'HTML'
            });
            return res.status(200).send('OK');
        }

        // 1. /cancel command
        if (trimmed.toLowerCase() === '/cancel') {
            prefs.state = null;
            await saveUserPrefs(msg.from.id, prefs, cfgRowId);
            await tgApi('sendMessage', {
                chat_id: chatId,
                text: '✅ Cancelled.',
                reply_markup: buildDashboardInlineKeyboard(prefs)
            });
            return res.status(200).send('OK');
        }

        // 2. /start or ⚙️ Dashboard
        if (
            trimmed.startsWith('/start') ||
            trimmed.startsWith('/settings') ||
            trimmed === '⚙️ Dashboard'
        ) {
            prefs.state = null;
            await saveUserPrefs(msg.from.id, prefs, cfgRowId);
            await registerCommands();

            await tgApi('sendMessage', {
                chat_id: chatId,
                text: '⚡ <b>teleEarn Link Converter Ready!</b>',
                parse_mode: 'HTML',
                reply_markup: buildPersistentReplyKeyboard(prefs)
            });

            await tgApi('sendMessage', {
                chat_id: chatId,
                text: buildDashboardMessage(prefs),
                parse_mode: 'HTML',
                reply_markup: buildDashboardInlineKeyboard(prefs)
            });
            return res.status(200).send('OK');
        }

        // 3. 🔗 Convert Links button
        if (trimmed === '🔗 Convert Links') {
            prefs.state = null;
            await saveUserPrefs(msg.from.id, prefs, cfgRowId);
            await tgApi('sendMessage', {
                chat_id: chatId,
                text: '📤 <b>Send or forward any Post (Photo/Video/Text) with links now!</b>',
                parse_mode: 'HTML'
            });
            return res.status(200).send('OK');
        }

        // 4. Header Commands (/add_header, 📝 Set Header, /remove_header, 🗑️ Remove Header)
        if (trimmed === '/add_header' || trimmed === '📝 Set Header') {
            prefs.state = 'awaiting_header';
            await saveUserPrefs(msg.from.id, prefs, cfgRowId);
            await tgApi('sendMessage', {
                chat_id: chatId,
                text:
                    `📝 <b>Send the Header text you want to set:</b>\n\n` +
                    `<i>(Supports Custom Emojis, bold/italic & multi-line text. Tap Cancel to abort.)</i>`,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'ui_cancel' }]]
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
            const cEmojis = extractCustomEmojis(body, shifted);
            if (cEmojis.length > 0 && !prefs.btn_emoji_id) {
                prefs.btn_emoji_id = cEmojis[0].id;
            }
            prefs.state = null;
            await saveUserPrefs(msg.from.id, prefs, cfgRowId);
            await tgApi('sendMessage', {
                chat_id: chatId,
                text:
                    `✅ <b>Header Set Successfully!</b>\n\n<blockquote>${prefs.header}</blockquote>` +
                    (cEmojis.length > 0 ? `\n\n✨ <b>Auto-Extracted Custom Emoji ID:</b> <code>${cEmojis.map(x => x.id).join(', ')}</code>` : ''),
                parse_mode: 'HTML',
                reply_markup: buildDashboardInlineKeyboard(prefs)
            });
            return res.status(200).send('OK');
        }

        if (trimmed === '/remove_header' || trimmed === '🗑️ Remove Header') {
            prefs.header = '';
            prefs.state = null;
            await saveUserPrefs(msg.from.id, prefs, cfgRowId);
            await tgApi('sendMessage', {
                chat_id: chatId,
                text: '🗑️ <b>Header removed!</b>',
                parse_mode: 'HTML',
                reply_markup: buildDashboardInlineKeyboard(prefs)
            });
            return res.status(200).send('OK');
        }

        // 5. Footer Commands (/add_footer, 📌 Set Footer, /remove_footer, 🗑️ Remove Footer)
        if (trimmed === '/add_footer' || trimmed === '📌 Set Footer') {
            prefs.state = 'awaiting_footer';
            await saveUserPrefs(msg.from.id, prefs, cfgRowId);
            await tgApi('sendMessage', {
                chat_id: chatId,
                text:
                    `📌 <b>Send the Footer text you want to set:</b>\n\n` +
                    `<i>(Supports Custom Emojis, bold/italic & multi-line text. Tap Cancel to abort.)</i>`,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'ui_cancel' }]]
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
            const cEmojis = extractCustomEmojis(body, shifted);
            if (cEmojis.length > 0 && !prefs.btn_emoji_id) {
                prefs.btn_emoji_id = cEmojis[0].id;
            }
            prefs.state = null;
            await saveUserPrefs(msg.from.id, prefs, cfgRowId);
            await tgApi('sendMessage', {
                chat_id: chatId,
                text:
                    `✅ <b>Footer Set Successfully!</b>\n\n<blockquote>${prefs.footer}</blockquote>` +
                    (cEmojis.length > 0 ? `\n\n✨ <b>Auto-Extracted Custom Emoji ID:</b> <code>${cEmojis.map(x => x.id).join(', ')}</code>` : ''),
                parse_mode: 'HTML',
                reply_markup: buildDashboardInlineKeyboard(prefs)
            });
            return res.status(200).send('OK');
        }

        if (trimmed === '/remove_footer' || trimmed === '🗑️ Remove Footer') {
            prefs.footer = '';
            prefs.state = null;
            await saveUserPrefs(msg.from.id, prefs, cfgRowId);
            await tgApi('sendMessage', {
                chat_id: chatId,
                text: '🗑️ <b>Footer removed!</b>',
                parse_mode: 'HTML',
                reply_markup: buildDashboardInlineKeyboard(prefs)
            });
            return res.status(200).send('OK');
        }

        // 6. Text & Bold Mode Commands (/enable_text, /disable_text, /enable_bold, /disable_bold)
        if (trimmed === '/enable_text' || trimmed === '📄 Enable Text (Keep Post)') {
            prefs.keep_text = true;
            prefs.state = null;
            await saveUserPrefs(msg.from.id, prefs, cfgRowId);
            await tgApi('sendMessage', {
                chat_id: chatId,
                text: '📄 <b>Keep Original Text Enabled!</b>\nYour post text will be preserved and only the external links will be converted.',
                parse_mode: 'HTML',
                reply_markup: buildPersistentReplyKeyboard(prefs)
            });
            return res.status(200).send('OK');
        }

        if (trimmed === '/disable_text' || trimmed === '🔗 Disable Text (Only Links)') {
            prefs.keep_text = false;
            prefs.state = null;
            await saveUserPrefs(msg.from.id, prefs, cfgRowId);
            await tgApi('sendMessage', {
                chat_id: chatId,
                text: '🔗 <b>Only Links Mode Enabled!</b>\nOriginal post text will be removed and only <b>Header + Converted Link + Footer</b> will be sent with the Photo/Video.',
                parse_mode: 'HTML',
                reply_markup: buildPersistentReplyKeyboard(prefs)
            });
            return res.status(200).send('OK');
        }

        if (trimmed === '/enable_bold' || trimmed === '🅱️ Enable Bold') {
            prefs.is_bold = true;
            prefs.state = null;
            await saveUserPrefs(msg.from.id, prefs, cfgRowId);
            await tgApi('sendMessage', {
                chat_id: chatId,
                text: '🅱️ <b>Header & Footer Bold Enabled!</b>',
                parse_mode: 'HTML',
                reply_markup: buildPersistentReplyKeyboard(prefs)
            });
            return res.status(200).send('OK');
        }

        if (trimmed === '/disable_bold' || trimmed === '🔡 Disable Bold') {
            prefs.is_bold = false;
            prefs.state = null;
            await saveUserPrefs(msg.from.id, prefs, cfgRowId);
            await tgApi('sendMessage', {
                chat_id: chatId,
                text: '🔡 <b>Header & Footer Normal Text Enabled!</b>',
                parse_mode: 'HTML',
                reply_markup: buildPersistentReplyKeyboard(prefs)
            });
            return res.status(200).send('OK');
        }

        // --------------------------------------------------------------------
        // C. HANDLE INTERACTIVE STEP INPUTS (HEADER, FOOTER, BUTTON + EMOJI)
        // --------------------------------------------------------------------
        if (prefs.state === 'awaiting_header' && !trimmed.startsWith('/')) {
            prefs.header = entitiesToHtml(rawText, entities);
            const cEmojis = extractCustomEmojis(rawText, entities);
            if (cEmojis.length > 0 && !prefs.btn_emoji_id) {
                prefs.btn_emoji_id = cEmojis[0].id;
            }
            prefs.state = null;
            await saveUserPrefs(msg.from.id, prefs, cfgRowId);

            await tgApi('sendMessage', {
                chat_id: chatId,
                text:
                    `✅ <b>Header Saved Successfully!</b>\n\n` +
                    `<blockquote>${prefs.header}</blockquote>` +
                    (cEmojis.length > 0
                        ? `\n\n✨ <b>Custom Emoji Auto-Detected!</b>\nExtracted ID: <code>${cEmojis.map(e => e.id).join(', ')}</code>`
                        : ''),
                parse_mode: 'HTML',
                reply_markup: buildDashboardInlineKeyboard(prefs)
            });
            return res.status(200).send('OK');
        }

        if (prefs.state === 'awaiting_footer' && !trimmed.startsWith('/')) {
            prefs.footer = entitiesToHtml(rawText, entities);
            const cEmojis = extractCustomEmojis(rawText, entities);
            if (cEmojis.length > 0 && !prefs.btn_emoji_id) {
                prefs.btn_emoji_id = cEmojis[0].id;
            }
            prefs.state = null;
            await saveUserPrefs(msg.from.id, prefs, cfgRowId);

            await tgApi('sendMessage', {
                chat_id: chatId,
                text:
                    `✅ <b>Footer Saved Successfully!</b>\n\n` +
                    `<blockquote>${prefs.footer}</blockquote>` +
                    (cEmojis.length > 0
                        ? `\n\n✨ <b>Custom Emoji Auto-Detected!</b>\nExtracted ID: <code>${cEmojis.map(e => e.id).join(', ')}</code>`
                        : ''),
                parse_mode: 'HTML',
                reply_markup: buildDashboardInlineKeyboard(prefs)
            });
            return res.status(200).send('OK');
        }

        if (prefs.state === 'awaiting_btn_custom' && !trimmed.startsWith('/')) {
            if (trimmed.toLowerCase() === 'clear') {
                prefs.btn_emoji_id = null;
                prefs.state = null;
                await saveUserPrefs(msg.from.id, prefs, cfgRowId);
                await tgApi('sendMessage', {
                    chat_id: chatId,
                    text: '🗑️ <b>Custom Emoji cleared from buttons!</b>',
                    parse_mode: 'HTML',
                    reply_markup: buildDashboardInlineKeyboard(prefs)
                });
                return res.status(200).send('OK');
            }

            const cEmojis = extractCustomEmojis(rawText, entities);
            let cleanLabel = rawText;

            if (cEmojis.length > 0) {
                prefs.btn_emoji_id = cEmojis[0].id;
                // Remove the first custom emoji character from button text if icon_custom_emoji_id is set
                const first = cEmojis[0];
                cleanLabel = (rawText.slice(0, first.offset) + rawText.slice(first.offset + first.length)).trim();
            } else if (/^\d{15,22}$/.test(trimmed)) {
                prefs.btn_emoji_id = trimmed;
                cleanLabel = prefs.custom_btn_text;
            }

            if (cleanLabel) {
                prefs.custom_btn_text = cleanLabel;
            }
            prefs.state = null;
            await saveUserPrefs(msg.from.id, prefs, cfgRowId);

            await tgApi('sendMessage', {
                chat_id: chatId,
                text:
                    `✅ <b>Button Text & Custom Emoji Updated!</b>\n\n` +
                    `• <b>Button Text:</b> ${escapeHtml(prefs.custom_btn_text)}\n` +
                    `• <b>Extracted Emoji ID:</b> ${prefs.btn_emoji_id ? `<code>${prefs.btn_emoji_id}</code>` : '<i>None</i>'}`,
                parse_mode: 'HTML',
                reply_markup: buildDashboardInlineKeyboard(prefs)
            });
            return res.status(200).send('OK');
        }

        // --------------------------------------------------------------------
        // D. CONVERT POST (PHOTO, VIDEO, GIF, DOCUMENT, AUDIO, OR TEXT)
        // --------------------------------------------------------------------
        const {
            convertedCount,
            onlyTelegramLinks,
            finalHtml,
            firstConvertedLink
        } = await convertPostContent(rawText, entities, user.id, prefs);

        if (onlyTelegramLinks) {
            await tgApi('sendMessage', {
                chat_id: chatId,
                text:
                    `⚠️ <b>Telegram Link Ignored!</b>\n\n` +
                    `Telegram channel aur account links (<code>t.me/...</code>) ko bot ignore karta hai.\n` +
                    `Agar aapko Telegram link shorten karni hai, toh niche button se <b>teleEarn Mini App</b> open karke convert karein:`,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            createColoredButton(
                                '🚀 Convert in teleEarn Mini App',
                                { url: MINI_APP_BASE_URL },
                                prefs.btn_color,
                                prefs.btn_emoji_id
                            )
                        ]
                    ]
                }
            });
            return res.status(200).send('OK');
        }

        if (convertedCount === 0 || !finalHtml) {
            await tgApi('sendMessage', {
                chat_id: chatId,
                text:
                    `⚠️ <b>No Convertible Link Found!</b>\n\n` +
                    `Post mein koi DiskWala, TeraBox, Filezen ya external link nahi mili.\n` +
                    `<i>(Note: Telegram channel/account links automatically ignore ki jaati hain.)</i>`,
                parse_mode: 'HTML'
            });
            return res.status(200).send('OK');
        }

        const postReplyMarkup = buildConvertedPostMarkup(prefs, firstConvertedLink);

        if (msg.photo && msg.photo.length > 0) {
            const bestPhotoId = msg.photo[msg.photo.length - 1].file_id;
            await tgApi('sendPhoto', {
                chat_id: chatId,
                photo: bestPhotoId,
                caption: finalHtml,
                parse_mode: 'HTML',
                reply_markup: postReplyMarkup
            });
        } else if (msg.video) {
            await tgApi('sendVideo', {
                chat_id: chatId,
                video: msg.video.file_id,
                caption: finalHtml,
                parse_mode: 'HTML',
                reply_markup: postReplyMarkup
            });
        } else if (msg.animation) {
            await tgApi('sendAnimation', {
                chat_id: chatId,
                animation: msg.animation.file_id,
                caption: finalHtml,
                parse_mode: 'HTML',
                reply_markup: postReplyMarkup
            });
        } else if (msg.document) {
            await tgApi('sendDocument', {
                chat_id: chatId,
                document: msg.document.file_id,
                caption: finalHtml,
                parse_mode: 'HTML',
                reply_markup: postReplyMarkup
            });
        } else if (msg.audio) {
            await tgApi('sendAudio', {
                chat_id: chatId,
                audio: msg.audio.file_id,
                caption: finalHtml,
                parse_mode: 'HTML',
                reply_markup: postReplyMarkup
            });
        } else {
            await tgApi('sendMessage', {
                chat_id: chatId,
                text: finalHtml,
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                reply_markup: postReplyMarkup
            });
        }

        return res.status(200).send('OK');
    } catch (error) {
        console.error('Converter Webhook Error:', error);
        return res.status(200).send('OK');
    }
};
