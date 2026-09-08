# UI Review Package

เปิด `http://localhost:5567/?review=1` ก่อนตรวจทุกภาพ เพื่อให้แถบ Review context แสดง Page, Role, Scenario และ viewport.

## Review Board

เปิด [Review Board](http://localhost:5567/docs/ui-review/review-board.html) เพื่อดูภาพทั้งหมดในชุดนี้

1. กดภาพเพื่อขยาย แล้วใช้ปุ่มก่อนหน้า/ถัดไปหรือปุ่มลูกศรบนแป้นพิมพ์
2. เลือก `ผ่าน`, `ต้องแก้` หรือ `ขอเพิ่มข้อมูล` และเขียน Comment ใต้ภาพ
3. กด `Copy feedback` เพื่อคัดลอกเฉพาะภาพ หรือ `Copy All Feedback` เพื่อส่งกลับ Project Manager
4. กด `Export JSON` เมื่อต้องการไฟล์ feedback และ `Reset Feedback` เมื่อต้องการล้างเฉพาะ feedback ของ Review Board

Feedback เก็บใน `localStorage` ของ browser เครื่องนี้ด้วย key `gasguard-ui-review-feedback-v1` เท่านั้น จึงไม่ถูกส่งออกจากเครื่องโดยอัตโนมัติ และการ Reset จะไม่ล้าง storage ส่วนอื่น

ภาพชุดนี้ถูก capture จาก simulation บน commit `41dd58a` เมื่อ `2026-09-08` รายละเอียดที่ตรวจสอบได้อยู่ใน `capture-manifest.json`.

## Capture list

| File | Page | Role | Scenario | Viewport | Expected review point |
| --- | --- | --- | --- | --- | --- |
| 01-u1-normal-desktop.png | U1 | General | S01 | 1440×900 | สถานะปกติและ action หลัก |
| 02-u1-danger-desktop.png | U1 | General | S03 | 1440×900 | Danger อ่านออกโดยไม่พึ่งสี |
| 03-u1-unknown-desktop.png | U1 | General | S04 | 1440×900 | Unknown ไม่ใช่ Safe |
| 04-u4-incident-history-desktop.png | U4 | General | S03 | 1440×900 | หนึ่ง incident ต่อหนึ่งรายการ |
| 05-u5-service-report-desktop.png | U5 | General | S09 | 1440×900 | request/report และ disclaimer |
| 06-t1-work-queue-desktop.png | T1 | Technician | S03 | 1440×900 | Priority work queue |
| 07-t2-provisioning-desktop.png | T2 | Technician | S01 | 1440×900 | provisioning checklist |
| 08-t3-diagnostic-desktop.png | T3 | Technician | S04 | 1440×900 | diagnostic และ Unknown |
| 09-t4-investigation-desktop.png | T4 | Technician | S09 | 1440×900 | detection แยก workflow |
| 10-t7-service-report-desktop.png | T7 | Technician | S09 | 1440×900 | verification/report relation |
| 11-d1-system-overview-desktop.png | D1 | Developer | S01 | 1440×900 | pipeline observability |
| 12-d2-data-explorer-desktop.png | D2 | Developer | S02 | 1440×900 | raw/processed/reliability data |
| 13-d3-feature-analysis-desktop.png | D3 | Developer | S03 | 1440×900 | feature/risk evidence |
| 14-d6-relations-desktop.png | D6 | Developer | S09 | 1440×900 | evidence relation chain |
| 15-d8-demo-control-desktop.png | D8 | Developer | S10 | 1440×900 | guided presentation controls |
| 16-u1-danger-mobile.png | U1 | General | S03 | 390×844 | mobile status/action hierarchy |
| 17-t1-work-queue-mobile.png | T1 | Technician | S03 | 390×844 | queue/mobile drawer |
| 18-d8-demo-control-mobile.png | D8 | Developer | S10 | 390×844 | guided controls on mobile |

Images must be captured only from Simulation data. Do not include real contacts, secrets, browser chrome, or desktop taskbar. This index intentionally lists the required evidence and is committed before capture so reviewers can reproduce the exact set.
