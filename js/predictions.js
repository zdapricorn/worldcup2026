/**
 * World Cup 2026 - Prediction Engine
 * Data-driven prediction models using Elo ratings, Poisson distribution,
 * and team statistics. All calculations are client-side.
 */
const WC2026_Predictions = {
  // Elo-based win probability calculation — FIXED formula
  calculateWinProb(homeRank, awayRank, homeAttack, awayDef, awayAttack, homeDef) {
    // Base Elo: expected score for home team
    // FIFA ranking: lower number = better team, so we invert for Elo
    const rankDiff = homeRank - awayRank;
    const baseElo = 1.0 / (1.0 + Math.pow(10, rankDiff / 400.0));
    const baseEloPct = baseElo * 100;

    // Team-strength adjustment (±8% max)
    const strDiff = (homeAttack + homeDef) - (awayAttack + awayDef);
    const strengthAdj = Math.max(-8, Math.min(8, strDiff * 0.05));

    let homePct = baseEloPct + strengthAdj;
    let awayPct = 100 - baseEloPct - strengthAdj;

    // Draw probability: highest when teams are evenly matched (max ~26%)
    const rankGap = Math.abs(rankDiff);
    let drawPct = Math.round(26 * Math.exp(-rankGap / 120));
    if (drawPct < 5) drawPct = 5;

    // Scale win probs to make room for draw
    const winTotal = 100 - drawPct;
    if (winTotal > 0) {
      homePct = Math.round(homePct * winTotal / (homePct + awayPct));
      awayPct = winTotal - homePct;
    }

    return {
      homeWin: Math.max(1, Math.min(99, homePct)),
      draw: drawPct,
      awayWin: Math.max(1, Math.min(99, awayPct))
    };
  },

  // Simple Poisson-based score prediction
  predictScore(homeAttack, awayDef, awayAttack, homeDef) {
    const homeStrength = (homeAttack / 100) * (1 - awayDef / 200);
    const awayStrength = (awayAttack / 100) * (1 - homeDef / 200);

    let homeGoals = Math.round(homeStrength * 3.2 - 0.3);
    let awayGoals = Math.round(awayStrength * 3.2 - 0.3);

    // Ensure at least some goals for non-zero games
    if (homeGoals < 0) homeGoals = 0;
    if (awayGoals < 0) awayGoals = 0;
    if (homeGoals === 0 && awayGoals === 0) {
      if (homeAttack > awayDef) homeGoals = 1;
      else if (awayAttack > homeDef) awayGoals = 1;
      else { homeGoals = 1; awayGoals = 1; }
    }

    return {
      home: Math.min(5, homeGoals),
      away: Math.min(5, awayGoals)
    };
  },

  // Corner prediction based on team style
  predictCorners(homeCornersAvg, awayCornersAvg, homeGoals, awayGoals) {
    let total = homeCornersAvg + awayCornersAvg + (homeGoals + awayGoals) * 0.5;
    return Math.max(4, Math.min(15, Math.round(total)));
  },

  // Card prediction based on discipline
  predictCards(homeDiscipline, awayDiscipline, homeGoals, awayGoals) {
    const avgDiscipline = (homeDiscipline + awayDiscipline) / 2;
    let cards = Math.round((100 - avgDiscipline) / 12 + (homeGoals + awayGoals) * 0.4);
    return Math.max(1, Math.min(10, cards));
  },

  // Full match analysis
  analyzeMatch(match, teamsData) {
    const homeTeam = teamsData.find(t => t.id === match.home_team_id);
    const awayTeam = teamsData.find(t => t.id === match.away_team_id);
    if (!homeTeam || !awayTeam) return null;

    const winProb = this.calculateWinProb(
      homeTeam.fifa_ranking, awayTeam.fifa_ranking,
      homeTeam.attacking_strength, awayTeam.defensive_strength,
      awayTeam.attacking_strength, homeTeam.defensive_strength
    );

    const score = this.predictScore(
      homeTeam.attacking_strength, awayTeam.defensive_strength,
      awayTeam.attacking_strength, homeTeam.defensive_strength
    );

    const corners = this.predictCorners(
      homeTeam.corners_avg, awayTeam.corners_avg,
      score.home, score.away
    );

    const cards = this.predictCards(
      homeTeam.discipline, awayTeam.discipline,
      score.home, score.away
    );

    // Predict goal scorer based on which team is favored
    let predictedScorer = 'Không có bàn thắng';
    if (score.home > score.away && score.home > 0) {
      predictedScorer = homeTeam.star_player;
    } else if (score.away > score.home && score.away > 0) {
      predictedScorer = awayTeam.star_player;
    } else if (score.home > 0) {
      predictedScorer = homeTeam.star_player;
    }

    return {
      homeTeam: { ...homeTeam, predicted_goals: score.home },
      awayTeam: { ...awayTeam, predicted_goals: score.away },
      winProb,
      score,
      corners,
      cards,
      predictedScorer,
      analysis: this.generateAnalysis(homeTeam, awayTeam, winProb, score)
    };
  },

  // Generate Vietnamese analysis text
  generateAnalysis(home, away, winProb, score) {
    const favorite = winProb.homeWin > winProb.awayWin ? home : away;
    const underdog = winProb.homeWin > winProb.awayWin ? away : home;
    const favProb = Math.max(winProb.homeWin, winProb.awayWin);

    const rankAdvantage = home.fifa_ranking < away.fifa_ranking
      ? `${home.name_vi} được đánh giá cao hơn ${Math.abs(home.fifa_ranking - away.fifa_ranking)} bậc trên BXH FIFA.`
      : `${away.name_vi} được đánh giá cao hơn ${Math.abs(home.fifa_ranking - away.fifa_ranking)} bậc trên BXH FIFA.`;

    const attackAnalysis = home.attacking_strength > away.attacking_strength
      ? `${home.name_vi} có hàng công mạnh hơn (${home.attacking_strength} vs ${away.attacking_strength}).`
      : `${away.name_vi} có hàng công mạnh hơn (${away.attacking_strength} vs ${home.attacking_strength}).`;

    return {
      summary: `${favorite.name_vi} được đánh giá cao hơn với ${favProb}% cơ hội chiến thắng. Dự đoán tỷ số ${score.home}-${score.away}.`,
      details: [rankAdvantage, attackAnalysis].join(' ')
    };
  },

  // Predict group standings
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

// Export for browser use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WC2026_Predictions;
}
