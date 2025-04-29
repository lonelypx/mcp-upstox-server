// Claude for Mac MCP Integration Script

const axios = require('axios');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

// Configure server URL
const MCP_SERVER_URL = 'http://localhost:3000'; // Change if your server runs elsewhere

// File path for saving analysis results (for Claude to access)
const ANALYSIS_DIR = path.join(__dirname, 'mcp_analysis');
if (!fs.existsSync(ANALYSIS_DIR)) {
    fs.mkdirSync(ANALYSIS_DIR);
}

// Create readline interface for command-line interaction
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Store auth status
let isAuthenticated = false;

// Check authentication status
async function checkAuthStatus() {
    try {
        const response = await axios.get(`${MCP_SERVER_URL}/historical-data/NSE_FO|NIFTY-I/1D?from=2023-01-01&to=2023-01-02`);
        isAuthenticated = true;
        return true;
    } catch (error) {
        if (error.response && error.response.status === 401) {
            isAuthenticated = false;
            return false;
        }
        // Other errors might not be auth-related
        console.error('Error checking auth status:', error.message);
        return false;
    }
}

// Function to authenticate with MCP server
async function authenticate() {
    console.log('\nYou need to authenticate with Upstox first.');
    console.log(`Please open this URL in your browser: ${MCP_SERVER_URL}/auth`);

    await promptUser('\nPress Enter once you have completed authentication in the browser...');

    // Verify authentication was successful
    console.log('Verifying authentication...');
    const authStatus = await checkAuthStatus();

    if (authStatus) {
        console.log('Authentication successful!');
        isAuthenticated = true;
        return true;
    } else {
        console.log('Authentication failed. Please try again.');
        return false;
    }
}

// Helper function to make API calls to MCP server
async function callMCPServer(endpoint, method = 'GET', data = null) {
    try {
        // Check authentication first
        if (!isAuthenticated) {
            const authStatus = await checkAuthStatus();
            if (!authStatus) {
                const authenticated = await authenticate();
                if (!authenticated) {
                    console.log('Cannot proceed without authentication.');
                    return null;
                }
            }
        }

        const config = {
            method,
            url: `${MCP_SERVER_URL}${endpoint}`,
            ...(data && { data }),
            // We don't need to explicitly set Authorization headers
            // The server will use cookies/token.json for auth
            withCredentials: true
        };

        const response = await axios(config);
        return response.data;
    } catch (error) {
        console.error('Error calling MCP server:', error.response?.data || error.message);

        // If unauthorized, prompt for authentication
        if (error.response && error.response.status === 401) {
            console.log('Session expired. Please authenticate again.');
            isAuthenticated = false;
            const authenticated = await authenticate();
            if (authenticated) {
                // Retry the request
                return callMCPServer(endpoint, method, data);
            }
        }

        return null;
    }
}

// Function to save analysis results to a file for Claude
function saveAnalysisToFile(analysisData, filename) {
    const filePath = path.join(ANALYSIS_DIR, filename);
    fs.writeFileSync(filePath, JSON.stringify(analysisData, null, 2));
    console.log(`Analysis saved to ${filePath}`);
    return filePath;
}

// Function to generate market analysis for Claude
async function generateMarketAnalysis() {
    console.log('\nGenerating comprehensive market analysis...');

    // 1. Get user inputs
    const symbolsInput = await promptUser('Enter symbols to analyze (comma separated): ');
    const symbols = symbolsInput.split(',').map(s => s.trim());

    // 2. Define timeframes
    const timeframes = ['1D', '1H', '15m'];
    const lookback = 30; // 30 days lookback

    // 3. Calculate end date (today) and start date
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - lookback);

    const toStr = endDate.toISOString().split('T')[0];
    const fromStr = startDate.toISOString().split('T')[0];

    // 4. Collect analysis data
    const analysisData = {
        generatedAt: new Date().toISOString(),
        symbols: {},
        marketOverview: {
            analyzedSymbols: symbols.length,
            timeframe: `${fromStr} to ${toStr}`,
            strongestMCPs: []
        }
    };

    // 5. Analyze each symbol across timeframes
    for (const symbol of symbols) {
        console.log(`\nAnalyzing ${symbol}...`);
        analysisData.symbols[symbol] = { timeframes: {} };

        for (const interval of timeframes) {
            console.log(`  - Calculating MCPs for ${interval} timeframe`);

            // Get historical data and MCP
            const result = await callMCPServer(
                `/historical-data/${encodeURIComponent(symbol)}/${interval}?from=${fromStr}&to=${toStr}`
            );

            if (result && result.mcp) {
                // Store the results
                analysisData.symbols[symbol].timeframes[interval] = {
                    mcp: result.mcp,
                    dataPoints: result.dataPoints.length,
                    lastPrice: result.dataPoints[result.dataPoints.length - 1].price,
                    distanceFromMCP: (
                        (result.dataPoints[result.dataPoints.length - 1].price - result.mcp.price) /
                        result.mcp.price * 100
                    ).toFixed(2) + '%'
                };

                // Add to strongest MCPs if connection strength is high
                if (result.mcp.connections > 5) {
                    analysisData.marketOverview.strongestMCPs.push({
                        symbol,
                        timeframe: interval,
                        price: result.mcp.price,
                        connections: result.mcp.connections
                    });
                }
            } else {
                analysisData.symbols[symbol].timeframes[interval] = { error: 'Failed to calculate MCP' };
            }
        }

        // Calculate overall strength score for this symbol
        const scores = Object.values(analysisData.symbols[symbol].timeframes)
            .filter(tf => tf.mcp)
            .map(tf => tf.mcp.connections);

        const avgScore = scores.length > 0
            ? scores.reduce((sum, score) => sum + score, 0) / scores.length
            : 0;

        analysisData.symbols[symbol].overallStrength = avgScore.toFixed(2);
    }

    // 6. Sort strongest MCPs
    analysisData.marketOverview.strongestMCPs.sort((a, b) => b.connections - a.connections);

    // 7. Generate trading recommendations
    analysisData.tradingRecommendations = [];

    for (const symbol of symbols) {
        const symbolData = analysisData.symbols[symbol];

        // Skip if we don't have proper data
        if (!symbolData || !symbolData.timeframes || !symbolData.timeframes['1D']) continue;

        const dailyData = symbolData.timeframes['1D'];
        if (!dailyData.mcp) continue;

        const lastPrice = dailyData.lastPrice;
        const mcpPrice = dailyData.mcp.price;
        const priceDiff = Math.abs(lastPrice - mcpPrice) / mcpPrice;

        // Generate recommendation if price is close to MCP
        if (priceDiff <= 0.01) { // Within 1% of MCP
            const recommendation = {
                symbol,
                action: lastPrice > mcpPrice ? 'BUY' : 'SELL',
                reason: `Price is within 1% of a strong MCP (${mcpPrice}) with ${dailyData.mcp.connections} connections`,
                timeframe: '1D',
                confidence: dailyData.mcp.connections > 10 ? 'High' : 'Medium'
            };

            analysisData.tradingRecommendations.push(recommendation);
        }
    }

    // 8. Save analysis to file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `market_analysis_${timestamp}.json`;
    const filePath = saveAnalysisToFile(analysisData, filename);

    console.log('\nMarket analysis complete!');
    console.log(`You can now share the file ${filename} with Claude for Mac for interpretation`);
    console.log(`Use the prompts from 'Claude Prompting Guide for MCP Trading Analysis.md'`);
}

// Function to generate MCP visualization data
async function generateVisualizationData() {
    const symbol = await promptUser('Enter symbol to visualize: ');
    const interval = await promptUser('Enter interval (e.g., 1D, 1H, 15m): ');
    const lookbackDays = parseInt(await promptUser('Enter lookback days: '));

    console.log(`\nGenerating visualization data for ${symbol}...`);

    // Calculate dates
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - lookbackDays);

    const toStr = endDate.toISOString().split('T')[0];
    const fromStr = startDate.toISOString().split('T')[0];

    // Get historical data and MCP
    const result = await callMCPServer(
        `/historical-data/${encodeURIComponent(symbol)}/${interval}?from=${fromStr}&to=${toStr}`
    );

    if (result && result.dataPoints) {
        // Prepare visualization data
        const vizData = {
            symbol,
            interval,
            period: `${fromStr} to ${toStr}`,
            priceData: result.dataPoints.map(point => ({
                date: point.timestamp,
                price: point.price
            })),
            mcp: result.mcp
        };

        // Save to file
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${symbol}_viz_${timestamp}.json`;
        const filePath = saveAnalysisToFile(vizData, filename);

        console.log(`\nVisualization data saved to ${filename}`);
        console.log('You can now share this with Claude for Mac to help create visualizations');
    } else {
        console.log('Failed to retrieve data for visualization');
    }
}

// Function to generate portfolio analysis
async function generatePortfolioAnalysis() {
    console.log('\nGenerating portfolio analysis...');

    // Get positions
    const positions = await callMCPServer('/positions');

    if (!positions) {
        console.log('Failed to retrieve portfolio positions');
        return;
    }

    // Prepare analysis data
    const analysisData = {
        generatedAt: new Date().toISOString(),
        portfolio: positions,
        mcpAnalysis: {}
    };

    // Get symbols from positions
    const symbols = positions.data.map(position => position.symbol);

    // Analyze each position against MCPs
    for (const symbol of symbols) {
        console.log(`Analyzing ${symbol} against MCPs...`);

        // Get daily MCPs for this symbol
        const result = await callMCPServer(`/historical-data/${encodeURIComponent(symbol)}/1D?from=2023-01-01&to=2023-04-01`);

        if (result && result.mcp) {
            analysisData.mcpAnalysis[symbol] = {
                mcp: result.mcp,
                currentPosition: positions.data.find(p => p.symbol === symbol)
            };
        }
    }

    // Save analysis to file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `portfolio_analysis_${timestamp}.json`;
    const filePath = saveAnalysisToFile(analysisData, filename);

    console.log(`\nPortfolio analysis saved to ${filename}`);
    console.log('You can now share this with Claude for Mac for portfolio insights');
}

// Helper function to prompt user for input
function promptUser(question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer);
        });
    });
}

// Main menu function
async function showMenu() {
    console.log('\n--- MCP Analysis Tool for Claude ---');
    console.log('1. Authenticate with Upstox');
    console.log('2. Generate Market Analysis (for Claude)');
    console.log('3. Generate Visualization Data (for Claude)');
    console.log('4. Generate Portfolio Analysis (for Claude)');
    console.log('0. Exit');

    const choice = await promptUser('\nEnter your choice: ');

    switch (choice) {
        case '1':
            await authenticate();
            break;
        case '2':
            await generateMarketAnalysis();
            break;
        case '3':
            await generateVisualizationData();
            break;
        case '4':
            await generatePortfolioAnalysis();
            break;
        case '0':
            console.log('Exiting...');
            rl.close();
            return;
        default:
            console.log('Invalid choice, please try again.');
    }

    // Show menu again
    await showMenu();
}

// Start the program
(async () => {
    console.log('Welcome to the MCP Analysis Tool for Claude for Mac!');
    console.log('This tool generates market analysis files for Claude to interpret');

    // Check if already authenticated
    const authStatus = await checkAuthStatus();
    if (!authStatus) {
        console.log('You need to authenticate with Upstox before using this tool.');
        await authenticate();
    } else {
        console.log('Already authenticated with Upstox.');
    }

    await showMenu();
})();