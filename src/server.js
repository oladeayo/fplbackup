const express = require('express');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS middleware for Vercel
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

// Health check endpoint for Vercel
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// Endpoint to fetch bootstrap static data
app.get('/api/bootstrap-static', async (req, res) => {
  try {
    const response = await axios.get('https://fantasy.premierleague.com/api/bootstrap-static/');
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch bootstrap static data' });
  }
});

// Analyze manager endpoint
app.get('/api/analyze-manager/:managerId', async (req, res) => {
  try {
    const { managerId } = req.params;
    const leagueId = 314;
    
    const [playerDataResponse, managerEntryResponse, historyResponse, leagueResponse] = await Promise.all([
      axios.get('https://fantasy.premierleague.com/api/bootstrap-static/'),
      axios.get(`https://fantasy.premierleague.com/api/entry/${managerId}/`),
      axios.get(`https://fantasy.premierleague.com/api/entry/${managerId}/history/`),
      axios.get(`https://fantasy.premierleague.com/api/leagues-classic/${leagueId}/standings/`)
    ]);

    const playerData = playerDataResponse.data;
    const managerEntryData = managerEntryResponse.data;
    const historyData = historyResponse.data;
    const leagueData = leagueResponse.data;

    const currentGameweek = playerData.events.find(event => event.is_current).id;
    const topManagerPoints = leagueData.standings.results[0].total;
    
    let totalCaptaincyPoints = 0;
    let totalPointsActive = 0;
    let totalPointsLostOnBench = 0;
    const playerStats = {};
    const positionPoints = { GKP: {}, DEF: {}, MID: {}, FWD: {} };
    const suspensionWatchlist = [];
    const transferSuggestions = { GKP: [], DEF: [], MID: [], FWD: [] };
    const captaincyOptions = ['Salah', 'Saka', 'Palmer', 'Mbeumo', 'Son', 'Haaland', 'Isak', 'Watkins', 'Bruno']
      .map(name => {
        const player = playerData.elements.find(p => p.web_name === name);
        return player ? {
          name: player.web_name,
          form: player.form,
          photo: `https://resources.premierleague.com/premierleague/photos/players/110x140/p${player.code}.png`
        } : null;
      })
      .filter(Boolean);

    const weeklyPoints = new Array(currentGameweek).fill(0);
    const weeklyRanks = new Array(currentGameweek).fill(0);
    
    let highestPoints = 0;
    let highestPointsGW = 0;
    let lowestPoints = Infinity;
    let lowestPointsGW = 0;
    let highestRank = Infinity;
    let highestRankGW = 0;
    let lowestRank = 0;
    let lowestRankGW = 0;

    // Process suspension watchlist
    playerData.elements.forEach(player => {
      if (player.yellow_cards >= 4 || player.red_cards > 0) {
        suspensionWatchlist.push({
          name: player.web_name,
          team: playerData.teams.find(t => t.id === player.team).short_name,
          yellowCards: player.yellow_cards,
          redCards: player.red_cards,
          photo: `https://resources.premierleague.com/premierleague/photos/players/110x140/p${player.code}.png`
        });
      }
    });

    // Calculate FD Index and populate transfer suggestions
    playerData.elements.forEach(player => {
      const position = ["GKP", "DEF", "MID", "FWD"][player.element_type - 1];
      const fdIndex = parseFloat(player.form) / parseFloat(player.difficulty);
      if (!isNaN(fdIndex) && fdIndex > 0) {
        transferSuggestions[position].push({
          name: player.web_name,
          team: playerData.teams.find(t => t.id === player.team).short_name,
          fdIndex,
          photo: `https://resources.premierleague.com/premierleague/photos/players/110x140/p${player.code}.png`,
          form: player.form,
          teamLogo: `https://resources.premierleague.com/premierleague/badges/t${player.team}.svg`
        });
      }
    });

    // Sort and limit transfer suggestions
    Object.keys(transferSuggestions).forEach(pos => {
      transferSuggestions[pos] = transferSuggestions[pos]
        .sort((a, b) => b.fdIndex - a.fdIndex)
        .slice(0, pos === 'GKP' ? 3 : pos === 'DEF' ? 4 : pos === 'MID' ? 5 : 4);
    });

    // Get current team and fixtures with xGI data
    const currentTeam = [];
    const managerPicksResponse = await axios.get(`https://fantasy.premierleague.com/api/entry/${managerId}/event/${currentGameweek}/picks/`);
    const managerPicks = managerPicksResponse.data.picks;

    for (const pick of managerPicks) {
      const player = playerData.elements.find(p => p.id === pick.element);
      if (!player) continue;

      const fixturesResponse = await axios.get(`https://fantasy.premierleague.com/api/element-summary/${player.id}/`);
      const nextFixtures = fixturesResponse.data.fixtures.slice(0, 5).map(fixture => {
        const isHome = fixture.is_home;
        const opponent = playerData.teams.find(t => t.id === (isHome ? fixture.team_a : fixture.team_h)).short_name;
        return {
          opponent,
          isHome,
          difficulty: fixture.difficulty
        };
      });

      // Calculate xGI and GI for last 3 gameweeks
      const last3GW = fixturesResponse.data.history.slice(-3);
      const xGI = last3GW.reduce((sum, game) => sum + (game.expected_goals + game.expected_assists), 0);
      const GI = last3GW.reduce((sum, game) => sum + (game.goals_scored + game.assists), 0);
      const last3GWPoints = last3GW.reduce((sum, game) => sum + game.total_points, 0);

      currentTeam.push({
        name: player.web_name,
        position: ["GKP", "DEF", "MID", "FWD"][player.element_type - 1],
        nextFixtures,
        last3GWPoints,
        xGI,
        GI,
        photo: `https://resources.premierleague.com/premierleague/photos/players/110x140/p${player.code}.png`
      });
    }

    // Process gameweek data
    for (let gw = 1; gw <= currentGameweek; gw++) {
      const managerPicksResponse = await axios.get(`https://fantasy.premierleague.com/api/entry/${managerId}/event/${gw}/picks/`);
      const managerPicksData = managerPicksResponse.data;
      const managerPicks = managerPicksData.picks;

      const isBenchBoost = managerPicksData.active_chip === "bboost";
      const isTripleCaptain = managerPicksData.active_chip === "3xc";

      let gwPoints = 0;
      
      for (const pick of managerPicks) {
        const playerId = pick.element;
        const player = playerData.elements.find(p => p.id == playerId);
        if (!player) continue;

        const playerHistoryResponse = await axios.get(`https://fantasy.premierleague.com/api/element-summary/${playerId}/`);
        const playerHistory = playerHistoryResponse.data.history;
        const gameweekHistory = playerHistory.find(history => history.round === gw);
        const pointsThisWeek = gameweekHistory ? gameweekHistory.total_points : 0;

        if (!playerStats[playerId]) {
          playerStats[playerId] = {
            name: player.web_name,
            team: playerData.teams[player.team - 1].name,
            position: ["GKP", "DEF", "MID", "FWD"][player.element_type - 1],
            totalPointsActive: 0,
            gwInSquad: 0,
            starts: 0,
            cappedPoints: 0,
            playerPoints: 0
          };
        }

        const inStarting11 = pick.position <= 11;
        const isCaptain = pick.is_captain;

        playerStats[playerId].playerPoints += pointsThisWeek;

        if (inStarting11 || isBenchBoost) {
          let activePoints = pointsThisWeek;
          if (isCaptain) {
            activePoints *= isTripleCaptain ? 3 : 2;
            totalCaptaincyPoints += activePoints;
            playerStats[playerId].cappedPoints += activePoints;
          }

          playerStats[playerId].totalPointsActive += activePoints;
          totalPointsActive += activePoints;
          gwPoints += activePoints;

          const position = playerStats[playerId].position;
          if (!positionPoints[position][playerId]) {
            positionPoints[position][playerId] = {
              name: playerStats[playerId].name,
              points: 0
            };
          }
          positionPoints[position][playerId].points += activePoints;

          if (inStarting11) playerStats[playerId].starts += 1;
          playerStats[playerId].gwInSquad += 1;
        } else {
          totalPointsLostOnBench += pointsThisWeek;
        }
      }
      
      // Update weekly stats
      weeklyPoints[gw - 1] = gwPoints;
      const gwRank = historyData.current.find(h => h.event === gw)?.overall_rank || 0;
      weeklyRanks[gw - 1] = gwRank;
      
      // Update highest/lowest tracking
      if (gwPoints > highestPoints) {
        highestPoints = gwPoints;
        highestPointsGW = gw;
      }
      if (gwPoints < lowestPoints) {
        lowestPoints = gwPoints;
        lowestPointsGW = gw;
      }
      if (gwRank < highestRank) {
        highestRank = gwRank;
        highestRankGW = gw;
      }
      if (gwRank > lowestRank) {
        lowestRank = gwRank;
        lowestRankGW = gw;
      }
    }

    const analysis = {
      managerInfo: {
        name: `${managerEntryData.player_first_name} ${managerEntryData.player_last_name}`,
        teamName: managerEntryData.name,
        overallRanking: managerEntryData.summary_overall_rank?.toLocaleString() || "N/A",
        managerPoints: managerEntryData.summary_overall_points,
        allChipsUsed: historyData.chips.map(chip => chip.name).join(", ") || "None",
        lastSeasonRank: historyData.past.length > 0 ? historyData.past[historyData.past.length - 1].rank.toLocaleString() : "Didn't Play",
        seasonBeforeLastRank: historyData.past.length > 1 ? historyData.past[historyData.past.length - 2].rank.toLocaleString() : "Didn't Play",
        pointDifference: managerEntryData.summary_overall_points - topManagerPoints,
        totalPointsLostOnBench,
        totalCaptaincyPoints,
        currentGameweek,
        highestPoints,
        highestPointsGW,
        lowestPoints,
        lowestPointsGW,
        highestRank: highestRank.toLocaleString(),
        highestRankGW,
        lowestRank: lowestRank.toLocaleString(),
        lowestRankGW
      },
      playerStats: Object.values(playerStats).sort((a, b) => b.totalPointsActive - a.totalPointsActive),
      positionSummary: Object.entries(positionPoints).map(([position, players]) => ({
        position,
        totalPoints: Object.values(players).reduce((sum, player) => sum + player.points, 0),
        players: Object.values(players).sort((a, b) => b.points - a.points),
        topPlayer: Object.values(players).sort((a, b) => b.points - a.points)[0]
      })),
      weeklyPoints,
      weeklyRanks,
      currentTeam,
      suspensionWatchlist,
      transferSuggestions,
      captaincyOptions
    };

    res.json(analysis);
  } catch (error) {
    console.error('Error analyzing manager:', error);
    res.status(500).json({ error: 'Failed to analyze manager' });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});