#!/usr/bin/env python3
"""Reset staff passwords (via owner API) + collect login lists for the test tenants.
Usage: python3 collect-logins.py <base_url>   -> writes /tmp/logins.json"""
import sys, json, time, urllib.request, urllib.error

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'https://app.bevorasg.com/api').rstrip('/')

def req(method, path, token=None, body=None):
    url = f"{BASE}{path}"
    data = json.dumps(body).encode() if body is not None else None
    h = {"Content-Type": "application/json"}
    if token: h["Authorization"] = f"Bearer {token}"
    for attempt in range(5):
        r = urllib.request.Request(url, data=data, headers=h, method=method)
        try:
            with urllib.request.urlopen(r, timeout=30) as resp:
                return resp.status, json.loads(resp.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 4: time.sleep(3 + attempt*2); continue
            try: return e.code, json.loads(e.read().decode() or "{}")
            except: return e.code, {}
        except Exception:
            if attempt < 4: time.sleep(2); continue
            return 0, {}
    return 0, {}

COMPANIES = [
    ("Mellinial Toys", "founder@mellinialtoys.test", "Owner@Test2026!"),
    ("GaDongHR (test)", "founder@gadonghr.test", "Owner@Test2026!"),
]
result = {}
for label, owner_email, owner_pw in COMPANIES:
    s, d = req("POST", "/auth/login", body={"email": owner_email, "password": owner_pw})
    token = d.get("accessToken")
    if not token:
        print(f"{label}: owner login failed [{s}]"); continue
    s, ul = req("GET", "/users?limit=500", token)
    users = ul.get("users", ul) if isinstance(ul, dict) else (ul if isinstance(ul, list) else [])
    rows = []
    for u in users:
        role = u.get("role") or "EMPLOYEE"
        if role == "SUPER_ADMIN":
            pw = owner_pw
        else:
            rs, _ = req("POST", f"/users/{u['id']}/reset-password", token, {"newPassword": "Staff@Test2026!"})
            pw = "Staff@Test2026!" if rs in (200, 201) else "[reset failed]"
        rows.append({"name": u.get("name"), "email": u.get("email"), "role": role, "password": pw})
        time.sleep(0.03)
    rows.sort(key=lambda r: (r["role"] != "SUPER_ADMIN", r["name"] or ""))
    result[label] = rows
    print(f"{label}: {len(rows)} users collected (staff reset to Staff@Test2026!)")

json.dump(result, open("/tmp/logins.json", "w"), indent=2)
print("wrote /tmp/logins.json")
