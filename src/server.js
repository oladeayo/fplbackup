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
    
    // Fetch all required data in parallel
    const [playerDataResponse, managerEntryResponse, historyResponse] = await Promise.all([
      axios.get('https://fantasy.premierleague.com/api/bootstrap-static/'),
      axios.get(`https://fantasy.premierleague.com/api/entry/${managerId}/`),
      axios.get(`https://fantasy.premierleague.com/api/entry/${managerId}/history/`)
    ]);

    const playerData = playerDataResponse.data;
    const managerEntryData = managerEntryResponse.data;
    const historyData = historyResponse.data;

    const currentGameweek = playerData.events.find(event => event.is_current).id;
    
    // Initialize analysis data structure
    const weeklyPoints = new Array(currentGameweek).fill(0);
    const weeklyRanks = new Array(currentGameweek).fill(0);
    
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

    // Process each gameweek for points and ranks
    for (let gw = 1; gw <= currentGameweek; gw++) {
      const gwHistoryData = historyData.current.find(h => h.event === gw);
      if (gwHistoryData) {
        weeklyPoints[gw - 1] = gwHistoryData.points;
        weeklyRanks[gw - 1] = gwHistoryData.overall_rank;
      }
    }

    // Process position summary
    const positionSummary = [];
    const positions = ['GKP', 'DEF', 'MID', 'FWD'];
    positions.forEach((pos, index) => {
      const positionPlayers = playerData.elements.filter(p => p.element_type === index + 1);
      const topScorer = positionPlayers.reduce((max, p) => p.total_points > max.total_points ? p : max);
      const totalPoints = positionPlayers.reduce((sum, p) => sum + p.total_points, 0);
      
      positionSummary.push({
        position: pos,
        totalPoints,
        topScorer: {
          name: topScorer.web_name,
          points: topScorer.total_points,
          image: `https://resources.premierleague.com/premierleague/photos/players/110x140/p${topScorer.code}.png`
        }
      });
    });

    // Prepare transfer suggestions
    const transferSuggestions = {
      gkp: playerData.elements.filter(p => p.element_type === 1).sort((a, b) => b.total_points - a.total_points).slice(0, 3),
      def: playerData.elements.filter(p => p.element_type === 2).sort((a, b) => b.total_points - a.total_points).slice(0, 5),
      mid: playerData.elements.filter(p => p.element_type === 3).sort((a, b) => b.total_points - a.total_points).slice(0, 6),
      fwd: playerData.elements.filter(p => p.element_type === 4).sort((a, b) => b.total_points - a.total_points).slice(0, 4)
    };

    // Format transfer suggestions with images and fixtures
    for (const pos in transferSuggestions) {
      transferSuggestions[pos] = await Promise.all(transferSuggestions[pos].map(async (player) => {
        const fixturesResponse = await axios.get(`https://fantasy.premierleague.com/api/element-summary/${player.id}/`);
        const nextFixtures = fixturesResponse.data.fixtures.slice(0, 3).map(fixture => ({
          opponent: playerData.teams.find(t => t.id === (fixture.is_home ? fixture.team_a : fixture.team_h)).short_name,
          difficulty: fixture.difficulty
        }));

        return {
          name: player.web_name,
          points: player.total_points,
          image: `https://resources.premierleague.com/premierleague/photos/players/110x140/p${player.code}.png`,
          nextFixtures
        };
      }));
    }

    const analysis = {
      weeklyPoints,
      weeklyRanks,
      currentTeam,
      positionSummary,
      transferSuggestions
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
