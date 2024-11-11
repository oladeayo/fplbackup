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

    const currentGameweek = playerData.events.find(event => event.is_current).id;
    const topManagerPoints = leagueData.standings.results[0].total;
    
    // Initialize analysis data structure
    let totalCaptaincyPoints = 0;
    let totalPointsActive = 0;
    let totalPointsLostOnBench = 0;
    const playerStats = {};
    const positionPoints = { GKP: {}, DEF: {}, MID: {}, FWD: {} };

    // Get suspension watchlist - moved to a separate endpoint
    const suspensionWatchlist = playerData.elements
      .map(player => {
        const yellowCards = player.yellow_cards;
        const redCards = player.red_cards;
        const team = playerData.teams.find(t => t.id === player.team);
        
        return {
          id: player.id,
          name: player.web_name,
          photoId: player.code,
          teamName: team.name,
          teamShortName: team.short_name,
          teamId: team.id,
          yellowCards,
          redCards,
          totalCards: yellowCards + (redCards * 2),
          cardsToSuspension: 5 - yellowCards // Assuming 5 yellows = suspension
        };
      })
      .filter(player => player.cardsToSuspension <= 2 && player.cardsToSuspension > 0)
      .sort((a, b) => a.cardsToSuspension - b.cardsToSuspension)
      .slice(0, 10);

    // Get next 3 fixtures for suspension watchlist players
    for (const player of suspensionWatchlist) {
      const fixturesResponse = await axios.get(`https://fantasy.premierleague.com/api/element-summary/${player.id}/`);
      player.nextFixtures = fixturesResponse.data.fixtures.slice(0, 3).map(fixture => {
        const isHome = fixture.is_home;
        const opponent = playerData.teams.find(t => t.id === (isHome ? fixture.team_a : fixture.team_h)).short_name;
        return {
          opponent,
          isHome,
          difficulty: fixture.difficulty
        };
      });
    }

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
        nextFixtures,
        last3GWPoints
      });
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
      suspensionWatchlist
    };

    res.json(analysis);
  } catch (error) {
    console.error('Error analyzing manager:', error);
    res.status(500).json({ error: 'Failed to analyze manager' });
  }
});

// Add new endpoint for suspension watchlist that loads immediately
app.get('/api/suspension-watchlist', async (req, res) => {
  try {
    const playerDataResponse = await axios.get('https://fantasy.premierleague.com/api/bootstrap-static/');
    const playerData = playerDataResponse.data;

    const suspensionWatchlist = playerData.elements
      .map(player => {
        const yellowCards = player.yellow_cards;
        const redCards = player.red_cards;
        const team = playerData.teams.find(t => t.id === player.team);
        
        return {
          id: player.id,
          name: player.web_name,
          photoId: player.code,
          teamName: team.name,
          teamShortName: team.short_name,
          teamId: team.id,
          yellowCards,
          redCards,
          totalCards: yellowCards + (redCards * 2),
          cardsToSuspension: 5 - yellowCards
        };
      })
      .filter(player => player.cardsToSuspension <= 2 && player.cardsToSuspension > 0)
      .sort((a, b) => a.cardsToSuspension - b.cardsToSuspension)
      .slice(0, 10);

    // Get next 3 fixtures for suspension watchlist players
    for (const player of suspensionWatchlist) {
      const fixturesResponse = await axios.get(`https://fantasy.premierleague.com/api/element-summary/${player.id}/`);
      player.nextFixtures = fixturesResponse.data.fixtures.slice(0, 3).map(fixture => {
        const isHome = fixture.is_home;
        const opponent = playerData.teams.find(t => t.id === (isHome ? fixture.team_a : fixture.team_h)).short_name;
        return {
          opponent,
          isHome,
          difficulty: fixture.difficulty
        };
      });
    }

    res.json(suspensionWatchlist);
  } catch (error) {
    console.error('Error fetching suspension watchlist:', error);
    res.status(500).json({ error: 'Failed to fetch suspension watchlist' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});