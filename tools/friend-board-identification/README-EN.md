# GasGuard ESP32 Friend-Side Board Identification Package

This package is designed for a remote tester ("Friend") who physically holds the ESP32 development board. It provides a safe, non-destructive script to detect USB/COM hardware details and generate an evidence bundle for engineering verification.

---

## ⚠️ Electrical Safety Requirements

1. **Bare ESP32 USB Connection Only**: Disconnect ALL external components before plugging into the PC (sensors, relays, buzzers, valves, external 12V/5V power supplies).
2. **No External Power**: Power the board via USB cable ONLY.
3. **No Gas Exposure**: This test is strictly for USB/Serial device identification.

---

## 📋 Friend Quick Start

1. Disconnect all wiring/sensors from the ESP32.
2. Double-click `detect-board.cmd` (or run `.\detect-gasguard-board.ps1` in PowerShell).
3. Follow the on-screen prompt (optional before/after comparison if multiple COM ports exist).
4. Send back the generated report files:
   - `gasguard-board-report.txt`
   - `gasguard-board-report.json`
5. Attach crisp photos of:
   - Board Front & Back
   - Metal RF module text (e.g. ESP-WROOM-32)
   - USB-UART bridge chip (e.g. CP2102, CH340)
   - Pin labels on both header rows
   - Second gas sensor module markings (MQ-3 vs MQ-2 verification)

---

## 🔒 Non-Destructive Guarantee

- NO automatic driver installation.
- NO toolchain or software downloads.
- NO flash erasing (`erase-flash`) or flash writing (`write-flash`).
- NO collection of Wi-Fi credentials, user accounts, or private network data.
