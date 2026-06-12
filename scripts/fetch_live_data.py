#!/usr/bin/env python3
"""
Fetch live World Cup 2026 data from API-Football and update website.
Usage: python3 scripts/fetch_live_data.py [--api-key KEY]

Environment variable: API_FOOTBALL_KEY

This script:
1. Fetches live fixtures from API-Football
2. Updates matches.json with real scores
3. Updates standings.json
4. Fetches team lineups when available
5. Outputs updated JSON files
"""
import json, os, sys, urllib.request, urllib.error, time, copy

BASE_URL = "https://v3.football.api-sports.io"
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ====== CONFIG: World Cup 2026 League ID ======
# API-Football league ID for FIFA World Cup
FIFA_WC_LEAGUE_ID = 1  # Typically FIFA World Cup = 1
FIFA_WC_SEASON = 2026

def get_api_key():
    """Get API key from env or argument."""
    if "--api-key" in sys.argv:
        idx = sys.argv.index("--api-key")
        if idx + 1 < len(sys.argv):
            return sys.argv[idx + 1]
    return os.environ.get("API_FOOTBALL_KEY", "")

def api_request(endpoint, params=None):
    """Make a request to API-Football."""
    key = get_api_key()
    if not key:
        print("⚠ No API key found. Set API_FOOTBALL_KEY env var or pass --api-key")
        return None

    url = f"{BASE_URL}/{endpoint}"
    if params:
        qs = "&".join(f"{k}={v}" for k, v in params.items())
        url = f"{url}?{qs}"

    req = urllib.request.Request(url, headers={
        "x-apisports-key": key,
        "Accept": "application/json"
    })

    try:
        resp = urllib.request.urlopen(req, timeout=30)
        data = json.loads(resp.read().decode())
        if data.get("errors") and data["errors"]:
            print(f"⚠ API Error: {data['errors']}")
            return None
        return data.get("response", [])
    except urllib.error.HTTPError as e:
        print(f"⚠ HTTP {e.code}: {e.reason}")
        return None
    except Exception as e:
        print(f"⚠ Request failed: {e}")
        return None

def fetch_live_fixtures():
    """Fetch live and recent fixtures for World Cup 2026."""
    # Try to get fixtures for the season
    fixtures = api_request("fixtures", {
        "league": FIFA_WC_LEAGUE_ID,
        "season": FIFA_WC_SEASON
    })
    if fixtures is None:
        # Fallback: try current date range
        today = time.strftime("%Y-%m-%d")
        fixtures = api_request("fixtures", {
            "league": FIFA_WC_LEAGUE_ID,
            "season": FIFA_WC_SEASON,
            "from": "2026-06-11",
            "to": "2026-07-19"
        })
    if fixtures is None:
        print("⚠ Could not fetch fixtures")
        return []
    print(f"✅ Fetched {len(fixtures)} fixtures")
    return fixtures

def fetch_standings():
    """Fetch current standings."""
    standings = api_request("standings", {
        "league": FIFA_WC_LEAGUE_ID,
        "season": FIFA_WC_SEASON
    })
    if standings:
        print(f"✅ Fetched standings for {len(standings)} groups")
    return standings

def fetch_lineups(fixture_id):
    """Fetch lineups for a specific fixture."""
    return api_request("fixtures/lineups", {"fixture": fixture_id})

def fetch_events(fixture_id):
    """Fetch match events (goals, cards, subs)."""
    return api_request("fixtures/events", {"fixture": fixture_id})

def fetch_statistics(fixture_id):
    """Fetch match statistics."""
    return api_request("fixtures/statistics", {"fixture": fixture_id})

def update_matches_json(fixtures):
    """Update matches.json with real data from API."""
    matches_path = os.path.join(PROJECT_DIR, "data", "matches.json")
    try:
        with open(matches_path) as f:
            data = json.load(f)
        matches = data.get("matches", data) if isinstance(data, dict) else data
    except FileNotFoundError:
        print("⚠ matches.json not found")
        return False

    # Create lookup: team_code -> match_id mapping
    updated = 0
    for fixture in fixtures:
        fixture_id = fixture.get("fixture", {}).get("id", "")
        home_team = fixture.get("teams", {}).get("home", {})
        away_team = fixture.get("teams", {}).get("away", {})
        goals = fixture.get("goals", {})
        status = fixture.get("fixture", {}).get("status", {}).get("short", "")
        fixture_date = fixture.get("fixture", {}).get("date", "")[:10]

        home_name = home_team.get("name", "")
        away_name = away_team.get("name", "")
        home_score = goals.get("home")
        away_score = goals.get("away")

        # Map status
        status_map = {
            "FT": "finished", "AET": "finished", "PEN": "finished",
            "1H": "live", "2H": "live", "HT": "live", "ET": "live",
            "LIVE": "live",
            "NS": "upcoming", "TBD": "upcoming"
        }
        new_status = status_map.get(status, "upcoming")

        # Find matching match in our data
        for match in matches:
            if match.get("status") == "finished" and match.get("home_team_id") == home_name.lower().replace(" ", "-"):
                continue  # Already updated
            # Try to match by teams
            m_home = match.get("home_team_id", "").replace("-", " ").lower()
            m_away = match.get("away_team_id", "").replace("-", " ").lower()
            h_name = home_name.lower()
            a_name = away_name.lower()

            if (m_home in h_name or h_name in m_home) and (m_away in a_name or a_name in m_away):
                if new_status == "finished" and home_score is not None and away_score is not None:
                    match["status"] = "finished"
                    match["home_score"] = home_score
                    match["away_score"] = away_score
                    if match.get("prediction"):
                        match["prediction"]["predicted_home_score"] = home_score
                        match["prediction"]["predicted_away_score"] = away_score
                    updated += 1
                    print(f"  🔄 {home_name} {home_score}-{away_score} {away_name}")
                elif new_status == "live":
                    match["status"] = "live"
                    if home_score is not None and away_score is not None:
                        match["home_score"] = home_score
                        match["away_score"] = away_score
                    print(f"  🔴 {home_name} vs {away_name} - LIVE")
                break

    # Save
    if isinstance(data, dict):
        data["matches"] = matches
        data["last_updated"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    else:
        data = matches

    with open(matches_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"✅ Updated {updated} matches with real scores")
    return True

def update_standings_json(standings_data):
    """Update standings.json with real data."""
    if not standings_data:
        return False

    standings_path = os.path.join(PROJECT_DIR, "data", "standings.json")
    try:
        with open(standings_path) as f:
            data = json.load(f)
    except FileNotFoundError:
        data = {"standings": {}, "last_updated": ""}

    # API-Football returns standings in [{league: {...}, standings: [[...]]}] format
    new_standings = {}
    group_map = {0: "A", 1: "B", 2: "C", 3: "D", 4: "E", 5: "F",
                 6: "G", 7: "H", 8: "I", 9: "J", 10: "K", 11: "L"}

    for entry in standings_data:
        league_info = entry.get("league", {})
        standings_list = league_info.get("standings", [])

        for idx, group_data in enumerate(standings_list):
            group_letter = group_map.get(idx, f"G{idx}")
            teams = []
            for team_entry in group_data:
                team_info = team_entry.get("team", {})
                all_stats = {}
                for stat in team_entry.get("statistics", []):
                    all_stats[stat.get("type", "")] = stat.get("value", 0)

                team_id = team_info.get("name", "").lower().replace(" ", "-")
                teams.append({
                    "team_id": team_id,
                    "p": all_stats.get("games played", 0) or 0,
                    "w": all_stats.get("wins", 0) or 0,
                    "d": all_stats.get("draws", 0) or 0,
                    "l": all_stats.get("losses", 0) or 0,
                    "gf": all_stats.get("goals for", 0) or 0,
                    "ga": all_stats.get("goals against", 0) or 0,
                    "gd": (all_stats.get("goals for", 0) or 0) - (all_stats.get("goals against", 0) or 0),
                    "pts": (all_stats.get("points", 0) or 0),
                    "form": list(all_stats.get("form", "") or [])
                })
            if teams:
                new_standings[group_letter] = teams

    if new_standings:
        data["standings"] = new_standings
    data["last_updated"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    with open(standings_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"✅ Updated {len(new_standings)} groups in standings")
    return True

def update_lineups_json(fixtures):
    """Fetch and store lineups for all live/finished fixtures."""
    lineups_path = os.path.join(PROJECT_DIR, "data", "lineups.json")
    lineups_data = {}

    for fixture in fixtures:
        fixture_id = fixture.get("fixture", {}).get("id", "")
        if not fixture_id:
            continue

        status = fixture.get("fixture", {}).get("status", {}).get("short", "")
        if status in ("NS", "TBD"):
            continue  # Skip upcoming matches

        # Fetch lineups
        time.sleep(0.5)  # Rate limit
        lineups = fetch_lineups(fixture_id)
        if not lineups:
            continue

        match_id = fixture.get("fixture", {}).get("id", "")
        home_team = fixture.get("teams", {}).get("home", {}).get("name", "")
        away_team = fixture.get("teams", {}).get("away", {}).get("name", "")

        match_lineups = {"home": {}, "away": {}}
        for lineup in lineups:
            team = lineup.get("team", {}).get("name", "")
            is_home = team.lower() == home_team.lower()
            side = "home" if is_home else "away"

            match_lineups[side] = {
                "formation": lineup.get("formation", ""),
                "starting_xi": [
                    {
                        "number": p.get("number", ""),
                        "name": p.get("player", {}).get("name", ""),
                        "pos": p.get("player", {}).get("pos", ""),
                        "grid": p.get("player", {}).get("grid", "")
                    }
                    for p in lineup.get("startingXI", [])
                ],
                "substitutes": [
                    {
                        "number": p.get("number", ""),
                        "name": p.get("player", {}).get("name", ""),
                        "pos": p.get("player", {}).get("pos", "")
                    }
                    for p in lineup.get("substitutes", [])
                ]
            }

        lineups_data[fixture_id] = {
            "match_id": match_id,
            "home_team": home_team,
            "away_team": away_team,
            "lineups": match_lineups
        }
        print(f"  📋 Lineups: {home_team} ({match_lineups['home']['formation']}) vs {away_team} ({match_lineups['away']['formation']})")

    if lineups_data:
        with open(lineups_path, "w", encoding="utf-8") as f:
            json.dump(lineups_data, f, ensure_ascii=False, indent=2)
        print(f"✅ Saved lineups for {len(lineups_data)} matches")
        return True
    return False

def main():
    api_key = get_api_key()
    if not api_key:
        print("=" * 60)
        print("📋 HƯỚNG DẪN: CÁCH LẤY API-FOOTBALL KEY")
        print("=" * 60)
        print("1. Truy cập: https://dashboard.api-football.com/register")
        print("2. Đăng ký tài khoản (Free: 100 requests/ngày)")
        print("3. Vào Dashboard → lấy API Key")
        print("4. Set env: export API_FOOTBALL_KEY='your-key-here'")
        print("   Hoặc chạy: python3 fetch_live_data.py --api-key 'your-key-here'")
        print()
        print("ℹ Chạy ở chế độ demo (không có API key)")
        print("=" * 60)

    if api_key:
        print("🔍 Fetching World Cup 2026 data...\n")

        # Step 1: Fetch fixtures
        fixtures = fetch_live_fixtures()
        if fixtures:
            update_matches_json(fixtures)

        # Step 2: Fetch standings
        standings = fetch_standings()
        if standings:
            update_standings_json(standings)

        # Step 3: Fetch lineups (for finished/live matches)
        if fixtures:
            live_finished = [f for f in fixtures
                           if f.get("fixture", {}).get("status", {}).get("short", "") not in ("NS", "TBD")]
            if live_finished:
                print(f"\n📋 Fetching lineups for {len(live_finished)} live/finished matches...")
                update_lineups_json(live_finished)

        print("\n✅ Data update complete!")
    else:
        print("\n⚠ No API key available. Using demo data.")
        print("   Website will work with pre-loaded data.")

if __name__ == "__main__":
    main()
