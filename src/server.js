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

// Helper function to get player suspension status
function getPlayerSuspensionStatus(player) {
  const yellowCards = player.yellow_cards;
  const redCards = player.red_cards;
  let status = null;

  if (yellowCards === 4) {
    status = 'One more yellow card until suspension';
  } else if (yellowCards === 9) {
    status = 'One more yellow card until second suspension';
  } else if (yellowCards === 14) {
    status = 'One more yellow card until third suspension';
  } else if (redCards > 0) {
    status = 'Currently suspended';
  }

  return status;
}

// Helper function to get captain options
function getCaptainOptions(currentTeam, playerData) {
  return currentTeam
    .sort((a, b) => {
      // Sort by form and then by total points if form is equal
      const formDiff = parseFloat(b.form) - parseFloat(a.form);
      if (formDiff !== 0) return formDiff;
      return b.totalPoints - a.totalPoints;
    })
    .slice(0, 5)
    .map(player => ({
      name: player.name,
      team: player.team,
      form: player.form,
      totalPoints: player.totalPoints,
      nextFixture: player.nextFixtures[0]
    }));
}

// Helper function to process player fixtures
async function getPlayerFixtures(playerId, playerData, currentGameweek) {
  const fixturesResponse = await axios.get(`https://fantasy.premierleague.com/api/element-summary/${playerId}/`);
  const fixtures = fixturesResponse.data.fixtures.slice(0, 5);
  
  return fixtures.map(fixture => {
    const isHome = fixture.is_home;
    const opponent = playerData.teams.find(t => 
      t.id === (isHome ? fixture.team_a : fixture.team_h)
    ).short_name;
    
    return {
      opponent,
      isHome,
      difficulty: fixture.difficulty
    };
  });
}

// Helper function to get player performance history
async function getPlayerHistory(playerId, gw) {
  const historyResponse = await axios.get(`https://fantasy.premierleague.com/api/element-summary/${playerId}/`);
  const history = historyResponse.data.history;
  return history.find(h => h.round === gw) || null;
}

// Main analysis function
async function generateAnalysis(managerId, playerData, currentGameweek) {
  // Initialize tracking variables
  let totalCaptaincyPoints = 0;
  let totalPointsActive = 0;
  let totalPointsLostOnBench = 0;
  const playerStats = {};
  const positionPoints = { GKP: {}, DEF: {}, MID: {}, FWD: {} };

  // Get current team
  const managerPicksResponse = await axios.get(
    `https://fantasy.premierleague.com/api/entry/${managerId}/event/${currentGameweek}/picks/`
  );
  const currentTeam = [];
  const managerPicks = managerPicksResponse.data.picks;

  // Process current team
  for (const pick of managerPicks) {
    const player = playerData.elements.find(p => p.id === pick.element);
    if (!player) continue;

    const nextFixtures = await getPlayerFixtures(player.id, playerData, currentGameweek);
    const fixturesResponse = await axios.get(`https://fantasy.premierleague.com/api/element-summary/${player.id}/`);
    const last3GWPoints = fixturesResponse.data.history
      .slice(-3)
      .reduce((sum, game) => sum + game.total_points, 0);

    currentTeam.push({
      name: player.web_name,
      team: playerData.teams.find(t => t.id === player.team).short_name,
      position: ["GKP", "DEF", "MID", "FWD"][player.element_type - 1],
      nextFixtures,
      last3GWPoints,
      form: parseFloat(player.form),
      totalPoints: player.total_points,
      yellowCards: player.yellow_cards,
      redCards: player.red_cards,
      suspensionStatus: getPlayerSuspensionStatus(player)
    });
  }

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
    GKP: getPositionTransferSuggestions(playerData, 1),
    DEF: getPositionTransferSuggestions(playerData, 2),
    MID: getPositionTransferSuggestions(playerData, 3),
    FWD: getPositionTransferSuggestions(playerData, 4)
  };

  // Get captain options
  const captainOptions = getCaptainOptions(currentTeam, playerData);

  // Get suspension risks
  const suspensionRisks = currentTeam.filter(player => player.suspensionStatus)
    .map(player => ({
      name: player.name,
      team: player.team,
      status: player.suspensionStatus
    }));

  return {
    currentTeam,
    transfersIn: transfersInData,
    transfersOut: transfersOutData,
    transferSuggestions,
    captainOptions,
    suspensionRisks,
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
    }))
  };
}

// Helper function to get transfer suggestions for a position
function getPositionTransferSuggestions(playerData, positionId) {
  return playerData.elements
    .filter(p => p.element_type === positionId)
    .sort((a, b) => parseFloat(b.form) - parseFloat(a.form))
    .slice(0, 5)
    .map(p => ({
      name: p.web_name,
      team: playerData.teams.find(t => t.id === p.team).short_name,
      points: p.total_points,
      form: parseFloat(p.form),
      price: p.now_cost / 10
    }));
}

// Analyze manager endpoint
app.get('/api/analyze-manager/:managerId', async (req, res) => {
  try {
    const { managerId } = req.params;
    
    // Fetch bootstrap static data
    const playerDataResponse = await axios.get('https://fantasy.premierleague.com/api/bootstrap-static/');
    const playerData = playerDataResponse.data;

    // Get current gameweek
    const currentGameweek = playerData.events.find(event => event.is_current)?.id || 
                          Math.max(...playerData.events.filter(e => e.finished).map(e => e.id));

    // Generate analysis
    const analysis = await generateAnalysis(managerId, playerData, currentGameweek);

    res.json(analysis);
  } catch (error) {
    console.error('Error analyzing manager:', error);
    res.status(500).json({ 
      error: 'Failed to analyze manager', 
      details: error.message 
    });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});