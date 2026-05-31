# 🛒 Shopee Affiliate Telegram Bot

Bot Telegram tự động tạo link Affiliate và mã share code Shopee.  
Deploy trên **Vercel** (serverless) hoặc chạy local.

---

## ✨ Tính năng

- 🔗 Gửi link Shopee → nhận link AFF + mã code ngay lập tức
- 🔐 Admin cấu hình cookie SPC_ST và proxy HTTP qua lệnh bot
- 🌐 Hỗ trợ proxy HTTP để tránh block IP
- 📱 Hỗ trợ tất cả link Shopee: `shopee.vn`, `s.shopee.vn`, `vn.shp.ee`, `shp.ee`
- ☁️ Deploy miễn phí trên Vercel

---

## 🚀 Deploy lên Vercel

### Bước 1: Tạo Bot Telegram

1. Mở Telegram, tìm [@BotFather](https://t.me/BotFather)
2. Gửi `/newbot` và làm theo hướng dẫn
3. Sao chép **BOT_TOKEN** được cung cấp

### Bước 2: Lấy Admin ID

1. Mở Telegram, tìm [@userinfobot](https://t.me/userinfobot)
2. Gửi `/start` → bot sẽ trả về **User ID** của bạn

### Bước 3: Tạo Upstash Redis (miễn phí)

> Upstash Redis dùng để lưu cookie/proxy khi admin thay đổi qua bot.

1. Truy cập [console.upstash.com](https://console.upstash.com/)
2. Đăng ký tài khoản miễn phí
3. Tạo database Redis mới (chọn region gần nhất)
4. Vào tab **REST API** → sao chép:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

### Bước 4: Deploy lên Vercel

1. Push code lên GitHub
2. Truy cập [vercel.com](https://vercel.com/) → Import project từ GitHub
3. Thêm **Environment Variables** trong Vercel Dashboard:

| Tên biến | Giá trị | Bắt buộc |
|---|---|---|
| `BOT_TOKEN` | Token từ BotFather | ✅ |
| `ADMIN_ID` | User ID Telegram của bạn | ✅ |
| `UPSTASH_REDIS_REST_URL` | URL từ Upstash | ✅ |
| `UPSTASH_REDIS_REST_TOKEN` | Token từ Upstash | ✅ |
| `SPC_ST` | Cookie SPC_ST mặc định | ❌ |
| `PROXY` | Proxy HTTP mặc định | ❌ |

4. Nhấn **Deploy**!

### Bước 5: Đăng ký Webhook

Sau khi deploy xong, truy cập URL:

```
https://your-app.vercel.app/api/setup
```

Bạn sẽ thấy response `"✅ Webhook đã được đăng ký thành công!"` — Bot đã sẵn sàng!

---

## 💻 Chạy Local (tùy chọn)

```bash
# Copy và cấu hình file env
cp .env.example .env
# Điền BOT_TOKEN, ADMIN_ID vào .env

# Cài đặt
npm install

# Chạy bot (polling mode)
npm start
```

---

## 📋 Lệnh Bot

### 👤 Người dùng thường
Gửi link sản phẩm Shopee → nhận link AFF + mã code

### 🔐 Admin
| Lệnh | Mô tả |
|---|---|
| `/setcookie <cookie>` | Cập nhật cookie SPC_ST |
| `/setproxy <proxy>` | Cập nhật proxy HTTP (ví dụ: `http://user:pass@ip:port`) |
| `/removeproxy` | Xóa proxy |
| `/config` | Xem cấu hình hiện tại |

---

## 📁 Cấu trúc Project

```
telegram-bot/
├── api/
│   ├── webhook.js     # Webhook handler (Vercel serverless)
│   └── setup.js       # Đăng ký webhook tự động
├── bot.js             # Bot local (polling mode)
├── config.json        # Config local
├── vercel.json        # Cấu hình Vercel
├── package.json
├── .env.example
└── README.md
```

---

## 📎 Link Shopee được hỗ trợ

- `https://shopee.vn/...`
- `https://s.shopee.vn/...`
- `https://vn.shp.ee/...`
- `https://shp.ee/...`
