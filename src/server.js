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
    const leagueId = 314; // League ID for comparison with leader
    
    // Fetch all required data in parallel
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

    const currentGameweek = playerData.events.find(event => event.is_current)?.id || 
                          Math.max(...playerData.events.filter(e => e.finished).map(e => e.id));
    const topManagerPoints = leagueData.standings.results[0].total;
    
    // Initialize analysis data structure
    let totalCaptaincyPoints = 0;
    let totalPointsActive = 0;
    let totalPointsLostOnBench = 0;
    const playerStats = {};
    const positionPoints = { GKP: {}, DEF: {}, MID: {}, FWD: {} };

    // Process each gameweek
    const weeklyPoints = new Array(currentGameweek).fill(0);
    const weeklyRanks = new Array(currentGameweek).fill(0);
    
    // Track highest and lowest stats
    let highestPoints = 0;
    let highestPointsGW = 0;
    let lowestPoints = Infinity;
    let lowestPointsGW = 0;
    let highestRank = Infinity;
    let highestRankGW = 0;
    let lowestRank = 0;
    let lowestRankGW = 0;

    // Get current team and fixtures
    const currentTeam = [];
    const managerPicksResponse = await axios.get(`https://fantasy.premierleague.com/api/entry/${managerId}/event/${currentGameweek}/picks/`);
    const managerPicks = managerPicksResponse.data.picks;

    // Get transfer market insights
    const transfersInData = playerData.elements
      .sort((a, b) => b.transfers_in_event - a.transfers_in_event)
      .slice(0, 5)
      .map(p => ({
        name: p.web_name,
        team: playerData.teams.find(t => t.id === p.team).short_name,
        transfers: p.transfers_in_event,
        points: p.total_points,
        form: parseFloat(p.form)
      }));
      
    const transfersOutData = playerData.elements
      .sort((a, b) => b.transfers_out_event - a.transfers_out_event)
      .slice(0, 5)
      .map(p => ({
        name: p.web_name,
        team: playerData.teams.find(t => t.id === p.team).short_name,
        transfers: p.transfers_out_event,
        points: p.total_points,
        form: parseFloat(p.form)
      }));

    // Get transfer suggestions by position
    const transferSuggestions = {
      GKP: playerData.elements.filter(p => p.element_type === 1)
        .sort((a, b) => parseFloat(b.form) - parseFloat(a.form))
        .slice(0, 5)
        .map(p => ({
          name: p.web_name,
          team: playerData.teams.find(t => t.id === p.team).short_name,
          points: p.total_points,
          form: parseFloat(p.form),
          price: p.now_cost / 10
        })),
      DEF: playerData.elements.filter(p => p.element_type === 2)
        .sort((a, b) => parseFloat(b.form) - parseFloat(a.form))
        .slice(0, 5)
        .map(p => ({
          name: p.web_name,
          team: playerData.teams.find(t => t.id === p.team).short_name,
          points: p.total_points,
          form: parseFloat(p.form),
          price: p.now_cost / 10
        })),
      MID: playerData.elements.filter(p => p.element_type === 3)
        .sort((a, b) => parseFloat(b.form) - parseFloat(a.form))
        .slice(0, 5)
        .map(p => ({
          name: p.web_name,
          team: playerData.teams.find(t => t.id === p.team).short_name,
          points: p.total_points,
          form: parseFloat(p.form),
          price: p.now_cost / 10
        })),
      FWD: playerData.elements.filter(p => p.element_type === 4)
        .sort((a, b) => parseFloat(b.form) - parseFloat(a.form))
        .slice(0, 5)
        .map(p => ({
          name: p.web_name,
          team: playerData.teams.find(t => t.id === p.team).short_name,
          points: p.total_points,
          form: parseFloat(p.form),
          price: p.now_cost / 10
        }))
    };

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

      // Calculate points for last 3 gameweeks
      const last3GWPoints = fixturesResponse.data.history.slice(-3).reduce((sum, game) => sum + game.total_points, 0);

      currentTeam.push({
        name: player.web_name,
        team: playerData.teams.find(t => t.id === player.team).short_name,
        position: ["GKP", "DEF", "MID", "FWD"][player.element_type - 1],
        nextFixtures,
        last3GWPoints,
        form: parseFloat(player.form),
        totalPoints: player.total_points
      });
    }

    // Process historical data for each gameweek
    for (let gw = 1; gw <= currentGameweek; gw++) {
      try {
        const managerPicksResponse = await axios.get(`https://fantasy.premierleague.com/api/entry/${managerId}/event/${gw}/picks/`);
        const managerPicksData = managerPicksResponse.data;
        const gwPicks = managerPicksData.picks;

        const isBenchBoost = managerPicksData.active_chip === "bboost";
        const isTripleCaptain = managerPicksData.active_chip === "3xc";

        let gwPoints = 0;
        
        for (const pick of gwPicks) {
          const playerId = pick.element;
          const player = playerData.elements.find(p => p.id === playerId);
          if (!player) continue;

          const playerHistoryResponse = await axios.get(`https://fantasy.premierleague.com/api/element-summary/${playerId}/`);
          const playerHistory = playerHistoryResponse.data.history;
          const gameweekHistory = playerHistory.find(history => history.round === gw);
          const pointsThisWeek = gameweekHistory ? gameweekHistory.total_points : 0;

          if (!playerStats[playerId]) {
            playerStats[playerId] = {
              name: player.web_name,
              team: playerData.teams.find(t => t.id === player.team).short_name,
              position: ["GKP", "DEF", "MID", "FWD"][player.element_type - 1],
              totalPointsActive: 0,
              gwInSquad: 0,
              starts: 0,
              cappedPoints: 0,
              last3GWPoints: 0
            };
          }

          const inStarting11 = pick.position <= 11;
          const isCaptain = pick.is_captain;

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

          // Update last 3 GWs points if within last 3 gameweeks
          if (currentGameweek - gw < 3) {
            playerStats[playerId].last3GWPoints += pointsThisWeek;
          }
        }
        
        // Update weekly stats
        weeklyPoints[gw - 1] = gwPoints;
        const gwHistory = historyData.current.find(h => h.event === gw);
        if (gwHistory) {
          weeklyRanks[gw - 1] = gwHistory.overall_rank;
          
          // Update highest/lowest tracking
          if (gwPoints > highestPoints) {
            highestPoints = gwPoints;
            highestPointsGW = gw;
          }
          if (gwPoints < lowestPoints) {
            lowestPoints = gwPoints;
            lowestPointsGW = gw;
          }
          if (gwHistory.overall_rank < highestRank) {
            highestRank = gwHistory.overall_rank;
            highestRankGW = gw;
          }
          if (gwHistory.overall_rank > lowestRank) {
            lowestRank = gwHistory.overall_rank;
            lowestRankGW = gw;
          }
        }
      } catch (error) {
        console.error(`Error processing gameweek ${gw}:`, error);
      }
    }

    // Prepare the complete analysis object
    const analysis = {
      managerInfo: {
        name: `${managerEntryData.player_first_name} ${managerEntryData.player_last_name}`,
        teamName: managerEntryData.name,
        overallRanking: managerEntryData.summary_overall_rank?.toLocaleString() || "N/A",
        managerPoints: managerEntryData.summary_overall_points,
        allChipsUsed: historyData.chips.map(chip => chip.name).join(", ") || "None",
        lastSeasonRank: historyData.past.length > 0 ? historyData.past[historyData.past.length - 1].rank.toLocaleString() : "N/A",
        seasonBeforeLastRank: historyData.past.length > 1 ? historyData.past[historyData.past.length - 2].rank.toLocaleString() : "N/A",
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
      playerStats: Object.values(playerStats)
        .sort((a, b) => b.totalPointsActive - a.totalPointsActive)
        .map(player => ({
          ...player,
          totalPointsActive: Math.round(player.totalPointsActive),
          cappedPoints: Math.round(player.cappedPoints)
        })),
      positionSummary: Object.entries(positionPoints).map(([position, players]) => ({
        position,
        totalPoints: Object.values(players).reduce((sum, player) => sum + player.points, 0),
        players: Object.values(players).sort((a, b) => b.points - a.points)
      })),
      weeklyPoints,
      weeklyRanks,
      currentTeam,
      transfersIn: transfersInData,
      transfersOut: transfersOutData,
      transferSuggestions
    };

    res.json(analysis);
  } catch (error) {
    console.error('Error analyzing manager:', error);
    res.status(500).json({ error: 'Failed to analyze manager', details: error.message });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
