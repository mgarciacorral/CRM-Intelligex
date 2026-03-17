#!/usr/bin/env bash
set -euo pipefail
cd /root/CRM
STATE_FILE="/root/CRM/data/outreach_state.json"
SECTOR=$(node -e 'const fs=require("fs"); let last="inmobiliarias"; try{ last=JSON.parse(fs.readFileSync("/root/CRM/data/outreach_state.json","utf8")).lastSector || last; }catch{}; console.log(last === "abogados" ? "inmobiliarias" : "abogados")')
python3 /root/CRM/fetch_leads_paginasamarillas.py "$SECTOR" 20
python3 /root/CRM/detect_contact_forms.py || true
node /root/CRM/daily_outreach.js "$SECTOR"
node /root/CRM/check_replies.js || true
node /root/CRM/send_daily_report.js
