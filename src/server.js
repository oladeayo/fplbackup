const express = require('express');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Constants
const LEAGUE_ID = 314; // League ID for league leaders

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

// Endpoint to fetch league leaders
app.get('/api/league-leaders', async (req, res) => {
  try {
    const response = await axios.get(`https://fantasy.premierleague.com/api/leagues-classic/${LEAGUE_ID}/standings/`);
    const leaders = response.data.standings.results.slice(0, 10).map(manager => ({
      rank: manager.rank,
      teamName: manager.entry_name,
      managerName: manager.player_name,
      totalPoints: manager.total,
      lastRank: manager.last_rank,
      gameweekPoints: manager.event_total
    }));
    res.json(leaders);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch league leaders' });
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
      nextFixture: player.nextFixtures[0],
      photoUrl: `https://resources.premierleague.com/premierleague/photos/players/110x140/p${player.id}.png`
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
      difficulty: fixture.difficulty,
      gameweek: fixture.event
    };
  });
}

// Helper function to get manager info
async function getManagerInfo(managerId) {
  const managerResponse = await axios.get(`https://fantasy.premierleague.com/api/entry/${managerId}/`);
  const managerHistory = await axios.get(`https://fantasy.premierleague.com/api/entry/${managerId}/history/`);
  const manager = managerResponse.data;
  const history = managerHistory.data;

  const currentGameweek = history.current.length;
  const weeklyRanks = history.current.map(gw => gw.overall_rank);
  
  return {
    name: manager.player_first_name + ' ' + manager.player_last_name,
    teamName: manager.name,
    currentGameweek,
    managerPoints: manager.summary_overall_points,
    overallRanking: manager.summary_overall_rank,
    lastSeasonRank: history.past[0]?.rank || 'N/A',
    seasonBeforeLastRank: history.past[1]?.rank || 'N/A',
    highestRank: Math.min(...weeklyRanks),
    lowestRank: Math.max(...weeklyRanks),
    highestRankGW: weeklyRanks.indexOf(Math.min(...weeklyRanks)) + 1,
    lowestRankGW: weeklyRanks.indexOf(Math.max(...weeklyRanks)) + 1,
    weeklyRanks,
    allChipsUsed: history.chips.map(c => c.name).join(', ') || 'None'
  };
}

// Main analysis function
async function generateAnalysis(managerId, playerData, currentGameweek) {
  const managerInfo = await getManagerInfo(managerId);
  
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
      id: player.id,
      name: player.web_name,
      team: playerData.teams.find(t => t.id === player.team).short_name,
      position: ["GKP", "DEF", "MID", "FWD"][player.element_type - 1],
      nextFixtures,
      last3GWPoints,
      form: parseFloat(player.form),
      totalPoints: player.total_points,
      yellowCards: player.yellow_cards,
      redCards: player.red_cards,
      suspensionStatus: getPlayerSuspensionStatus(player),
      photoUrl: `https://resources.premierleague.com/premierleague/photos/players/110x140/p${player.id}.png`
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
      form: parseFloat(p.form),
      photoUrl: `https://resources.premierleague.com/premierleague/photos/players/110x140/p${p.id}.png`
    }));

  const transfersOutData = playerData.elements
    .sort((a, b) => b.transfers_out_event - a.transfers_out_event)
    .slice(0, 5)
    .map(p => ({
      name: p.web_name,
      team: playerData.teams.find(t => t.id === p.team).short_name,
      transfers: p.transfers_out_event,
      points: p.total_points,
      form: parseFloat(p.form),
      photoUrl: `https://resources.premierleague.com/premierleague/photos/players/110x140/p${p.id}.png`
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
      status: player.suspensionStatus,
      photoUrl: player.photoUrl
    }));

  return {
    managerInfo,
    currentTeam,
    transfersIn: transfersInData,
    transfersOut: transfersOutData,
    transferSuggestions,
    captainOptions,
    suspensionRisks
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
      price: p.now_cost / 10,
      photoUrl: `https://resources.premierleague.com/premierleague/photos/players/110x140/p${p.id}.png`
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