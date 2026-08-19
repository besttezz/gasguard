# เซิร์ฟเวอร์รับข้อมูล GasGuard (ทางเลือก)

ใช้เมื่อเลือกโหมด **REST API** ในหน้าตั้งค่าของเว็บ
ถ้าใช้โหมด **MQTT** ไม่ต้องใช้โฟลเดอร์นี้เลย

## รัน

```bash
cd server
node server.js
# หรือกำหนดพอร์ต/คีย์เอง
PORT=8080 API_KEY=my-secret node server.js
```

ไม่ต้อง `npm install` เพราะใช้เฉพาะโมดูลมาตรฐานของ Node.js

## ทดสอบ

```bash
# ส่งค่าจำลองเข้าไป
curl -X POST http://localhost:3000/api/readings \
  -H "Content-Type: application/json" \
  -H "X-API-Key: gasguard-demo-key" \
  -d '{"id":"kitchen-01","ppm":320,"temp":31,"humidity":62}'

# ดูค่าล่าสุด (URL นี้คือค่าที่ใส่ในหน้าตั้งค่าของเว็บ)
curl http://localhost:3000/api/readings
```

## นำขึ้นออนไลน์

เว็บที่ deploy บน Netlify เป็น **HTTPS** ดังนั้น API ต้องเป็น HTTPS ด้วย
(เบราว์เซอร์บล็อกการเรียก http:// จากหน้า https://) เลือกวิธีใดวิธีหนึ่ง:

- ใช้ **MQTT over WebSocket (wss://)** แทน — ง่ายที่สุด ไม่ต้องมีเซิร์ฟเวอร์
- รันเซิร์ฟเวอร์นี้บน Render / Railway / Fly.io ซึ่งให้ HTTPS มาให้
- ใช้ Cloudflare Tunnel หรือ ngrok ชี้เข้าเครื่องที่บ้าน
- ทดสอบในวง LAN โดยเปิดเว็บจาก `http://localhost` (ไม่ใช่ Netlify)

## ข้อมูลที่เก็บ

บันทึกลงไฟล์ `data.json` ข้างไฟล์ server.js เก็บประวัติล่าสุด 5,000 ค่า
