#!/usr/bin/env python3
"""Seed two test tenants with factual employees + users + leave/claims test cases.

Usage: python3 seed-test-companies.py <base_url>
  e.g. python3 seed-test-companies.py http://localhost:4000/api
       python3 seed-test-companies.py https://app.vorkhive.com/api
"""
import sys, json, time, urllib.request, urllib.error, random

BASE = sys.argv[1].rstrip('/') if len(sys.argv) > 1 else 'http://localhost:4000/api'
random.seed(42)

FIRST = ["Aisha","Brandon","Cheryl","Daniel","Elaine","Farid","Grace","Haziq","Irene","Jason",
         "Kavya","Lionel","Mei","Nadia","Omar","Priya","Qian","Rachel","Suresh","Tanya",
         "Umar","Vivian","Wei","Xin","Yusof","Zara","Adam","Bella","Caleb","Divya",
         "Ethan","Fiona","Gabriel","Hana","Ivan","Jolene","Kumar","Lydia","Marcus","Nora",
         "Oscar","Pearl","Raj","Selena","Tobias","Uma","Victor","Wendy","Yara","Zane"]
LAST = ["Tan","Lim","Lee","Ng","Wong","Chua","Goh","Koh","Ong","Teo","Sim","Yeo","Chia","Low","Toh",
        "Kumar","Nair","Rahman","Hussain","Ismail","Chen","Wang","Zhang","Liu","Sharma","Devi","Pillai","Anand","Bose","Das"]

def req(method, path, token=None, body=None, retries=5):
    url = f"{BASE}{path}"
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token: headers["Authorization"] = f"Bearer {token}"
    for attempt in range(retries):
        r = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(r, timeout=30) as resp:
                return resp.status, json.loads(resp.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            txt = e.read().decode()
            if e.code == 429 and attempt < retries - 1:
                time.sleep(3 + attempt * 2); continue
            try: return e.code, json.loads(txt or "{}")
            except: return e.code, {"error": txt[:200]}
        except Exception as e:
            if attempt < retries - 1: time.sleep(2); continue
            return 0, {"error": str(e)}
    return 0, {"error": "exhausted"}

def seed_company(name, slug_domain, owner_email, owner_name, country, count, depts):
    print(f"\n=== {name} ({count} users) ===")
    # 1. register
    s, d = req("POST", "/tenants/register", body={
        "companyName": name, "fullName": owner_name, "workEmail": owner_email,
        "password": "Owner@Test2026!", "country": country, "companySize": ("11-50" if count <= 50 else "51-200")})
    if s not in (200, 201):
        print(f"  register FAILED [{s}]: {d.get('error')}"); return
    token = d["accessToken"]; tid = d["tenant"]["id"]
    print(f"  tenant {d['tenant']['slug']} ({tid}) | owner {owner_email} / Owner@Test2026!")

    # 2. lazy-seed + fetch leave types + claim categories
    _, lt = req("GET", "/leave/types", token)
    leave_types = lt if isinstance(lt, list) else []
    annual = next((t for t in leave_types if 'annual' in (t.get('name','').lower())), leave_types[0] if leave_types else None)
    _, cc = req("GET", "/claims/categories", token)
    cats = cc if isinstance(cc, list) else []
    cat = cats[0] if cats else None
    print(f"  provisioned {len(leave_types)} leave types, {len(cats)} claim categories")

    # 3. employees — each POST /employees auto-creates the staff LOGIN user in
    # this tenant. Owner is user #1, so create count-1 staff.
    made = []
    for i in range(count - 1):
        fn, ln = random.choice(FIRST), random.choice(LAST)
        dept = depts[i % len(depts)]
        email = f"{fn.lower()}.{ln.lower()}{i}@{slug_domain}"
        s, emp = req("POST", "/employees", token, {
            "fullName": f"{fn} {ln}", "workEmail": email, "department": dept,
            "designation": random.choice(["Executive","Senior Executive","Manager","Specialist","Associate","Lead"]),
            "employmentType": "FULL_TIME", "startDate": "2024-01-15"})
        if s not in (200, 201):
            print(f"  emp {email} FAILED [{s}]: {emp.get('error')}"); continue
        eid = emp.get("id") or emp.get("employee", {}).get("id")
        made.append({"eid": eid, "email": email, "name": f"{fn} {ln}"})
        if (i+1) % 10 == 0: print(f"  ...{i+1}/{count-1} staff created")
        time.sleep(0.05)

    time.sleep(3)  # employee->user creation is async (fire-and-forget); let it settle
    _, ul = req("GET", "/users", token)
    users = ul.get("users", ul) if isinstance(ul, dict) else (ul if isinstance(ul, list) else [])
    print(f"  employees: {len(made)} | users in tenant: {len(users)}")

    # make 2 staff login-able with a known password (rest use invite/SSO normally)
    demo = []
    for u in [x for x in users if x.get("employeeId")][:2]:
        s, _ = req("POST", f"/users/{u['id']}/reset-password", token, {"newPassword": "Staff@Test2026!"})
        if s in (200, 201): demo.append(u["email"])
    if demo: print(f"  demo staff logins (pwd Staff@Test2026!): {', '.join(demo)}")

    # 4. test cases — leave + claims for a sample of staff (owner files on their behalf)
    sample = made[:max(3, count // 5)]
    leave_n = claim_n = 0
    for m in sample:
        if annual and m["eid"]:
            # allocate this year's entitlement first, then file leave against it
            req("PUT", f"/leave/entitlements/{m['eid']}", token,
                {"year": 2026, "entitlements": [{"leaveTypeId": annual["id"], "entitledDays": 21}]})
            s, _ = req("POST", "/leave/applications", token, {
                "employeeId": m["eid"], "leaveTypeId": annual["id"],
                "startDate": "2026-07-06", "endDate": "2026-07-08", "reason": "Family vacation"})
            if s in (200, 201): leave_n += 1
        if cat:
            s, _ = req("POST", "/claims", token, {
                "employeeId": m["eid"], "categoryId": cat["id"], "title": "Client lunch",
                "claimDate": "2026-06-20", "totalAmount": round(random.uniform(25, 180), 2),
                "description": "Business meal with client"})
            if s in (200, 201): claim_n += 1
        time.sleep(0.05)
    print(f"  test cases: {leave_n} leave applications, {claim_n} claims")

seed_company("Mellinial Toys", "mellinialtoys.test", "founder@mellinialtoys.test", "Megan Toh", "SG", 10,
             ["Design","Production","Sales","Marketing","Operations","Finance"])
seed_company("Vorkhive", "vorkhive.test", "founder@vorkhive.test", "Victor Khoo", "SG", 50,
             ["Engineering","Product","Sales","Marketing","Customer Success","People Ops","Finance","Data"])
print("\nDone.")
