/**
 * World Cup 2026 - Prediction Engine
 * Powered by API-Football predictions + real statistics.
 *
 * Fallback behavior: if API data is not yet available (workflow hasn't run),
 * show a loading message instead of generating synthetic predictions.
 */
const WC2026_Predictions = {

  // Load API predictions from predictions.json
  apiPredictions: null,
  apiH2H: null,
  apiLineups: null,
  apiLoaded: false,

  async loadAPIData() {
    if (this.apiLoaded) return;
    try {
      const [predResp, h2hResp, lineupResp] = await Promise.all([
        fetch('data/predictions.json').then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('data/h2h.json').then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('data/lineups.json').then(r => r.ok ? r.json() : null).catch(() => null)
      ]);
      this.apiPredictions = predResp?.predictions || null;
      this.apiH2H = h2hResp?.h2h || null;
      this.apiLineups = lineupResp?.lineups || null;
      this.apiLoaded = true;
    } catch (e) {
      console.warn('API data not yet available:', e.message);
      this.apiLoaded = true;
    }
  },

  /**
   * Get prediction for a specific match by its API fixture ID.
   */
  getAPIPrediction(apiFixtureId) {
    if (!this.apiPredictions || !apiFixtureId) return null;
    return this.apiPredictions[String(apiFixtureId)] || null;
  },

  /**
   * Get H2H matches between two API team IDs.
   */
  getH2H(teamApiId1, teamApiId2) {
    if (!this.apiH2H) return null;
    // Try both orderings
    const key = `${Math.min(teamApiId1, teamApiId2)}-${Math.max(teamApiId1, teamApiId2)}`;
    const reverseKey = `${Math.max(teamApiId1, teamApiId2)}-${Math.min(teamApiId1, teamApiId2)}`;
    return this.apiH2H[key] || this.apiH2H[reverseKey] || null;
  },

  /**
   * Get lineups for a specific fixture.
   */
  getLineups(apiFixtureId) {
    if (!this.apiLineups || !apiFixtureId) return null;
    return this.apiLineups[String(apiFixtureId)] || null;
  },

  /**
   * Main analysis for a match — uses API data if available.
   * Returns null if no data yet (caller should show "Loading...").
   */
  analyzeMatch(match, teamsData) {
    const homeTeam = teamsData.find(t => t.id === match.home_team_id);
    const awayTeam = teamsData.find(t => t.id === match.away_team_id);
    if (!homeTeam || !awayTeam) return null;

    const apiFixtureId = match.api_fixture_id;
    const apiPred = this.getAPIPrediction(apiFixtureId);

    if (apiPred) {
      // Use REAL API data for predictions
      const pct = apiPred.percent || {};
      const compare = apiPred.comparison || {};
      const h2hComp = compare['h2h'] || {};
      const goalsPred = apiPred.goals || {};
      const winner = apiPred.winner || {};

      // Win probabilities
      const homeWinPct = parseFloat(pct.home) || 0;
      const drawPct = parseFloat(pct.draw) || 0;
      const awayWinPct = parseFloat(pct.away) || 0;

      // Predicted score
      const predictedScore = {
        home: parseInt(goalsPred.home) || 0,
        away: parseInt(goalsPred.away) || 0
      };

      // Under/Over
      const underOver = apiPred.under_over || '';

      // Extract corner & card stats from comparison if available
      const homeStats = {};
      const awayStats = {};
      if (compare['attacks']) {
        homeStats.attacks = compare['attacks'].home;
        awayStats.attacks = compare['attacks'].away;
      }
      if (compare['dangerous_attacks']) {
        homeStats.dangerousAttacks = compare['dangerous_attacks'].home;
        awayStats.dangerousAttacks = compare['dangerous_attacks'].away;
      }
      if (compare['corners']) {
        homeStats.corners = compare['corners'].home;
        awayStats.corners = compare['corners'].away;
      }
      if (compare['yellow_cards']) {
        homeStats.yellowCards = compare['yellow_cards'].home;
        awayStats.yellowCards = compare['yellow_cards'].away;
      }

      // Predicted corners (from API comparison or estimate from goals)
      const avgHomeCorners = parseFloat(homeStats.corners) || homeTeam.corners_avg || 5;
      const avgAwayCorners = parseFloat(awayStats.corners) || awayTeam.corners_avg || 4;
      const predictCorners = Math.max(4, Math.min(15,
        Math.round(avgHomeCorners + avgAwayCorners + (predictedScore.home + predictedScore.away) * 0.3)
      ));

      // Predicted cards (from API comparison or estimate)
      const avgHomeCards = parseFloat(homeStats.yellowCards) || 2;
      const avgAwayCards = parseFloat(awayStats.yellowCards) || 2;
      const predictCards = Math.max(1, Math.min(10,
        Math.round(avgHomeCards + avgAwayCards + (predictedScore.home + predictedScore.away) * 0.2)
      ));

      return {
        homeTeam,
        awayTeam,
        source: 'api',
        apiPrediction: apiPred,
        winProb: {
          homeWin: Math.round(homeWinPct),
          draw: Math.round(drawPct),
          awayWin: Math.round(awayWinPct)
        },
        score: predictedScore,
        corners: predictCorners,
        cards: predictCards,
        predictedScorer: winner?.name || (predictedScore.home > 0 ? homeTeam.star_player : awayTeam.star_player),
        overUnder: underOver,
        advice: apiPred.advice || '',
        comparison: compare,
        analysis: {
          summary: apiPred.advice ||
            `${homeTeam.name_vi} ${homeWinPct}% — ${awayTeam.name_vi} ${awayWinPct}% — Hòa ${drawPct}%. ${underOver ? 'Tổng bàn: ' + underOver : ''}`,
          details: `Dựa trên dữ liệu thống kê thực tế từ API-Football.`
        }
      };
    }

    // No API data yet — return a lightweight object with status info
    return {
      homeTeam,
      awayTeam,
      source: 'pending',
      winProb: { homeWin: 0, draw: 0, awayWin: 0 },
      score: { home: '?', away: '?' },
      corners: '?',
      cards: '?',
      predictedScorer: 'Đang cập nhật...',
      analysis: {
        summary: '⏳ Dữ liệu dự đoán thực tế đang được cập nhật từ API-Football. Vui lòng quay lại sau vài phút hoặc nhấn nút "🔄 Cập nhật dữ liệu" ở góc trên để kích hoạt workflow.',
        details: 'Hệ thống sẽ tự động cập nhật dữ liệu mỗi 30 phút.'
      }
    };
  },

  /**
   * Predict group standings (same as before, uses points/goal diff)
   */
  predictGroupStandings(standings, teamsData) {
    const result = {};
    for (const [group, teams] of Object.entries(standings)) {
      result[group] = [...teams].sort((a, b) => {
        if (b.pts !== a.pts) return b.pts - a.pts;
        if (b.gd !== a.gd) return b.gd - a.gd;
        if (b.gf !== a.gf) return b.gf - a.gf;
        return a.team_id.localeCompare(b.team_id);
      });
    }
    return result;
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = WC2026_Predictions;
}
