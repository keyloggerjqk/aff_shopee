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
//  UPSTASH REDIS (lưu config: spc_st, proxy)
// ══════════════════════════════════════════════════════════
async function redisGet(key) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  try {
    const res = await fetch(`${UPSTASH_URL}/get/${key}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    });
    const data = await res.json();
    return data.result;
  } catch {
    return null;
  }
}

async function redisSet(key, value) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return;
  try {
    await fetch(UPSTASH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(['SET', key, value]),
    });
  } catch (err) {
    console.error('Redis SET error:', err.message);
  }
}

// ══════════════════════════════════════════════════════════
//  CONFIG MANAGEMENT
// ══════════════════════════════════════════════════════════
async function getConfig() {
  const spc_st = (await redisGet('shopee_bot:spc_st')) || process.env.SPC_ST || '';
  const proxy = (await redisGet('shopee_bot:proxy')) || process.env.PROXY || '';
  return { spc_st, proxy };
}

async function setConfigValue(key, value) {
  await redisSet(`shopee_bot:${key}`, value);
}

// ══════════════════════════════════════════════════════════
//  TELEGRAM HELPERS
// ══════════════════════════════════════════════════════════
async function sendMessage(chatId, text, options = {}) {
  return fetch(`${TELEGRAM_API}/sendMessage`, {
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
//  SHOPEE AFFILIATE API
// ══════════════════════════════════════════════════════════
async function fetchAffiliate(productUrl) {
  const config = await getConfig();

  const params = new URLSearchParams({ product_url: productUrl });
  if (config.spc_st) {
    params.append('cookie', config.spc_st);
  }
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
  const msg = update.message;
  if (!msg || !msg.text) return;

  const chatId = msg.chat.id;
  const text = msg.text;
  const userId = msg.from.id;
  const firstName = msg.from.first_name || 'bạn';

  // ── /start ──
  if (text.startsWith('/start')) {
    let reply = `🛒 <b>Chào ${escapeHtml(firstName)}!</b>\n\n`;
    reply += `Tôi là Bot tạo <b>Link Affiliate Shopee</b> tự động.\n\n`;
    reply += `📌 <b>Cách sử dụng:</b>\n`;
    reply += `Gửi link sản phẩm Shopee cho tôi, ví dụ:\n`;
    reply += `• <code>https://shopee.vn/product/...</code>\n`;
    reply += `• <code>https://s.shopee.vn/...</code>\n`;
    reply += `• <code>https://vn.shp.ee/...</code>\n\n`;
    reply += `Tôi sẽ trả về <b>Link AFF</b> và <b>Mã Code</b> ngay lập tức! 🚀`;

    if (isAdmin(userId)) {
      reply += `\n\n🔐 <b>Lệnh Admin:</b>\n`;
      reply += `• /setcookie &lt;cookie&gt; — Cập nhật SPC_ST\n`;
      reply += `• /setproxy &lt;proxy&gt; — Cập nhật proxy HTTP\n`;
      reply += `• /removeproxy — Xóa proxy\n`;
      reply += `• /config — Xem cấu hình hiện tại`;
    }

    await sendMessage(chatId, reply);
    return;
  }

  // ── /setcookie ──
  if (text.startsWith('/setcookie')) {
    if (!isAdmin(userId)) {
      await sendMessage(chatId, '⛔ Bạn không có quyền sử dụng lệnh này.');
      return;
    }
    const value = text.replace(/^\/setcookie\s*/, '').trim();
    if (!value) {
      await sendMessage(chatId, '⚠️ Cú pháp: <code>/setcookie &lt;giá_trị_cookie&gt;</code>');
      return;
    }
    const finalCookie = value.startsWith('SPC_ST=') ? value : `SPC_ST=${value}`;
    await setConfigValue('spc_st', finalCookie);
    await sendMessage(
      chatId,
      `✅ Đã cập nhật cookie SPC_ST!\n\n🔑 Cookie: <code>${escapeHtml(maskCookie(finalCookie))}</code>`
    );
    return;
  }

  // ── /setproxy ──
  if (text.startsWith('/setproxy')) {
    if (!isAdmin(userId)) {
      await sendMessage(chatId, '⛔ Bạn không có quyền sử dụng lệnh này.');
      return;
    }
    const value = text.replace(/^\/setproxy\s*/, '').trim();
    if (!value) {
      await sendMessage(chatId, '⚠️ Cú pháp: <code>/setproxy http://user:pass@ip:port</code>');
      return;
    }
    await setConfigValue('proxy', value);
    await sendMessage(
      chatId,
      `✅ Đã cập nhật proxy!\n\n🌐 Proxy: <code>${escapeHtml(value)}</code>`
    );
    return;
  }

  // ── /removeproxy ──
  if (text.startsWith('/removeproxy')) {
    if (!isAdmin(userId)) {
      await sendMessage(chatId, '⛔ Bạn không có quyền sử dụng lệnh này.');
      return;
    }
    await setConfigValue('proxy', '');
    await sendMessage(chatId, '✅ Đã xóa proxy thành công!');
    return;
  }

  // ── /config ──
  if (text.startsWith('/config')) {
    if (!isAdmin(userId)) {
      await sendMessage(chatId, '⛔ Bạn không có quyền sử dụng lệnh này.');
      return;
    }
    const config = await getConfig();
    let reply = `⚙️ <b>Cấu hình hiện tại:</b>\n\n`;
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

  for (const link of shopeeLinks) {
    try {
      const result = await fetchAffiliate(link);

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
