require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

// ─── Config ──────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const CONFIG_PATH = path.join(__dirname, 'config.json');
const API_BASE = 'https://checkshopee-plum.vercel.app';

// Shopee link patterns
const SHOPEE_PATTERNS = [
  /https?:\/\/s\.shopee\.vn\//i,
  /https?:\/\/shopee\.vn\//i,
  /https?:\/\/vn\.shp\.ee\//i,
  /https?:\/\/shp\.ee\//i,
  /https?:\/\/[a-z]{2}\.shopee\.[a-z.]+\//i,
];

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN chưa được cấu hình! Tạo file .env với BOT_TOKEN=...');
  process.exit(1);
}

if (!ADMIN_ID) {
  console.error('⚠️  ADMIN_ID chưa được cấu hình! Chức năng admin sẽ bị vô hiệu hóa.');
}

// ─── Load / Save Config (per-user) ───────────────────────
function loadAllConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const config = JSON.parse(raw);
    // Đảm bảo có key "users"
    if (!config.users) {
      config.users = {};
    }
    return config;
  } catch {
    return { users: {} };
  }
}

function saveAllConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

function getUserConfig(userId) {
  const config = loadAllConfig();
  const userConf = config.users[String(userId)] || {};
  return {
    spc_st: userConf.spc_st || '',
    proxy: userConf.proxy || '',
  };
}

function setUserConfigValue(userId, field, value) {
  const config = loadAllConfig();
  const uid = String(userId);
  if (!config.users[uid]) {
    config.users[uid] = {};
  }
  config.users[uid][field] = value;
  saveAllConfig(config);
}

function delUserConfigValue(userId, field) {
  const config = loadAllConfig();
  const uid = String(userId);
  if (config.users[uid]) {
    delete config.users[uid][field];
    saveAllConfig(config);
  }
}

// ─── HTML Escape ─────────────────────────────────────────
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── API Fetch Helper (per-user) ─────────────────────────
async function fetchAffiliate(productUrl, userId) {
  const config = getUserConfig(userId);

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

// ─── URL Helpers ─────────────────────────────────────────
function isShopeeLink(text) {
  return SHOPEE_PATTERNS.some((pattern) => pattern.test(text));
}

function extractUrls(text) {
  const urlRegex = /https?:\/\/[^\s]+/gi;
  const matches = text.match(urlRegex) || [];
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

// ─── Bot Init ────────────────────────────────────────────
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log('🤖 Bot Shopee Affiliate đang chạy...');
console.log(`📋 Admin ID: ${ADMIN_ID || '(chưa cấu hình)'}`);

// ─── /start Command ──────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const name = escapeHtml(msg.from.first_name || 'bạn');

  let text = `🛒 <b>Chào ${name}!</b>\n\n`;
  text += `Tôi là Bot tạo <b>Link Affiliate Shopee</b> tự động.\n\n`;
  text += `📌 <b>Cách sử dụng:</b>\n`;
  text += `1️⃣ Cài đặt cookie SPC_ST của bạn: /setcookie &lt;cookie&gt;\n`;
  text += `2️⃣ (Tùy chọn) Cài proxy: /setproxy &lt;proxy&gt;\n`;
  text += `3️⃣ Gửi link sản phẩm Shopee cho tôi!\n\n`;
  text += `📎 <b>Link hỗ trợ:</b>\n`;
  text += `• <code>https://shopee.vn/product/...</code>\n`;
  text += `• <code>https://s.shopee.vn/...</code>\n`;
  text += `• <code>https://vn.shp.ee/...</code>\n\n`;
  text += `⚙️ <b>Lệnh cấu hình:</b>\n`;
  text += `• /setcookie &lt;cookie&gt; — Cài đặt SPC_ST của bạn\n`;
  text += `• /setproxy &lt;proxy&gt; — Cài đặt proxy HTTP\n`;
  text += `• /removeproxy — Xóa proxy\n`;
  text += `• /config — Xem cấu hình hiện tại\n\n`;
  text += `⚠️ <b>Lưu ý:</b> Bạn <b>bắt buộc</b> phải cài /setcookie trước khi sử dụng bot!`;

  bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
});

// ─── /setcookie Command (mọi user) ──────────────────────
bot.onText(/\/setcookie(?:\s+(.+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const cookieValue = match[1]?.trim();
  if (!cookieValue) {
    bot.sendMessage(chatId, '⚠️ Vui lòng nhập cookie SPC_ST của bạn.\n\nCú pháp: <code>/setcookie &lt;giá_trị_cookie&gt;</code>', {
      parse_mode: 'HTML',
    });
    return;
  }

  // Đảm bảo cookie bắt đầu bằng "SPC_ST="
  const finalCookie = cookieValue.startsWith('SPC_ST=') ? cookieValue : `SPC_ST=${cookieValue}`;

  setUserConfigValue(userId, 'spc_st', finalCookie);

  bot.sendMessage(chatId, `✅ Đã cập nhật cookie SPC_ST của bạn!\n\n🔑 Cookie: <code>${escapeHtml(maskCookie(finalCookie))}</code>`, {
    parse_mode: 'HTML',
  });
});

// ─── /setproxy Command (mọi user) ───────────────────────
bot.onText(/\/setproxy(?:\s+(.+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const proxyValue = match[1]?.trim();
  if (!proxyValue) {
    bot.sendMessage(
      chatId,
      '⚠️ Vui lòng nhập proxy của bạn.\n\nCú pháp: <code>/setproxy http://user:pass@ip:port</code>',
      { parse_mode: 'HTML' }
    );
    return;
  }

  setUserConfigValue(userId, 'proxy', proxyValue);

  bot.sendMessage(chatId, `✅ Đã cập nhật proxy của bạn!\n\n🌐 Proxy: <code>${escapeHtml(proxyValue)}</code>`, {
    parse_mode: 'HTML',
  });
});

// ─── /removeproxy Command (mọi user) ────────────────────
bot.onText(/\/removeproxy/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  delUserConfigValue(userId, 'proxy');

  bot.sendMessage(chatId, '✅ Đã xóa proxy của bạn thành công!');
});

// ─── /config Command (mọi user — xem config riêng) ──────
bot.onText(/\/config/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const config = getUserConfig(userId);

  let text = `⚙️ <b>Cấu hình của bạn:</b>\n\n`;
  text += `🔑 <b>Cookie SPC_ST:</b>\n<code>${escapeHtml(maskCookie(config.spc_st))}</code>\n\n`;
  text += `🌐 <b>Proxy HTTP:</b>\n<code>${escapeHtml(config.proxy || '(không sử dụng)')}</code>`;

  bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
});

// ─── Handle Shopee Links ─────────────────────────────────
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const userId = msg.from.id;

  // Bỏ qua nếu không có text hoặc là command
  if (!text || text.startsWith('/')) return;

  // Tìm link Shopee trong message
  const shopeeLinks = extractUrls(text);

  if (shopeeLinks.length === 0) {
    // Kiểm tra xem có phải link HTTPS nhưng không phải Shopee
    const allUrls = text.match(/https?:\/\/[^\s]+/gi);
    if (allUrls && allUrls.length > 0) {
      bot.sendMessage(
        chatId,
        '⚠️ Chỉ hỗ trợ link từ <b>Shopee</b> (shopee.vn, s.shopee.vn, vn.shp.ee).\n\nVui lòng gửi đúng link sản phẩm Shopee!',
        { parse_mode: 'HTML' }
      );
    }
    return;
  }

  // Kiểm tra spc_st bắt buộc
  const userConfig = getUserConfig(userId);
  if (!userConfig.spc_st) {
    bot.sendMessage(
      chatId,
      '❌ Bạn chưa cài đặt cookie <b>SPC_ST</b>!\n\n' +
        'Vui lòng cài đặt trước khi sử dụng:\n' +
        '<code>/setcookie &lt;giá_trị_cookie&gt;</code>\n\n' +
        '💡 Lấy SPC_ST từ cookie trình duyệt khi đăng nhập Shopee.',
      { parse_mode: 'HTML' }
    );
    return;
  }

  // Xử lý từng link
  for (const link of shopeeLinks) {
    const processingMsg = await bot.sendMessage(chatId, '⏳ Đang tạo link Affiliate...');

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

      // Xóa message "đang xử lý" và gửi kết quả
      bot.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
      bot.sendMessage(chatId, response, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
    } catch (error) {
      bot.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
      bot.sendMessage(
        chatId,
        `❌ <b>Lỗi tạo link Affiliate</b>\n\n📎 Link: ${escapeHtml(link)}\n💬 Chi tiết: ${escapeHtml(error.message)}`,
        { parse_mode: 'HTML', disable_web_page_preview: true }
      );
    }
  }
});

// ─── Error Handling ──────────────────────────────────────
bot.on('polling_error', (error) => {
  console.error('❌ Polling error:', error.code, error.message);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled rejection:', error);
});

console.log('✅ Bot đã sẵn sàng nhận tin nhắn!');
