let pointsChart = null;
let rankChart = null;
let last3GWsChart = null;

// Load suspension data when page loads
window.addEventListener('DOMContentLoaded', async () => {
    try {
        const response = await fetch('/api/bootstrap-static');
        if (!response.ok) throw new Error("Could not fetch bootstrap static data");
        const data = await response.json();
        
        // Process suspension data
        const suspendedPlayers = [];
        const playersOn4Yellows = [];
        const mostTransferredIn = [];
        const mostTransferredOut = [];
        
        data.elements.forEach(player => {
            const team = data.teams.find(t => t.id === player.team);
            if (player.status === 'r' || player.status === 's') {
                suspendedPlayers.push({
                    name: player.web_name,
                    team: team.name,
                    photoId: player.code,
                    suspendedMatches: player.suspended_matches || 1,
                    nextThreeFixtures: [] // You can add fixture data if needed
                });
            }
            if (player.yellow_cards === 4) {
                playersOn4Yellows.push({
                    name: player.web_name,
                    team: team.name,
                    photoId: player.code,
                    yellowCards: player.yellow_cards,
                    nextThreeFixtures: [] // You can add fixture data if needed
                });
            }

            // Process transfers data
            mostTransferredIn.push({
                name: player.web_name,
                team: team.name,
                photoId: player.code,
                transfers: player.transfers_in_event
            });

            mostTransferredOut.push({
                name: player.web_name,
                team: team.name,
                photoId: player.code,
                transfers: player.transfers_out_event
            });
        });

        // Sort and slice transfers data
        mostTransferredIn.sort((a, b) => b.transfers - a.transfers);
        mostTransferredOut.sort((a, b) => b.transfers - a.transfers);
        
        const top10TransfersIn = mostTransferredIn.slice(0, 10);
        const top10TransfersOut = mostTransferredOut.slice(0, 10);

        // Show cards and populate data
        document.getElementById('suspensionRisk').classList.remove('hidden');
        document.getElementById('transferTrends').classList.remove('hidden');
        populateSuspensionData({ suspendedPlayers, playersOn4Yellows });
        populateTransferData({ mostTransferredIn: top10TransfersIn, mostTransferredOut: top10TransfersOut });
    } catch (error) {
        console.error("Error loading data:", error);
    }
});

async function analyzeManager() {
    const managerId = document.getElementById('managerId').value;
    const resultsDiv = document.getElementById('results');
    const chartsDiv = document.getElementById('charts');
    const currentTeamFixtures = document.getElementById('currentTeamFixtures');
    const positionSummaryDiv = document.getElementById('positionSummary');
    const last3GWsDiv = document.getElementById('last3GWs');

    // Display loading spinner
    resultsDiv.innerHTML = `
        <div class="flex justify-center items-center py-12">
            <div class="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-blue-600"></div>
        </div>
    `;
    chartsDiv.classList.add('hidden');
    currentTeamFixtures.classList.add('hidden');
    positionSummaryDiv.classList.add('hidden');
    last3GWsDiv.classList.add('hidden');

    try {
        const response = await fetch(`/api/analyze-manager/${managerId}`);
        if (!response.ok) throw new Error("Manager data could not be retrieved");

        const data = await response.json();
        populateResults(data);
        createCharts(data.weeklyPoints, data.weeklyRanks);
        populateFixtures(data.currentTeam);
        populatePositionSummary(data.positionSummary, data.playerStats);
        createLast3GWsChart(data.currentTeam);

        chartsDiv.classList.remove('hidden');
        currentTeamFixtures.classList.remove('hidden');
        positionSummaryDiv.classList.remove('hidden');
        last3GWsDiv.classList.remove('hidden');
    } catch (error) {
        resultsDiv.innerHTML = `
            <div class="bg-red-50 border-l-4 border-red-500 p-6 rounded-xl">
                <div class="flex items-center">
                    <i class="fas fa-exclamation-circle text-red-500 text-xl mr-3"></i>
                    <p class="text-red-700 font-medium">${error.message}</p>
                </div>
            </div>
        `;
        chartsDiv.classList.add('hidden');
        currentTeamFixtures.classList.add('hidden');
        positionSummaryDiv.classList.add('hidden');
        last3GWsDiv.classList.add('hidden');
    }
}

function populateResults(data) {
    const resultsDiv = document.getElementById('results');
    let html = `
        <div class="glass-effect rounded-3xl shadow-xl p-8 card-hover">
            <h2 class="text-2xl font-bold text-slate-800 mb-8"><i class="fas fa-user-shield mr-2"></i>Manager's Summary</h2>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div class="space-y-4">
                    <p class="text-slate-600"><span class="font-semibold">Name:</span> ${data.managerInfo.name}</p>
                    <p class="text-slate-600"><span class="font-semibold">Team Name:</span> ${data.managerInfo.teamName}</p>
                    <p class="text-slate-600"><span class="font-semibold">Current Gameweek:</span> GW ${data.managerInfo.currentGameweek}</p>
                    <p class="text-slate-600"><span class="font-semibold">Total Points:</span> ${data.managerInfo.managerPoints} Points</p>
                    <p class="text-slate-600"><span class="font-semibold">Average Points Per GW:</span> ${(data.managerInfo.managerPoints / data.managerInfo.currentGameweek).toFixed(1)} Points</p>
                    <p class="text-slate-600"><span class="font-semibold">Total Captain Points:</span> ${data.managerInfo.totalCaptaincyPoints}</p>
                    <p class="text-slate-600"><span class="font-semibold">Total Points Lost on Bench:</span> ${data.managerInfo.totalPointsLostOnBench}</p>
                    <p class="text-slate-600"><span class="font-semibold">Chips Used:</span> ${data.managerInfo.allChipsUsed}</p>
                </div>
                <div class="space-y-4">
                    <p class="text-slate-600"><span class="font-semibold">Overall Rank:</span> ${data.managerInfo.overallRanking}</p>
                    <p class="text-slate-600"><span class="font-semibold">Point Difference to World No 1:</span> ${data.managerInfo.pointDifference} Points</p>
                    <p class="text-slate-600"><span class="font-semibold">Lowest Scoring GW:</span> ${data.managerInfo.lowestPoints} Points (GW${data.managerInfo.lowestPointsGW})</p>
                    <p class="text-slate-600"><span class="font-semibold">Highest Scoring GW:</span> ${data.managerInfo.highestPoints} Points (GW ${data.managerInfo.highestPointsGW})</p>
                    <p class="text-slate-600"><span class="font-semibold">Highest Rank:</span> ${data.managerInfo.highestRank} (GW${data.managerInfo.highestRankGW})</p>
                    <p class="text-slate-600"><span class="font-semibold">Lowest Rank:</span> ${data.managerInfo.lowestRank} (GW${data.managerInfo.lowestRankGW})</p>
                    <p class="text-slate-600"><span class="font-semibold">2023/2024 Rank:</span> ${data.managerInfo.lastSeasonRank}</p>
                    <p class="text-slate-600"><span class="font-semibold">2022/2023 Rank:</span> ${data.managerInfo.seasonBeforeLastRank}</p>
                </div>
            </div>
        </div>

        <div class="glass-effect rounded-3xl shadow-xl p-8 card-hover">
            <div class="flex flex-col md:flex-row items-center justify-between mb-8">
                <h2 class="text-2xl font-bold text-slate-800 mb-4 md:mb-0"><i class="fas fa-users mr-2"></i>Squad Performance</h2>
                <div class="flex items-center gap-4">
                    <span class="text-slate-600">Filter by position:</span>
                    <select id="positionFilter" class="px-4 py-2 bg-white/50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400">
                        <option value="All">All</option>
                        <option value="GKP">GKP</option>
                        <option value="DEF">DEF</option>
                        <option value="MID">MID</option>
                        <option value="FWD">FWD</option>
                    </select>
                </div>
            </div>
            <div class="overflow-x-auto responsive-table">
                <table class="min-w-full bg-white/50 rounded-xl">
                    <thead class="bg-slate-50/50">
                        <tr>
                            <th class="sticky-column px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider bg-slate-50/50">Player Name</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Team</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Position</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Points</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Games</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Starts</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Captain Points</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.playerStats.map(player => `
                            <tr class="border-t hover:bg-blue-50/50 transition-colors duration-200" data-position="${player.position}">
                                <td class="sticky-column px-6 py-4 text-sm font-medium text-slate-900 bg-white/50">${player.name}</td>
                                <td class="px-6 py-4 text-sm text-slate-600">${player.team}</td>
                                <td class="px-6 py-4 text-sm text-slate-600">${player.position}</td>
                                <td class="px-6 py-4 text-sm text-slate-600">${player.totalPointsActive}</td>
                                <td class="px-6 py-4 text-sm text-slate-600">${player.gamesPlayed}</td>
                                <td class="px-6 py-4 text-sm text-slate-600">${player.starts}</td>
                                <td class="px-6 py-4 text-sm text-slate-600">${player.captainPoints}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
    resultsDiv.innerHTML = html;

    // Add event listener for position filter
    document.getElementById('positionFilter').addEventListener('change', function() {
        const selectedPosition = this.value;
        const rows = document.querySelectorAll('tbody tr');
        
        rows.forEach(row => {
            const position = row.getAttribute('data-position');
            if (selectedPosition === 'All' || position === selectedPosition) {
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        });
    });
}

function populateFixtures(teamData) {
    const fixturesBody = document.getElementById('fixturesBody');
    fixturesBody.innerHTML = teamData.map(player => `
        <tr class="border-t hover:bg-blue-50/50 transition-colors duration-200">
            <td class="sticky-column px-6 py-4 text-sm font-medium text-slate-900 bg-white/50">${player.name}</td>
            ${player.nextFixtures.map(fixture => `
                <td class="px-4 py-4">
                    <div style="${getFDRColor(fixture.difficulty)}" class="text-sm rounded-lg p-2 text-center text-white font-medium shadow-sm">
                        ${fixture.opponent} (${fixture.isHome ? 'H' : 'A'})
                    </div>
                </td>
            `).join('')}
        </tr>
    `).join('');
}

function populatePositionSummary(positionData, playerStats) {
    const summaryDiv = document.getElementById('positionSummary');
    const positionColors = {
        GKP: 'from-amber-400 to-amber-500',
        DEF: 'from-blue-400 to-blue-500',
        MID: 'from-emerald-400 to-emerald-500',
        FWD: 'from-rose-400 to-rose-500'
    };

    // Find highest scoring player for each position
    const highestScorers = {};
    playerStats.forEach(player => {
        if (!highestScorers[player.position] || 
            player.totalPointsActive > highestScorers[player.position].points) {
            highestScorers[player.position] = {
                name: player.name,
                points: player.totalPointsActive,
                photoId: player.photoId
            };
        }
    });

    const gridContent = positionData.map(pos => `
        <div class="bg-gradient-to-br ${positionColors[pos.position]} rounded-2xl p-6 text-white transform hover:scale-105 transition duration-300 shadow-lg relative overflow-hidden">
            <div class="flex justify-between items-center">
                <div>
                    <h3 class="text-xl font-bold mb-2">${pos.position}</h3>
                    <p class="text-3xl font-bold">${pos.totalPoints}</p>
                    <p class="text-sm opacity-90">Total Points</p>
                    <p class="text-sm mt-2">Top Player: ${highestScorers[pos.position]?.name}</p>
                </div>
                <div class="absolute right-0 top-1/2 transform -translate-y-1/2">
                    <img 
                        src="https://resources.premierleague.com/premierleague/photos/players/110x140/p${highestScorers[pos.position]?.photoId}.png" 
                        alt="${highestScorers[pos.position]?.name}"
                        class="h-24 object-cover opacity-75 player-image"
                        onerror="this.src='https://resources.premierleague.com/premierleague/photos/players/110x140/Photo-Missing.png'"
                    />
                </div>
            </div>
        </div>
    `).join('');

    summaryDiv.querySelector('.grid').innerHTML = gridContent;
    summaryDiv.classList.remove('hidden');
}

function createCharts(weeklyPoints, weeklyRanks) {
    createPointsChart(weeklyPoints);
    createRankChart(weeklyRanks);
}

function createPointsChart(weeklyPoints) {
    const ctx = document.getElementById('pointsChart').getContext('2d');
    if (pointsChart) pointsChart.destroy();
    
    pointsChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: weeklyPoints.map((_, i) => `GW${i + 1}`),
            datasets: [{
                label: 'Points',
                data: weeklyPoints,
                borderColor: 'rgb(59, 130, 246)',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: { 
                    beginAtZero: true,
                    grid: { color: 'rgba(0,0,0,0.05)' }
                },
                x: {
                    grid: { display: false }
                }
            }
        }
    });
}

function createRankChart(weeklyRanks) {
    const ctx = document.getElementById('rankChart').getContext('2d');
    if (rankChart) rankChart.destroy();
    
    rankChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: weeklyRanks.map((_, i) => `GW${i + 1}`),
            datasets: [{
                label: 'Rank',
                data: weeklyRanks,
                borderColor: 'rgb(239, 68, 68)',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: { 
                    reverse: true,
                    beginAtZero: true,
                    grid: { color: 'rgba(0,0,0,0.05)' }
                },
                x: {
                    grid: { display: false }
                }
            }
        }
    });
}

function createLast3GWsChart(teamData) {
    const ctx = document.getElementById('last3GWsChart').getContext('2d');
    if (last3GWsChart) last3GWsChart.destroy();

    // Sort players by last 3 GWs total points
    const playerPoints = teamData.map(player => ({
        name: player.name,
        points: player.last3GWPoints || 0
    })).sort((a, b) => b.points - a.points);

    last3GWsChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: playerPoints.map(p => p.name),
            datasets: [{
                label: 'Points',
                data: playerPoints.map(p => p.points),
                backgroundColor: 'rgba(59, 130, 246, 0.8)',
                borderColor: 'rgb(59, 130, 246)',
                borderWidth: 1
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                datalabels: {
                    display: true,
                    color: '#374151',
                    anchor: 'end',
                    align: 'right',
                    font: { weight: 'bold' }
                }
            },
            scales: {
                x: { 
                    beginAtZero: true,
                    grid: { color: 'rgba(0,0,0,0.05)' }
                },
                y: {
                    grid: { display: false }
                }
            }
        }
    });
}

function populateTransferData(data) {
    const transfersInDiv = document.getElementById('mostTransferredIn');
    const transfersOutDiv = document.getElementById('mostTransferredOut');

    // Helper function to create transfer card
    const createTransferCard = (player, type) => `
        <div class="player-card bg-white/50 rounded-xl p-4 shadow-md hover:shadow-lg transition-shadow duration-300">
            <div class="flex items-center space-x-4">
                <img 
                    src="https://resources.premierleague.com/premierleague/photos/players/110x140/p${player.photoId}.png" 
                    alt="${player.name}"
                    class="w-16 h-20 object-cover rounded-lg"
                    onerror="this.src='https://resources.premierleague.com/premierleague/photos/players/110x140/Photo-Missing.png'"
                >
                <div>
                    <h4 class="font-semibold text-slate-800">${player.name}</h4>
                    <p class="text-sm text-slate-600">${player.team}</p>
                    <p class="text-sm ${type === 'in' ? 'text-green-600' : 'text-red-600'} font-medium mt-1">
                        ${type === 'in' ? 'Transfers In' : 'Transfers Out'}: ${player.transfers.toLocaleString()}
                    </p>
                </div>
            </div>
        </div>
    `;

    // Populate transfers in
    transfersInDiv.innerHTML = data.mostTransferredIn.length ? 
        data.mostTransferredIn.map(player => createTransferCard(player, 'in')).join('') :
        '<p class="text-slate-600">No transfer data available</p>';

    // Populate transfers out
    transfersOutDiv.innerHTML = data.mostTransferredOut.length ?
        data.mostTransferredOut.map(player => createTransferCard(player, 'out')).join('') :
        '<p class="text-slate-600">No transfer data available</p>';
}

function populateSuspensionData(data) {
    const suspendedPlayersDiv = document.getElementById('suspendedPlayers');
    const yellowCardRiskDiv = document.getElementById('yellowCardRisk');

    // Helper function to create player card
    const createSuspendedPlayerCard = (player) => `
        <div class="player-card bg-white/50 rounded-xl p-4 shadow-md hover:shadow-lg transition-shadow duration-300">
            <div class="flex items-center space-x-4">
                <img 
                    src="https://resources.premierleague.com/premierleague/photos/players/110x140/p${player.photoId}.png" 
                    alt="${player.name}"
                    class="w-16 h-20 object-cover rounded-lg"
                    onerror="this.src='https://resources.premierleague.com/premierleague/photos/players/110x140/Photo-Missing.png'"
                >
                <div>
                    <h4 class="font-semibold text-slate-800">${player.name}</h4>
                    <p class="text-sm text-slate-600">${player.team}</p>
                    <p class="text-sm text-red-600 font-medium mt-1">Suspended for ${player.suspendedMatches} match${player.suspendedMatches > 1 ? 'es' : ''}</p>
                    <div class="flex space-x-2 mt-2">
                        ${player.nextThreeFixtures?.map(fixture => `
                            <div style="${getFDRColor(fixture.difficulty)}" 
                                 class="text-xs rounded-md p-1 text-white">
                                ${fixture.opponent} (${fixture.isHome ? 'H' : 'A'})
                            </div>
                        `).join('') || ''}
                    </div>
                </div>
            </div>
        </div>
    `;

    const createYellowCardPlayerCard = (player) => `
        <div class="player-card bg-white/50 rounded-xl p-4 shadow-md hover:shadow-lg transition-shadow duration-300">
            <div class="flex items-center space-x-4">
                <img 
                    src="https://resources.premierleague.com/premierleague/photos/players/110x140/p${player.photoId}.png" 
                    alt="${player.name}"
                    class="w-16 h-20 object-cover rounded-lg"
                    onerror="this.src='https://resources.premierleague.com/premierleague/photos/players/110x140/Photo-Missing.png'"
                >
                <div>
                    <h4 class="font-semibold text-slate-800">${player.name}</h4>
                    <p class="text-sm text-slate-600">${player.team}</p>
                    <p class="text-sm text-yellow-600 font-medium mt-1">${player.yellowCards} Yellow Cards</p>
                    <div class="flex space-x-2 mt-2">
                        ${player.nextThreeFixtures?.map(fixture => `
                            <div style="${getFDRColor(fixture.difficulty)}" 
                                 class="text-xs rounded-md p-1 text-white">
                                ${fixture.opponent} (${fixture.isHome ? 'H' : 'A'})
                            </div>
                        `).join('') || ''}
                    </div>
                </div>
            </div>
        </div>
    `;

    // Populate suspended players
    suspendedPlayersDiv.innerHTML = data.suspendedPlayers.length ?
        data.suspendedPlayers.map(player => createSuspendedPlayerCard(player)).join('') :
        '<p class="text-slate-600">No suspended players</p>';

    // Populate yellow card risk players
    yellowCardRiskDiv.innerHTML = data.playersOn4Yellows.length ?
        data.playersOn4Yellows.map(player => createYellowCardPlayerCard(player)).join('') :
        '<p class="text-slate-600">No players at risk</p>';
}

function getFDRColor(difficulty) {
    const colors = {
        1: 'background-color: rgb(34, 197, 94)',  // Green
        2: 'background-color: rgb(34, 197, 94)',  // Green
        3: 'background-color: rgb(234, 179, 8)',  // Yellow
        4: 'background-color: rgb(239, 68, 68)',  // Red
        5: 'background-color: rgb(239, 68, 68)'   // Red
    };
    return colors[difficulty] || colors[3];
}

function shareApp() {
    const url = window.location.href;
    navigator.share ? 
        navigator.share({ 
            url, 
            text: "Check out this FPL Manager stats app!", 
            title: "FPL Manager Stats" 
        }) : 
        alert("Sharing not supported on this device.");
}
