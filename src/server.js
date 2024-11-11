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
    const leagueId = 314; // Your league ID
    
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

    // Get suspended players and players on 4 yellows
    const suspendedPlayers = [];
    const playersOn4Yellows = [];
    const mostTransferredIn = [];
    const mostTransferredOut = [];

    // Fetch all player fixtures in parallel
    const playerFixturesPromises = playerData.elements.map(player => {
      if (player.status === 'r' || player.status === 's' || player.yellow_cards === 4) {
        return axios.get(`https://fantasy.premierleague.com/api/element-summary/${player.id}/`);
      }
      return null;
    }).filter(Boolean);

    const playerFixturesResponses = await Promise.all(playerFixturesPromises);
    let fixturesIndex = 0;

    // Process transfers data
    const transfersData = playerData.elements.map(player => ({
      name: player.web_name,
      team: playerData.teams[player.team - 1].name,
      photoId: player.code,
      transfersIn: player.transfers_in_event,
      transfersOut: player.transfers_out_event
    }));

    // Get top 10 transfers in
    mostTransferredIn.push(...transfersData
      .sort((a, b) => b.transfersIn - a.transfersIn)
      .slice(0, 10)
      .map(player => ({
        ...player,
        transfers: player.transfersIn
      }))
    );

    // Get top 10 transfers out
    mostTransferredOut.push(...transfersData
      .sort((a, b) => b.transfersOut - a.transfersOut)
      .slice(0, 10)
      .map(player => ({
        ...player,
        transfers: player.transfersOut
      }))
    );

    for (const player of playerData.elements) {
      if (player.status === 'r' || player.status === 's') {
        const fixturesResponse = playerFixturesResponses[fixturesIndex++];
        const nextFixtures = fixturesResponse.data.fixtures.slice(0, 3).map(fixture => {
          const isHome = fixture.is_home;
          const opponent = playerData.teams.find(t => t.id === (isHome ? fixture.team_a : fixture.team_h)).short_name;
          return {
            opponent,
            isHome,
            difficulty: fixture.difficulty
          };
        });

        suspendedPlayers.push({
          name: player.web_name,
          team: playerData.teams[player.team - 1].name,
          photoId: player.code,
          status: player.status === 'r' ? 'Red Card' : 'Suspended',
          nextFixtures
        });
      }
      
      if (player.yellow_cards === 4) {
        const fixturesResponse = playerFixturesResponses[fixturesIndex++];
        const nextFixtures = fixturesResponse.data.fixtures.slice(0, 3).map(fixture => {
          const isHome = fixture.is_home;
          const opponent = playerData.teams.find(t => t.id === (isHome ? fixture.team_a : fixture.team_h)).short_name;
          return {
            opponent,
            isHome,
            difficulty: fixture.difficulty
          };
        });

        playersOn4Yellows.push({
          name: player.web_name,
          team: playerData.teams[player.team - 1].name,
          photoId: player.code,
          yellowCards: player.yellow_cards,
          nextFixtures
        });
      }
    }

    const currentGameweek = playerData.events.find(event => event.is_current).id;
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

    // Fetch all current team fixtures in parallel
    const currentTeamFixturesPromises = managerPicks.map(pick => {
      const player = playerData.elements.find(p => p.id === pick.element);
      if (!player) return null;
      return axios.get(`https://fantasy.premierleague.com/api/element-summary/${player.id}/`);
    }).filter(Boolean);

    const currentTeamFixturesResponses = await Promise.all(currentTeamFixturesPromises);
    let currentTeamIndex = 0;

    for (const pick of managerPicks) {
      const player = playerData.elements.find(p => p.id === pick.element);
      if (!player) continue;

      const fixturesResponse = currentTeamFixturesResponses[currentTeamIndex++];
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
        nextFixtures,
        last3GWPoints
      });
    }

    // Fetch all gameweek data in parallel
    const gameweekPromises = [];
    for (let gw = 1; gw <= currentGameweek; gw++) {
      gameweekPromises.push(axios.get(`https://fantasy.premierleague.com/api/entry/${managerId}/event/${gw}/picks/`));
    }
    const gameweekResponses = await Promise.all(gameweekPromises);

    for (let gw = 1; gw <= currentGameweek; gw++) {
      const managerPicksData = gameweekResponses[gw - 1].data;
      const managerPicks = managerPicksData.picks;

      const isBenchBoost = managerPicksData.active_chip === "bboost";
      const isTripleCaptain = managerPicksData.active_chip === "3xc";

      let gwPoints = 0;
      
      // Fetch all player histories in parallel for this gameweek
      const playerHistoryPromises = managerPicks.map(pick => {
        return axios.get(`https://fantasy.premierleague.com/api/element-summary/${pick.element}/`);
      });
      const playerHistoryResponses = await Promise.all(playerHistoryPromises);
      
      for (let i = 0; i < managerPicks.length; i++) {
        const pick = managerPicks[i];
        const playerId = pick.element;
        const player = playerData.elements.find(p => p.id == playerId);
        if (!player) continue;

        const playerHistory = playerHistoryResponses[i].data.history;
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
            playerPoints: 0,
            photoId: player.code
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
              points: 0,
              photoId: player.code
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

    // Find highest scoring player for each position
    const highestScorers = {};
    for (const [position, players] of Object.entries(positionPoints)) {
      const highestScorer = Object.values(players).reduce((max, player) => 
        player.points > (max?.points || 0) ? player : max, null);
      highestScorers[position] = highestScorer;
    }

    // Prepare the complete analysis object
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
        highestScorer: highestScorers[position]
      })),
      weeklyPoints,
      weeklyRanks,
      currentTeam,
      suspendedPlayers,
      playersOn4Yellows,
      mostTransferredIn,
      mostTransferredOut
    };

    res.json(analysis);
  } catch (error) {
    console.error('Error analyzing manager:', error);
    res.status(500).json({ error: 'Failed to analyze manager' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});