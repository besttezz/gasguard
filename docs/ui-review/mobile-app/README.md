# Mobile Application UI evidence

ภาพชุดนี้เป็นหลักฐาน UI ของ Mobile-first Application Redesign จากข้อมูลจำลองเท่านั้น ไม่มีข้อมูลส่วนบุคคล, secret, browser chrome หรือ desktop taskbar

สร้างใหม่ด้วยคำสั่ง:

```powershell
node scripts/capture-mobile-app-evidence.mjs
```

รายการภาพและ review point อยู่ใน `capture-manifest.json` ภาพ Mobile ใช้ 390×844 และภาพ Desktop ใช้ 1440×900. ทุกภาพใช้ `mock: true` และต้องตรวจซ้ำหลังเปลี่ยน UI, navigation, role flow หรือ Scenario
