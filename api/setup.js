const fetch = require('node-fetch');

// ─── Vercel Setup Endpoint ──────────────────────────────
// Truy cập GET /api/setup để tự động đăng ký webhook với Telegram
//
// Query params:
//   ?url=https://your-app.vercel.app  (tuỳ chọn, tự detect nếu không có)
//
// Ví dụ: https://your-app.vercel.app/api/setup

const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

module.exports = async (req, res) => {
  if (!BOT_TOKEN) {
    return res.status(500).json({ error: 'BOT_TOKEN chưa được cấu hình!' });
  }

  // Tự detect URL từ request hoặc query param
  const baseUrl =
    req.query.url ||
    `https://${req.headers['x-forwarded-host'] || req.headers.host}`;

  const webhookUrl = `${baseUrl}/api/webhook`;

  try {
    // Đăng ký webhook
    const setRes = await fetch(`${TELEGRAM_API}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        allowed_updates: ['message'],
        drop_pending_updates: true,
      }),
    });
    const setData = await setRes.json();

    // Lấy thông tin webhook hiện tại
    const infoRes = await fetch(`${TELEGRAM_API}/getWebhookInfo`);
    const infoData = await infoRes.json();

    return res.status(200).json({
      success: true,
      message: '✅ Webhook đã được đăng ký thành công!',
      webhook_url: webhookUrl,
      set_result: setData,
      webhook_info: infoData.result,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};
