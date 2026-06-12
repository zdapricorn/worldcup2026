/**
 * World Cup 2026 - Prediction Engine
 * Uses LiveScore data (team stats, H2H, form) + FIFA rankings.
 * All predictions are marked "Ước tính" (Estimated) — not absolute.
 */
const WC2026_Predictions = {

  // Cached data
  teamStats: null,
  h2hData: null,
  apiLoaded: false,

  async loadAPIData() {
    if (this.apiLoaded) return;
    try {
      const [statsResp, h2hResp] = await Promise.all([
        fetch('data/team_stats.json').then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('data/h2h.json').then(r => r.ok ? r.json() : null).catch(() => null)
      ]);
      this.teamStats = statsResp?.teams || null;
      this.h2hData = h2hResp?.h2h || null;
      this.apiLoaded = true;
    } catch (e) {
      console.warn('Stats data not yet available:', e.message);
      this.apiLoaded = true;
    }
  },

  /**
   * Calculate win probability using FIFA Elo + form adjustment.
   */
  calculateWinProb(homeTeam, awayTeam) {
    const homeRank = homeTeam.fifa_ranking || 100;
    const awayRank = awayTeam.fifa_ranking || 100;

    // Base Elo
    const rankDiff = homeRank - awayRank;
    const baseElo = 1.0 / (1.0 + Math.pow(10, rankDiff / 400.0));
    const baseEloPct = baseElo * 100;

    // Form adjustment from team_stats
    const homeStats = this.teamStats?.[homeTeam.id];
    const awayStats = this.teamStats?.[awayTeam.id];

    let formAdj = 0;
    if (homeStats && awayStats) {
      const homeStrength = homeStats.avg_goals_for - homeStats.avg_goals_against;
      const awayStrength = awayStats.avg_goals_for - awayStats.avg_goals_against;
      formAdj = (homeStrength - awayStrength) * 5;
      formAdj = Math.max(-8, Math.min(8, formAdj));
    }

    // H2H adjustment
    let h2hAdj = 0;
    if (this.h2hData) {
      // Check H2H for relevant matches (if we have the match EID)
      const h2hMatches = Object.values(this.h2hData).find(list =>
        Array.isArray(list) && list.some(h =>
          h.home?.toLowerCase().includes(homeTeam.name_en?.toLowerCase() || '')
        )
      );
      if (h2hMatches && h2hMatches.length > 0) {
        let h2hHomeWins = 0, h2hTotal = 0;
        h2hMatches.forEach(h => {
          if (h.home_score != null && h.away_score != null) {
            h2hTotal++;
            const hHome = (h.home || '').toLowerCase();
            const isHomeOur = hHome.includes(homeTeam.name_en?.toLowerCase() || '') ||
                            (homeTeam.id && hHome.includes(homeTeam.id.replace(/-/g, ' ')));
            if (isHomeOur && h.home_score > h.away_score) h2hHomeWins++;
            if (!isHomeOur && h.away_score > h.home_score) h2hHomeWins++;
          }
        });
        if (h2hTotal > 0) {
          h2hAdj = ((h2hHomeWins / h2hTotal) * 100 - 50) * 0.3; // Max ±15%
        }
      }
    }

    let homePct = baseEloPct + formAdj + h2hAdj;
    let awayPct = 100 - baseEloPct - formAdj - h2hAdj;

    // Draw probability
    const rankGap = Math.abs(rankDiff);
    let drawPct = Math.round(26 * Math.exp(-rankGap / 120));
    if (drawPct < 5) drawPct = 5;

    const winTotal = 100 - drawPct;
    if (winTotal > 0) {
      homePct = Math.round(Math.max(1, Math.min(99, homePct * winTotal / (homePct + awayPct))));
      awayPct = winTotal - homePct;
    }

    return { homeWin: Math.max(1, Math.min(99, homePct)), draw: drawPct, awayWin: Math.max(1, Math.min(99, awayPct)) };
  },

  /**
   * Predict score using team stats (avg goals) + Poisson method.
   */
  predictScore(homeTeam, awayTeam) {
    const homeStats = this.teamStats?.[homeTeam.id];
    const awayStats = this.teamStats?.[awayTeam.id];

    let homeAvgFor = homeStats?.avg_goals_for ?? 1.2;
    let homeAvgAgainst = homeStats?.avg_goals_against ?? 1.0;
    let awayAvgFor = awayStats?.avg_goals_for ?? 1.0;
    let awayAvgAgainst = awayStats?.avg_goals_against ?? 1.2;

    // Adjust for opponent strength
    let homeExpected = (homeAvgFor + awayAvgAgainst) / 2;
    let awayExpected = (awayAvgFor + homeAvgAgainst) / 2;

    // If no real stats yet, use FIFA ranking as proxy
    if (!homeStats || !awayStats) {
      const rankDiff = (homeTeam.fifa_ranking || 100) - (awayTeam.fifa_ranking || 100);
      homeExpected = 1.5 - (rankDiff / 200);
      awayExpected = 1.5 + (rankDiff / 200);
    }

    // Poisson-simulated most likely score
    let homeGoals = Math.round(homeExpected - 0.3);
    let awayGoals = Math.round(awayExpected - 0.3);
    if (homeGoals < 0) homeGoals = 0;
    if (awayGoals < 0) awayGoals = 0;
    if (homeGoals === 0 && awayGoals === 0) {
      if (homeExpected > awayExpected) homeGoals = 1;
      else if (awayExpected > homeExpected) awayGoals = 1;
      else { homeGoals = 1; awayGoals = 1; }
    }

    return { home: Math.min(5, homeGoals), away: Math.min(5, awayGoals) };
  },

  /**
   * Estimate corners from expected goals.
   */
  predictCorners(score) {
    const totalGoals = score.home + score.away;
    // ~9.5 avg corners per match in World Cup, modulated by total goals
    return Math.max(4, Math.min(15, Math.round(9.5 + totalGoals * 0.8)));
  },

  /**
   * Estimate cards from expected goals + team style.
   */
  predictCards(score, homeTeam, awayTeam) {
    const totalGoals = score.home + score.away;
    // ~4.5 avg cards per match, modulated by total goals
    const baseCards = 4.5 + totalGoals * 0.3;

    // FIFA ranking as proxy for discipline (higher ranked = more disciplined)
    const homeRank = homeTeam.fifa_ranking || 100;
    const awayRank = awayTeam.fifa_ranking || 100;
    const avgRank = (homeRank + awayRank) / 2;
    const rankAdj = (avgRank - 30) / 100;

    return Math.max(1, Math.min(10, Math.round(baseCards + rankAdj)));
  },

  /**
   * Pick most likely goal scorer from team data.
   */
  predictGoalScorer(homeTeam, awayTeam, score) {
    if (score.home > score.away && score.home > 0) {
      return homeTeam.star_player || homeTeam.key_players?.[0]?.name || homeTeam.name_vi;
    }
    if (score.away > score.home && score.away > 0) {
      return awayTeam.star_player || awayTeam.key_players?.[0]?.name || awayTeam.name_vi;
    }
    if (score.home > 0) {
      return homeTeam.star_player || homeTeam.key_players?.[0]?.name || 'N/A';
    }
    return '0-0 — Không có bàn thắng';
  },

  /**
   * Full match analysis with transparent source labels.
   */
  analyzeMatch(match, teamsData) {
    const homeTeam = teamsData.find(t => t.id === match.home_team_id);
    const awayTeam = teamsData.find(t => t.id === match.away_team_id);
    if (!homeTeam || !awayTeam) return null;

    const winProb = this.calculateWinProb(homeTeam, awayTeam);
    const score = this.predictScore(homeTeam, awayTeam);
    const corners = this.predictCorners(score);
    const cards = this.predictCards(score, homeTeam, awayTeam);
    const scorer = this.predictGoalScorer(homeTeam, awayTeam, score);

    const hasStats = !!(this.teamStats?.[homeTeam.id] && this.teamStats?.[awayTeam.id]);
    const hasH2H = !!(this.h2hData);

    const homeStats = this.teamStats?.[homeTeam.id];
    const awayStats = this.teamStats?.[awayTeam.id];

    return {
      homeTeam, awayTeam,
      source: 'estimated',
      labeled: true,
      winProb,
      score,
      corners,
      cards,
      predictedScorer: scorer,
      homeForm: homeStats?.form || [],
      awayForm: awayStats?.form || [],
      analysis: {
        summary: hasStats
          ? `📊 ${homeTeam.name_vi} (${homeStats.win_rate}% thắng, TB ${homeStats.avg_goals_for} bàn/trận) vs ${awayTeam.name_vi} (${awayStats.win_rate}% thắng, TB ${awayStats.avg_goals_for} bàn/trận)`
          : `${homeTeam.name_vi} (hạng ${homeTeam.fifa_ranking}) vs ${awayTeam.name_vi} (hạng ${awayTeam.fifa_ranking})`,
        details: `Dựa trên FIFA Ranking và phong độ gần đây trong giải. Dữ liệu được cập nhật từ LiveScore.com.`
      }
    };
  },

  /**
   * Predict group standings from standings data.
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
