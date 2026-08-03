#!/usr/bin/env python3
import json, os
from fpdf import FPDF

OUT = os.path.expanduser("~/Desktop/GaDongHR-ALL-test-logins.pdf")
DATE = "2026-06-11"

data = json.load(open("/tmp/logins.json"))
default_rows = []
for line in open("/tmp/default_users.txt"):
    line = line.strip()
    if not line or "|" not in line: continue
    name, email, role = line.split("|")
    if role == "SUPER_ADMIN": pw = "[your existing admin password]"
    elif "@gmail.com" in email: pw = "[Google SSO]"
    else: pw = "Staff@Test2026!"
    default_rows.append({"name": name, "email": email, "role": role, "password": pw})
data["GaDongHR (Default / main)"] = default_rows

ORDER = ["Mellinial Toys", "GaDongHR (test)", "GaDongHR (Default / main)"]
SUB = {
    "Mellinial Toys": "Test company - 10 users",
    "GaDongHR (test)": "Test company - 50 users",
    "GaDongHR (Default / main)": "Main tenant - 40 users (non-admin staff reset; admins/SSO unchanged)",
}

pdf = FPDF(orientation="L", unit="mm", format="A4")
pdf.set_auto_page_break(auto=True, margin=12)

# cover / quick reference
pdf.add_page()
pdf.set_font("Helvetica", "B", 22)
pdf.cell(0, 12, "GADONGHR - Test Login Sheet", new_x="LMARGIN", new_y="NEXT")
pdf.set_font("Helvetica", "", 10); pdf.set_text_color(90, 90, 90)
pdf.cell(0, 6, f"All instances - sign in at app.bevorasg.com/login - generated {DATE}", new_x="LMARGIN", new_y="NEXT")
pdf.ln(4)
pdf.set_text_color(20, 20, 20); pdf.set_font("Helvetica", "B", 12)
pdf.cell(0, 8, "Quick reference (shared test passwords)", new_x="LMARGIN", new_y="NEXT")
pdf.set_font("Helvetica", "", 10)
for t in [
    "Test-company owners (founder@mellinialtoys.test, founder@gadonghr.test):  Owner@Test2026!",
    "All test-company staff + reset Default staff:  Staff@Test2026!",
    "Default SUPER_ADMIN accounts:  unchanged (your existing passwords)",
    "fudunchuan.rsn@gmail.com:  Google SSO",
    "GaDongHR (test) company chatbot uses Claude; others use Ollama.",
]:
    pdf.cell(4, 6, "-"); pdf.cell(0, 6, t, new_x="LMARGIN", new_y="NEXT")
pdf.ln(2)
pdf.set_font("Helvetica", "I", 9); pdf.set_text_color(150, 60, 60)
pdf.multi_cell(0, 5, "Contains plaintext passwords - keep secure. For testing only.")

cols = [("Name", 60), ("Email", 95), ("Role", 45), ("Password", 75)]
def trunc(v, w):
    if pdf.get_string_width(v) <= w - 3: return v
    while pdf.get_string_width(v + "...") > w - 3 and len(v) > 4: v = v[:-1]
    return v + "..."

for label in ORDER:
    rows = sorted(data[label], key=lambda r: (r["role"] != "SUPER_ADMIN", r.get("name") or ""))
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 16); pdf.set_text_color(30, 40, 80)
    pdf.cell(0, 9, label, new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 9); pdf.set_text_color(110, 110, 110)
    pdf.cell(0, 6, SUB[label], new_x="LMARGIN", new_y="NEXT"); pdf.ln(1)
    pdf.set_font("Helvetica", "B", 9); pdf.set_fill_color(40, 50, 90); pdf.set_text_color(255, 255, 255)
    for title, w in cols: pdf.cell(w, 8, title, border=1, fill=True)
    pdf.ln()
    pdf.set_font("Helvetica", "", 8.5); fill = False
    for r in rows:
        pdf.set_fill_color(238, 240, 248) if fill else pdf.set_fill_color(255, 255, 255)
        pdf.set_text_color(20, 20, 20)
        vals = [r.get("name") or "", r.get("email") or "", r.get("role") or "", r.get("password") or ""]
        for (title, w), v in zip(cols, vals):
            pdf.cell(w, 7, trunc(str(v), w), border=1, fill=True)
        pdf.ln(); fill = not fill

pdf.output(OUT)
print("Wrote", OUT, f"({sum(len(data[l]) for l in ORDER)} logins across {len(ORDER)} instances)")
