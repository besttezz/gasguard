# GasGuard UI Demo Guide

GasGuard ใน branch `autonomous-lpg-safety` เป็น Mock Prototype แบบ Vanilla JavaScript ข้อมูลทั้งหมดในคู่มือนี้คือ `Simulation` และเก็บใน browser ของเครื่องที่เปิดใช้งาน ไม่ใช่ระบบควบคุมความปลอดภัยจริง

## เปิดระบบ

1. เปิด PowerShell ที่โฟลเดอร์โปรเจกต์
2. รัน `npm run dev`
3. เปิด `http://localhost:5567`
4. หาก port ถูกใช้งานอยู่ ให้หยุด process เดิมที่ใช้ port นั้นก่อน แล้วจึงรันคำสั่งอีกครั้ง

## สลับมุมมองผู้ใช้

ที่ส่วนหัว เลือก `โหมดสาธิตมุมมองผู้ใช้`:

- `บุคคลทั่วไป` สำหรับดูสถานะ เหตุการณ์ พื้นที่ และงานบริการแบบภาษาง่าย
- `ช่างเทคนิค` สำหรับดูคิวงาน การติดตั้ง อุปกรณ์ การตรวจเหตุการณ์ และรายงาน
- `นักพัฒนา` สำหรับดู Data Explorer, validation, spatial simulation, evidence และ Demo Control

การเลือกนี้ถูกจำไว้ใน local browser storage แต่ไม่ใช่การ login หรือสิทธิ์จริง

## เปิด Demo Control (D8)

1. เลือกมุมมอง `นักพัฒนา`
2. เปิดเมนู `ศูนย์ควบคุมการจำลอง`
3. เลือก Scenario S01–S10
4. ใช้ปุ่ม `เริ่ม Scenario`, `พัก`, `เดิน 1 Step` หรือ `เริ่มใหม่`
5. เลือกความเร็ว Playback 0.5x, 1x, 2x หรือ 4x

`เดิน 1 Step` จะหยุดไว้หลังส่ง input หนึ่ง reading เพื่อให้ตรวจสถานะได้ง่าย ส่วนความเร็วเป็นเพียงความเร็ว playback ไม่ได้เปลี่ยน threshold หรือสูตร Safety Engine

## Scenario library

| ID | Scenario | สิ่งที่ควรตรวจ |
| --- | --- | --- |
| S01 | Normal Operation | สถานะติดตามปกติ และไม่สร้าง incident ใหม่จาก reading ปกติ |
| S02 | Gradual LPG Rise | Rate of rise และการยกระดับตาม Engine |
| S03 | Rapid LPG Rise | Gas-risk incident และหลักฐานที่สัมพันธ์กัน |
| S04 | Sensor Offline | Unknown/System Fault ไม่ใช่ Safe |
| S05 | Network Offline | ความผิดปกติของ network แยกจาก gas risk |
| S06 | Valve Feedback Mismatch | Command/feedback ไม่ตรงกันในข้อมูลจำลอง |
| S07 | Multi-sensor Disagreement | หลักฐาน sensor-fusion ใน mock fleet |
| S08 | Recovery | การกลับมาของข้อมูล valid โดยไม่ลบประวัติ fault |
| S09 | Incident to Service | สร้าง incident แล้วทำ service workflow ผ่านหน้าระบบเดิม |
| S10 | Full Presentation Demo | เดินตามลำดับ S01 → S02 → S03 → S04 → S08 → S09 |

## เส้นทางสาธิต S10

1. เริ่ม S01 เพื่อแสดงหน้าปกติในมุมมองบุคคลทั่วไป
2. เปลี่ยนเป็น S02 แล้วกด Step เพื่ออธิบายแนวโน้ม
3. เปลี่ยนเป็น S03 เพื่อดู alert/incident และ evidence
4. เปลี่ยนเป็น S04 เพื่อยืนยันว่า Unknown ไม่ถูกแสดงเป็น Safe
5. เปลี่ยนเป็น S08 แล้วตรวจ Recovery transition และประวัติเหตุการณ์
6. ใช้ S09 เพื่อเปิด Incident จากนั้นสลับเป็นช่างเทคนิคและทำ workflow/verification/report ในหน้าเดิม

## Reset Demo Session

ปุ่ม `Reset เฉพาะข้อมูล Demo` จะถามยืนยันก่อน แล้วลบเฉพาะ localStorage keys ของ GasGuard: engine draft, service workflow, role/view, setup profile และ managed sites เท่านั้น ไม่ใช้ `localStorage.clear()` และไม่แตะข้อมูลเว็บไซต์อื่น หลัง reload จะกลับสู่ `Initializing/Unknown` จนได้รับ reading จำลองที่ valid

## Review mode

เปิด URL ด้วย `?review=1` เช่น `http://localhost:5567/?review=1` แถบล่างจะบอก Page, Role, Scenario และ Viewport และปุ่ม `Copy review context` จะคัดลอกบริบทพร้อม Data source และ Incident ให้ใช้ประกอบคอมเมนต์

## Page IDs สำหรับตรวจ UI

| Role | Pages |
| --- | --- |
| General | U1 Overview, U2 Alerts, U3 Locations, U4 Events, U5 Guide/Service |
| Technician | T1 Overview/queue, T2 Setup, T3 Live diagnostics, T4 Replay, T5 Validation, T6 Maintenance, T7 Reports |
| Developer | D1 System Overview, D2 Data Explorer, D3 Feature Analysis, D4 Validation, D5 Spatial Simulation, D6 Logs/Evidence, D7 Settings, D8 Demo Control |

## Checklist ผู้ตรวจ

- ป้าย `ข้อมูลจำลอง · Simulation` ต้องเห็นเสมอ
- General ต้องไม่เห็น raw risk/anomaly, JSON หรือ provider configuration
- Unknown และ System Fault ต้องไม่เป็นสีหรือข้อความแบบ Safe
- เมนู mobile เปิดด้วยปุ่มเมนู ปิดด้วย Escape และปิดเมื่อเลือกหน้าปลายทาง
- ตรวจ desktop 1440×900 / 1280×720, tablet 768×1024 และ mobile 430×932 / 390×844 / 360×800
- ตรวจ terminal Service Request ยังแก้ไขไม่ได้ และ Service Report เป็นข้อมูล mock ไม่ใช่ใบรับรองความปลอดภัย

## ขอบเขตของ prototype

ไม่มี backend, database, authentication, ESP32, sensor, MQTT broker, notification provider หรือการควบคุมวาล์วจริง. Browser ไม่ใช่ safety controller และข้อมูล/รายงานในหน้านี้ไม่ใช่ production audit log หรือผลทดสอบภาคสนาม.
