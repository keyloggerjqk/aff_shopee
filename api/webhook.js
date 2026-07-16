const fetch = require('node-fetch');

// ─── Environment Variables ───────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const API_BASE = 'https://checkshopee-plum.vercel.app';
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ─── Shopee Link Patterns ────────────────────────────────
const SHOPEE_PATTERNS = [
  /https?:\/\/s\.shopee\.vn\//i,
  /https?:\/\/shopee\.vn\//i,
  /https?:\/\/vn\.shp\.ee\//i,
  /https?:\/\/shp\.ee\//i,
  /https?:\/\/[a-z]{2}\.shopee\.[a-z.]+\//i,
];

// ══════════════════════════════════════════════════════════
//  UPSTASH REDIS (lưu config per-user)
// ══════════════════════════════════════════════════════════
async function redisGet(key) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    console.log('Upstash Redis not configured, skipping get.');
    return null;
  }
  try {
    const res = await fetch(`${UPSTASH_URL}/get/${key}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    });
    const data = await res.json();
    console.log(`Redis GET ${key} status:`, res.status);
    return data.result;
  } catch (err) {
    console.error(`Redis GET ${key} error:`, err.message);
    return null;
  }
}

async function redisSet(key, value) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    console.log('Upstash Redis not configured, skipping set.');
    return;
  }
  try {
    const res = await fetch(UPSTASH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(['SET', key, value]),
    });
    console.log(`Redis SET ${key} status:`, res.status);
  } catch (err) {
    console.error('Redis SET error:', err.message);
  }
}

async function redisDel(key) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    console.log('Upstash Redis not configured, skipping del.');
    return;
  }
  try {
    const res = await fetch(UPSTASH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(['DEL', key]),
    });
    console.log(`Redis DEL ${key} status:`, res.status);
  } catch (err) {
    console.error('Redis DEL error:', err.message);
  }
}

// ══════════════════════════════════════════════════════════
//  CONFIG MANAGEMENT (per-user)
// ══════════════════════════════════════════════════════════
function userKey(userId, field) {
  return `shopee_bot:user:${userId}:${field}`;
}

async function getUserConfig(userId) {
  const spc_st = (await redisGet(userKey(userId, 'spc_st'))) || '';
  const proxy = (await redisGet(userKey(userId, 'proxy'))) || '';
  return { spc_st, proxy };
}

async function setUserConfigValue(userId, field, value) {
  await redisSet(userKey(userId, field), value);
}

async function delUserConfigValue(userId, field) {
  await redisDel(userKey(userId, field));
}

// ══════════════════════════════════════════════════════════
//  TELEGRAM HELPERS
// ══════════════════════════════════════════════════════════
async function sendMessage(chatId, text, options = {}) {
  const url = `${TELEGRAM_API}/sendMessage`;
  console.log(`Sending message to ${chatId}...`);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...options,
      }),
    });
    const data = await res.json();
    console.log('Telegram API response status:', res.status);
    console.log('Telegram API response data:', JSON.stringify(data));
    return res;
  } catch (err) {
    console.error('Error in sendMessage fetch:', err.message);
    throw err;
  }
}

function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function isShopeeLink(text) {
  return SHOPEE_PATTERNS.some((p) => p.test(text));
}

function extractUrls(text) {
  const matches = text.match(/https?:\/\/[^\s]+/gi) || [];
  return matches.filter((url) => isShopeeLink(url));
}

function isAdmin(userId) {
  return ADMIN_ID && String(userId) === String(ADMIN_ID);
}

function maskCookie(cookie) {
  if (!cookie) return '(chưa cấu hình)';
  if (cookie.length <= 10) return '***';
  return cookie.substring(0, 6) + '...' + cookie.substring(cookie.length - 4);
}

// ══════════════════════════════════════════════════════════
//  SHOPEE AFFILIATE API (per-user config)
// ══════════════════════════════════════════════════════════
async function fetchAffiliate(productUrl, userId) {
  const config = await getUserConfig(userId);

  // spc_st là bắt buộc — đã kiểm tra trước khi gọi hàm này
  const params = new URLSearchParams({ product_url: productUrl });
  params.append('cookie', config.spc_st);

  if (config.proxy) {
    params.append('proxy', config.proxy);
  }

  const apiUrl = `${API_BASE}/api/affiliate?${params.toString()}`;

  const response = await fetch(apiUrl);
  const data = await response.json();

  if (!response.ok || data.error) {
    throw new Error(data.error || `API lỗi (HTTP ${response.status})`);
  }

  return data;
}

// ══════════════════════════════════════════════════════════
//  HANDLE TELEGRAM UPDATES
// ══════════════════════════════════════════════════════════
async function handleUpdate(update) {
  console.log('Incoming Telegram Update:', JSON.stringify(update));
  const msg = update.message;
  if (!msg || !msg.text) {
    console.log('No message or message text in update, skipping.');
    return;
  }

  const chatId = msg.chat.id;
  const text = msg.text;
  const userId = msg.from.id;
  const firstName = msg.from.first_name || 'bạn';

  // ── /start ──
  if (text.startsWith('/start')) {
    let reply = `🛒 <b>Chào ${escapeHtml(firstName)}!</b>\n\n`;
    reply += `Tôi là Bot tạo <b>Link Affiliate Shopee</b> tự động.\n\n`;
    reply += `📌 <b>Cách sử dụng:</b>\n`;
    reply += `1️⃣ Cài đặt cookie SPC_ST của bạn: /setcookie &lt;cookie&gt;\n`;
    reply += `2️⃣ (Tùy chọn) Cài proxy: /setproxy &lt;proxy&gt;\n`;
    reply += `3️⃣ Gửi link sản phẩm Shopee cho tôi!\n\n`;
    reply += `📎 <b>Link hỗ trợ:</b>\n`;
    reply += `• <code>https://shopee.vn/product/...</code>\n`;
    reply += `• <code>https://s.shopee.vn/...</code>\n`;
    reply += `• <code>https://vn.shp.ee/...</code>\n\n`;
    reply += `⚙️ <b>Lệnh cấu hình:</b>\n`;
    reply += `• /setcookie &lt;cookie&gt; — Cài đặt SPC_ST của bạn\n`;
    reply += `• /setproxy &lt;proxy&gt; — Cài đặt proxy HTTP\n`;
    reply += `• /removeproxy — Xóa proxy\n`;
    reply += `• /config — Xem cấu hình hiện tại\n\n`;
    reply += `⚠️ <b>Lưu ý:</b> Bạn <b>bắt buộc</b> phải cài /setcookie trước khi sử dụng bot!`;

    await sendMessage(chatId, reply);
    return;
  }

  // ── /setcookie (mọi user) ──
  if (text.startsWith('/setcookie')) {
    const value = text.replace(/^\/setcookie\s*/, '').trim();
    if (!value) {
      await sendMessage(
        chatId,
        '⚠️ Vui lòng nhập cookie SPC_ST của bạn.\n\nCú pháp: <code>/setcookie &lt;giá_trị_cookie&gt;</code>'
      );
      return;
    }
    const finalCookie = value.startsWith('SPC_ST=') ? value : `SPC_ST=${value}`;
    await setUserConfigValue(userId, 'spc_st', finalCookie);
    await sendMessage(
      chatId,
      `✅ Đã cập nhật cookie SPC_ST của bạn!\n\n🔑 Cookie: <code>${escapeHtml(maskCookie(finalCookie))}</code>`
    );
    return;
  }

  // ── /setproxy (mọi user) ──
  if (text.startsWith('/setproxy')) {
    const value = text.replace(/^\/setproxy\s*/, '').trim();
    if (!value) {
      await sendMessage(
        chatId,
        '⚠️ Vui lòng nhập proxy của bạn.\n\nCú pháp: <code>/setproxy http://user:pass@ip:port</code>'
      );
      return;
    }
    await setUserConfigValue(userId, 'proxy', value);
    await sendMessage(
      chatId,
      `✅ Đã cập nhật proxy của bạn!\n\n🌐 Proxy: <code>${escapeHtml(value)}</code>`
    );
    return;
  }

  // ── /removeproxy (mọi user) ──
  if (text.startsWith('/removeproxy')) {
    await delUserConfigValue(userId, 'proxy');
    await sendMessage(chatId, '✅ Đã xóa proxy của bạn thành công!');
    return;
  }

  // ── /config (mọi user — xem config riêng) ──
  if (text.startsWith('/config')) {
    const config = await getUserConfig(userId);
    let reply = `⚙️ <b>Cấu hình của bạn:</b>\n\n`;
    reply += `🔑 <b>Cookie SPC_ST:</b>\n<code>${escapeHtml(maskCookie(config.spc_st))}</code>\n\n`;
    reply += `🌐 <b>Proxy HTTP:</b>\n<code>${escapeHtml(config.proxy || '(không sử dụng)')}</code>`;
    await sendMessage(chatId, reply);
    return;
  }

  // ── Bỏ qua command khác ──
  if (text.startsWith('/')) return;

  // ── Xử lý link Shopee ──
  const shopeeLinks = extractUrls(text);

  if (shopeeLinks.length === 0) {
    const allUrls = text.match(/https?:\/\/[^\s]+/gi);
    if (allUrls && allUrls.length > 0) {
      await sendMessage(
        chatId,
        '⚠️ Chỉ hỗ trợ link từ <b>Shopee</b> (shopee.vn, s.shopee.vn, vn.shp.ee).\n\nVui lòng gửi đúng link sản phẩm Shopee!'
      );
    }
    return;
  }

  // ── Kiểm tra spc_st bắt buộc ──
  const userConfig = await getUserConfig(userId);
  if (!userConfig.spc_st) {
    await sendMessage(
      chatId,
      '❌ Bạn chưa cài đặt cookie <b>SPC_ST</b>!\n\n' +
        'Vui lòng cài đặt trước khi sử dụng:\n' +
        '<code>/setcookie &lt;giá_trị_cookie&gt;</code>\n\n' +
        '💡 Lấy SPC_ST từ cookie trình duyệt khi đăng nhập Shopee.'
    );
    return;
  }

  for (const link of shopeeLinks) {
    try {
      const result = await fetchAffiliate(link, userId);

      let response = `🛒 <b>Link Affiliate Shopee</b>\n\n`;
      response += `📎 <b>Link gốc:</b>\n${escapeHtml(link)}\n\n`;

      if (result.share_url) {
        response += `🔗 <b>Link AFF:</b>\n${escapeHtml(result.share_url)}\n\n`;
      }
      if (result.share_code) {
        response += `🎟 <b>Mã Code:</b> <code>${escapeHtml(result.share_code)}</code>\n`;
      }

      await sendMessage(chatId, response);
    } catch (error) {
      await sendMessage(
        chatId,
        `❌ <b>Lỗi tạo link Affiliate</b>\n\n📎 Link: ${escapeHtml(link)}\n💬 Chi tiết: ${escapeHtml(error.message)}`
      );
    }
  }
}

// ══════════════════════════════════════════════════════════
//  VERCEL SERVERLESS HANDLER
// ══════════════════════════════════════════════════════════
module.exports = async (req, res) => {
  if (req.method === 'POST') {
    try {
      await handleUpdate(req.body);
    } catch (err) {
      console.error('Error handling update:', err);
    }
    return res.status(200).json({ ok: true });
  }

  // GET — health check
  return res.status(200).json({
    status: '🤖 Shopee Affiliate Bot is running!',
    timestamp: new Date().toISOString(),
  });
};
