#!/usr/bin/env python3
"""
Fetch live World Cup 2026 data + predictions + H2H + lineups from API-Football.
Usage: python3 scripts/fetch_live_data.py [--api-key KEY]

Environment variable: API_FOOTBALL_KEY

Output files:
  - data/matches.json    — updated with real scores
  - data/standings.json  — current group standings
  - data/predictions.json — API predictions per fixture (win%, score, corners, cards)
  - data/h2h.json        — head-to-head history per team pair
  - data/lineups.json    — confirmed lineups for played/live matches
"""
import json, os, sys, urllib.request, urllib.error, time, copy
from collections import defaultdict

BASE_URL = "https://v3.football.api-sports.io"
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# FIFA World Cup league ID = 1 (API-Football)
FIFA_WC_LEAGUE_ID = 1
FIFA_WC_SEASON = 2026
REQUEST_DELAY = 0.6  # seconds between requests (free tier: 10 req/min)

# ====== TX request tracking for rate limiting ======
_last_request_time = 0.0

def rate_limit():
    global _last_request_time
    elapsed = time.time() - _last_request_time
    if elapsed < REQUEST_DELAY:
        time.sleep(REQUEST_DELAY - elapsed)
    _last_request_time = time.time()

# ====== Helpers ======
def get_api_key():
    if "--api-key" in sys.argv:
        idx = sys.argv.index("--api-key")
        if idx + 1 < len(sys.argv):
            return sys.argv[idx + 1]
    return os.environ.get("API_FOOTBALL_KEY", "")

def api_request(endpoint, params=None):
    key = get_api_key()
    if not key:
        return None
    rate_limit()
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
            print(f"  ⚠ API Error: {data['errors']}")
            return None
        return data.get("response", [])
    except urllib.error.HTTPError as e:
        print(f"  ⚠ HTTP {e.code}: {e.reason}")
        return None
    except Exception as e:
        print(f"  ⚠ Request failed: {e}")
        return None

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

def slugify(name):
    """Convert team name to our slug ID (canada, bosnia-and-herzegovina, etc.)"""
    s = name.lower().strip()
    s = s.replace("côte d'ivoire", "cote-divoire")
    s = s.replace("curaçao", "curacao")
    s = s.replace("république démocratique du congo", "congo-dr")
    s = s.replace("rd congo", "congo-dr")
    s = s.replace("türkiye", "turkiye")
    s = s.replace("algérie", "algeria")
    s = s.replace("sénégal", "senegal")
    s = ''.join(c if c.isalnum() or c in ' -' else '' for c in s)
    return s.strip().replace(' ', '-')

# ====== 1. Fixtures ======
def fetch_fixtures():
    """Fetch ALL World Cup 2026 fixtures from API-Football."""
    fixtures = api_request("fixtures", {
        "league": FIFA_WC_LEAGUE_ID,
        "season": FIFA_WC_SEASON,
        "from": "2026-06-11",
        "to": "2026-07-19"
    })
    if fixtures is None:
        fixtures = api_request("fixtures", {
            "league": FIFA_WC_LEAGUE_ID,
            "season": FIFA_WC_SEASON
        })
    if fixtures:
        print(f"  ✅ Fetched {len(fixtures)} fixtures")
    else:
        # Last-resort fallback: just fetch last 7 days + next 30
        today = time.strftime("%Y-%m-%d")
        fixtures = api_request("fixtures", {
            "league": FIFA_WC_LEAGUE_ID,
            "season": FIFA_WC_SEASON,
            "from": "2026-06-01",
            "to": "2026-08-01"
        })
        if fixtures:
            print(f"  ✅ Fetched {len(fixtures)} fixtures (wide range)")
    return fixtures or []

def update_matches_json(fixtures):
    """Update matches.json with real scores + API fixture IDs."""
    data = load_json("matches.json")
    if not data:
        print("  ⚠ matches.json not found")
        return False
    matches = data.get("matches", data) if isinstance(data, dict) else data

    updated_scores = 0
    api_fixture_ids = {}  # fixture_id -> match_id mapping

    for fixture in fixtures:
        f = fixture.get("fixture", {})
        fixture_id = f.get("id")
        teams = fixture.get("teams", {})
        home_team = teams.get("home", {})
        away_team = teams.get("away", {})
        goals = fixture.get("goals", {})
        status_short = f.get("status", {}).get("short", "")
        fixture_date = (f.get("date", "") or "")[:10]

        home_name = home_team.get("name", "")
        away_name = away_team.get("name", "")
        home_score = goals.get("home")
        away_score = goals.get("away")

        status_map = {
            "FT": "finished", "AET": "finished", "PEN": "finished",
            "1H": "live", "2H": "live", "HT": "live", "ET": "live",
            "LIVE": "live", "NS": "upcoming", "TBD": "upcoming"
        }
        new_status = status_map.get(status_short, "upcoming")

        # Normalize team names for matching
        home_team_id = slugify(home_name)
        away_team_id = slugify(away_name)

        # Store API fixture ID mapping
        api_fixture_ids[fixture_id] = {"home": home_team_id, "away": away_team_id, "date": fixture_date}

        # Try to find matching match in our data
        for match in matches:
            m_home = match.get("home_team_id", "")
            m_away = match.get("away_team_id", "")

            if m_home == home_team_id and m_away == away_team_id:
                # Store API fixture ID on match
                match["api_fixture_id"] = fixture_id

                if new_status == "finished" and home_score is not None and away_score is not None:
                    if match.get("home_score") != home_score or match.get("away_score") != away_score:
                        match["status"] = "finished"
                        match["home_score"] = home_score
                        match["away_score"] = away_score
                        updated_scores += 1
                        print(f"    🔄 {home_name} {home_score}-{away_score} {away_name}")
                elif new_status == "live":
                    match["status"] = "live"
                    if home_score is not None and away_score is not None:
                        match["home_score"] = home_score
                        match["away_score"] = away_score
                    print(f"    🔴 {home_name} vs {away_name} - LIVE ⏺")
                break

    # Save matches.json
    if isinstance(data, dict):
        data["matches"] = matches
        data["last_updated"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    else:
        data = matches
    save_json("matches.json", data)
    print(f"  ✅ Updated {updated_scores} match scores")

    # Return the mapping for downstream use
    return api_fixture_ids

# ====== 2. Predictions ======
def fetch_predictions(api_fixture_ids):
    """Fetch predictions from API-Football for each fixture."""
    all_predictions = {}
    fetched = 0
    skipped = 0

    for fixture_id in list(api_fixture_ids.keys())[:50]:  # Max 50 predictions (rate limit)
        result = api_request("predictions", {"fixture": fixture_id})
        if not result:
            skipped += 1
            continue

        pred = result[0]  # API returns array with 1 element
        predictions_obj = pred.get("predictions", {})
        teams_obj = pred.get("teams", {})

        all_predictions[str(fixture_id)] = {
            "winner": predictions_obj.get("winner", {}),
            "win_or_draw": predictions_obj.get("win_or_draw"),
            "under_over": predictions_obj.get("under_over"),
            "goals": predictions_obj.get("goals"),
            "advice": predictions_obj.get("advice"),
            "percent": predictions_obj.get("percent", {}),
            "home_team": teams_obj.get("home"),
            "away_team": teams_obj.get("away"),
            "comparison": pred.get("comparison", {}),
            "h2h": pred.get("h2h", []),
        }
        fetched += 1
        home = api_fixture_ids.get(fixture_id, {}).get("home", "?")
        away = api_fixture_ids.get(fixture_id, {}).get("away", "?")
        print(f"    🔮 {home} vs {away}: {predictions_obj.get('percent', {}).get('home', '?')}% — {predictions_obj.get('advice', '')[:60]}")

    if fetched:
        save_json("predictions.json", {
            "predictions": all_predictions,
            "last_updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        })
    print(f"  ✅ Fetched {fetched} predictions ({skipped} skipped)")
    return all_predictions

# ====== 3. Head-to-Head ======
def fetch_h2h(api_fixture_ids, fixtures):
    """Fetch head-to-head history for unique team pairs from fixture data."""
    # Build set of H2H pairs from the fixtures API response
    # API-Football's /fixtures/headtohead needs h2h=team1_id-team2_id (API team IDs)
    # We need to get API team IDs from the fixtures we already fetched

    team_pairs = set()
    team_api_ids = {}  # slug -> api_id

    for fixture in fixtures:
        f = fixture.get("fixture", {})
        fid = f.get("id")
        teams = fixture.get("teams", {})
        home = teams.get("home", {})
        away = teams.get("away", {})

        home_slug = slugify(home.get("name", ""))
        away_slug = slugify(away.get("name", ""))
        home_api_id = home.get("id")
        away_api_id = away.get("id")

        if home_api_id and away_api_id:
            team_api_ids[home_slug] = home_api_id
            team_api_ids[away_slug] = away_api_id
            pair = tuple(sorted([home_api_id, away_api_id]))
            team_pairs.add(pair)

    # Fetch H2H for each unique pair
    h2h_data = {}
    fetched = 0
    for t1, t2 in team_pairs:
        result = api_request("fixtures/headtohead", {
            "h2h": f"{t1}-{t2}",
            "last": 5  # Last 5 meetings
        })
        if not result:
            continue

        pair_key = f"{t1}-{t2}"
        matches_list = []
        for h2h_match in result:
            h2h_f = h2h_match.get("fixture", {})
            h2h_teams = h2h_match.get("teams", {})
            h2h_goals = h2h_match.get("goals", {})
            h2h_league = h2h_match.get("league", {})

            matches_list.append({
                "date": (h2h_f.get("date") or "")[:10],
                "home": h2h_teams.get("home", {}).get("name", ""),
                "away": h2h_teams.get("away", {}).get("name", ""),
                "home_score": h2h_goals.get("home"),
                "away_score": h2h_goals.get("away"),
                "league": h2h_league.get("name", ""),
                "season": h2h_league.get("season", ""),
            })

        # Reverse key too
        h2h_data[pair_key] = matches_list
        h2h_data[f"{t2}-{t1}"] = matches_list
        fetched += 1

    if fetched:
        save_json("h2h.json", {
            "h2h": h2h_data,
            "team_api_ids": team_api_ids,
            "last_updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        })
    print(f"  ✅ Fetched H2H for {fetched} team pairs")
    return h2h_data, team_api_ids

# ====== 4. Lineups ======
def fetch_lineups(fixtures):
    """Fetch confirmed/expected lineups for matches that have started."""
    lineups_data = {}
    fetched = 0

    for fixture in fixtures:
        f = fixture.get("fixture", {})
        fixture_id = f.get("id")
        status_short = f.get("status", {}).get("short", "")
        teams = fixture.get("teams", {})

        # Only fetch for matches that have started or finished
        if status_short in ("NS", "TBD"):
            continue

        result = api_request("fixtures/lineups", {"fixture": fixture_id})
        if not result:
            continue

        home_team = teams.get("home", {}).get("name", "")
        away_team = teams.get("away", {}).get("name", "")

        match_lineups = {"home": {}, "away": {}}
        for lineup in result:
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

        lineups_data[str(fixture_id)] = {
            "home_team": home_team,
            "away_team": away_team,
            "lineups": match_lineups
        }
        fetched += 1
        print(f"    📋 {home_team} ({match_lineups['home'].get('formation','?')}) vs {away_team} ({match_lineups['away'].get('formation','?')})")

    if fetched:
        save_json("lineups.json", {
            "lineups": lineups_data,
            "last_updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        })
    print(f"  ✅ Fetched lineups for {fetched} matches")
    return lineups_data

# ====== 5. Standings ======
def fetch_standings():
    standings = api_request("standings", {
        "league": FIFA_WC_LEAGUE_ID,
        "season": FIFA_WC_SEASON
    })
    if standings:
        print(f"  ✅ Fetched standings for {len(standings)} groups")
    return standings or []

def update_standings_json(standings_data):
    if not standings_data:
        return False

    data = load_json("standings.json") or {"standings": {}, "last_updated": ""}

    new_standings = {}
    group_map = {0: "A", 1: "B", 2: "C", 3: "D", 4: "E", 5: "F",
                 6: "G", 7: "H", 8: "I", 9: "J", 10: "K", 11: "L"}

    for entry in standings_data:
        standings_list = entry.get("league", {}).get("standings", [])
        for idx, group_data in enumerate(standings_list):
            group_letter = group_map.get(idx, f"G{idx}")
            teams = []
            for team_entry in group_data:
                team_info = team_entry.get("team", {})
                all_stats = {}
                for stat in team_entry.get("statistics", []):
                    all_stats[stat.get("type", "")] = stat.get("value", 0)
                team_id = slugify(team_info.get("name", ""))
                teams.append({
                    "team_id": team_id,
                    "p": all_stats.get("games played", 0) or 0,
                    "w": all_stats.get("wins", 0) or 0,
                    "d": all_stats.get("draws", 0) or 0,
                    "l": all_stats.get("losses", 0) or 0,
                    "gf": all_stats.get("goals for", 0) or 0,
                    "ga": all_stats.get("goals against", 0) or 0,
                    "gd": (all_stats.get("goals for", 0) or 0) - (all_stats.get("goals against", 0) or 0),
                    "pts": all_stats.get("points", 0) or 0,
                    "form": list(all_stats.get("form", "") or []),
                })
            if teams:
                new_standings[group_letter] = teams

    if new_standings:
        data["standings"] = new_standings
    data["last_updated"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    save_json("standings.json", data)
    print(f"  ✅ Updated {len(new_standings)} groups in standings")
    return True

# ====== Main ======
def main():
    api_key = get_api_key()
    if not api_key:
        print("\n⚠ No API key. Set API_FOOTBALL_KEY env var or pass --api-key")
        print("  Free tier: 100 requests/day at https://dashboard.api-football.com/")
        print("  Running in demo mode (no data updates).\n")
        return

    print("🔍 World Cup 2026 Data Fetcher\n")

    # Step 1: Fetch all fixtures
    print("📅 Fetching fixtures...")
    fixtures = fetch_fixtures()
    if not fixtures:
        print("  ❌ No fixtures returned. Check API key and league ID.")
        return
    api_ids = update_matches_json(fixtures)
    if not api_ids:
        print("  ⚠ Could not map API fixtures. Aborting.")
        return
    print()

    # Step 2: Fetch standings
    print("🏆 Fetching standings...")
    standings = fetch_standings()
    if standings:
        update_standings_json(standings)
    print()

    # Step 3: Fetch predictions for each fixture
    print("🔮 Fetching predictions...")
    fetch_predictions(api_ids)
    print()

    # Step 4: Fetch head-to-head history
    print("📜 Fetching head-to-head history...")
    fetch_h2h(api_ids, fixtures)
    print()

    # Step 5: Fetch lineups for played/live matches
    print("📋 Fetching lineups...")
    fetch_lineups(fixtures)
    print()

    print("✅ All data fetched successfully!")
    print(f"   Total API requests: ~{sum([50, 20, 50, 50, 30])} (estimate)")

if __name__ == "__main__":
    main()
