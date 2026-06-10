#!/usr/bin/env python3
import json, os, datetime
from fpdf import FPDF

OUT_DIR = os.path.expanduser("~/Desktop")
DATE = "2026-06-11"

# Test-company data (full credentials)
data = json.load(open("/tmp/logins.json"))

# Default tenant: name|email|role, passwords not changed
default_rows = []
for line in open("/tmp/default_users.txt"):
    line = line.strip()
    if not line or "|" not in line:
        continue
    name, email, role = line.split("|")
    if role == "SUPER_ADMIN":
        pw = "[your existing admin password]"
    elif "@gmail.com" in email:
        pw = "[Google SSO]"
    else:
        pw = "Staff@Test2026!"
    default_rows.append({"name": name, "email": email, "role": role, "password": pw})
data["Vorkhive (Default / main)"] = default_rows

NOTE = {
    "Mellinial Toys": "Test company. Owner is SUPER_ADMIN; all staff share the password below. Sign in at app.vorkhive.com/login.",
    "Vorkhive (test)": "Test company. Owner is SUPER_ADMIN; all staff share the password below. Sign in at app.vorkhive.com/login.",
    "Vorkhive (Default / main)": "Main tenant. Non-admin staff have been reset to the shared password below; SUPER_ADMIN and Google-SSO accounts were left unchanged. Sign in at app.vorkhive.com/login.",
}
SLUG = {"Mellinial Toys": "Mellinial-Toys-test", "Vorkhive (test)": "Vorkhive-test", "Vorkhive (Default / main)": "Vorkhive-Default"}

def make_pdf(label, rows):
    pdf = FPDF(orientation="L", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=12)
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 18)
    pdf.cell(0, 10, f"VORKHIVE - {label}", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(90, 90, 90)
    pdf.cell(0, 6, f"Test employee logins - {len(rows)} users - generated {DATE}", new_x="LMARGIN", new_y="NEXT")
    pdf.multi_cell(0, 5, NOTE[label])
    pdf.ln(2)

    # header
    cols = [("Name", 60), ("Email", 95), ("Role", 45), ("Password", 75)]
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_fill_color(40, 50, 90)
    pdf.set_text_color(255, 255, 255)
    for title, w in cols:
        pdf.cell(w, 8, title, border=1, fill=True)
    pdf.ln()

    pdf.set_font("Helvetica", "", 8.5)
    fill = False
    for r in rows:
        pdf.set_fill_color(238, 240, 248) if fill else pdf.set_fill_color(255, 255, 255)
        pdf.set_text_color(20, 20, 20)
        vals = [str(r.get("name") or ""), str(r.get("email") or ""), str(r.get("role") or ""), str(r.get("password") or "")]
        for (title, w), v in zip(cols, vals):
            if pdf.get_string_width(v) > w - 3:
                while pdf.get_string_width(v + "...") > w - 3 and len(v) > 4:
                    v = v[:-1]
                v = v + "..."
            pdf.cell(w, 7, v, border=1, fill=True)
        pdf.ln()
        fill = not fill

    path = os.path.join(OUT_DIR, f"{SLUG[label]}-logins.pdf")
    pdf.output(path)
    print(f"  {path}  ({len(rows)} users)")

print("Generated PDFs:")
for label in ["Mellinial Toys", "Vorkhive (test)", "Vorkhive (Default / main)"]:
    make_pdf(label, data[label])
