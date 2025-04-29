// Cursor AI Integration Script for MCP Upstox Server
const axios = require('axios');
const readline = require('readline');

// Configure server URL
const MCP_SERVER_URL = 'http://localhost:3000'; // Change if your server runs elsewhere

// Create readline interface for command-line interaction
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Store auth status
let isAuthenticated = false;

// Helper function to make API calls to MCP server
async function callMCPServer(endpoint, method = 'GET', data = null) {
    try {
        const config = {
            method,
            url: `${MCP_SERVER_URL}${endpoint}`,
            ...(data && { data }),
            withCredentials: true // Important for auth cookie handling
        };

        const response = await axios(config);
        return response.data;
    } catch (error) {
        console.error('Error calling MCP server:', error.response?.data || error.message);

        // If authentication error, set status to false
        if (error.response && error.response.status === 401) {
            isAuthenticated = false;
            console.log('Authentication required. Please authenticate first.');
        }

        return null;
    }
}

// Check authentication status
async function checkAuthStatus() {
    try {
        // Try to make a simple API call that requires authentication
        await callMCPServer('/positions');
        isAuthenticated = true;
        return true;
    } catch (error) {
        if (error.response && error.response.status === 401) {
            isAuthenticated = false;
            return false;
        }
        console.error('Error checking auth status:', error.message);
        return false;
    }
}

// Function to authenticate with Upstox
async function authenticate() {
    console.log(`\nPlease open the following URL in your browser to authenticate with Upstox:`);
    console.log(`${MCP_SERVER_URL}/auth\n`);

    await promptUser('Press Enter once you have completed authentication...');

    // Verify authentication was successful
    console.log('Verifying authentication...');
    try {
        // Make a test API call to verify authentication
        const result = await callMCPServer('/positions');

        if (result) {
            console.log('Authentication successful!');
            isAuthenticated = true;
            return true;
        } else {
            console.log('Authentication failed or session expired. Please try again.');
            return false;
        }
    } catch (error) {
        console.log('Authentication verification failed:', error.message);
        return false;
    }
}

// Function to calculate MCP for a single symbol
async function calculateSingleMCP() {
    // Check authentication first
    if (!isAuthenticated) {
        console.log('Please authenticate first (option 1)');
        return;
    }

    const symbol = await promptUser('Enter symbol (e.g., NSE_FO|NIFTY-I): ');
    const interval = await promptUser('Enter interval (e.g., 1D, 1H, 15m): ');
    const from = await promptUser('Enter start date (YYYY-MM-DD): ');
    const to = await promptUser('Enter end date (YYYY-MM-DD): ');

    console.log(`\nCalculating MCP for ${symbol}...`);

    const result = await callMCPServer(`/historical-data/${encodeURIComponent(symbol)}/${interval}?from=${from}&to=${to}`);

    if (result && result.mcp) {
        console.log('\nMCP Results:');
        console.log(`Price: ${result.mcp.price}`);
        console.log(`Timestamp: ${result.mcp.timestamp}`);
        console.log(`Connection Strength: ${result.mcp.connections}`);
    }
}

// Function to calculate MCPs for multiple symbols
async function calculateMultipleMCPs() {
    // Check authentication first
    if (!isAuthenticated) {
        console.log('Please authenticate first (option 1)');
        return;
    }

    const symbolsInput = await promptUser('Enter symbols separated by commas: ');
    const symbols = symbolsInput.split(',').map(s => s.trim());

    const interval = await promptUser('Enter interval (e.g., 1D, 1H, 15m): ');
    const from = await promptUser('Enter start date (YYYY-MM-DD): ');
    const to = await promptUser('Enter end date (YYYY-MM-DD): ');

    console.log(`\nCalculating MCPs for ${symbols.length} symbols...`);

    const result = await callMCPServer('/mcp/calculate', 'POST', {
        symbols,
        interval,
        from,
        to
    });

    if (result) {
        console.log('\nMCP Results:');
        Object.entries(result).forEach(([symbol, mcp]) => {
            console.log(`\n${symbol}:`);
            console.log(`  Price: ${mcp.price}`);
            console.log(`  Timestamp: ${mcp.timestamp}`);
            console.log(`  Connection Strength: ${mcp.connections}`);
        });
    }
}

// Function to execute a trade
async function executeTrade() {
    // Check authentication first
    if (!isAuthenticated) {
        console.log('Please authenticate first (option 1)');
        return;
    }

    const symbol = await promptUser('Enter symbol (e.g., NSE_FO|NIFTY-I): ');
    const quantity = parseInt(await promptUser('Enter quantity: '));
    const side = await promptUser('Enter side (BUY/SELL): ');
    const orderType = await promptUser('Enter order type (MARKET/LIMIT): ');

    let price = null;
    if (orderType.toUpperCase() === 'LIMIT') {
        price = parseFloat(await promptUser('Enter price: '));
    }

    console.log(`\nExecuting ${side} order for ${quantity} of ${symbol}...`);

    const result = await callMCPServer('/trade', 'POST', {
        symbol,
        quantity,
        side: side.toUpperCase(),
        orderType: orderType.toUpperCase(),
        price
    });

    if (result) {
        console.log('\nOrder Result:');
        console.log(result);
    }
}

// Function to run MCP strategy
async function runStrategy() {
    // Check authentication first
    if (!isAuthenticated) {
        console.log('Please authenticate first (option 1)');
        return;
    }

    const symbol = await promptUser('Enter symbol (e.g., NSE_FO|NIFTY-I): ');
    const interval = await promptUser('Enter interval (e.g., 1D, 1H, 15m): ');
    const lookbackDays = parseInt(await promptUser('Enter lookback days: '));
    const investmentAmount = parseFloat(await promptUser('Enter investment amount: '));

    console.log(`\nRunning MCP strategy for ${symbol}...`);

    const result = await callMCPServer('/strategy/mcp', 'POST', {
        symbol,
        interval,
        lookbackDays,
        investmentAmount
    });

    if (result) {
        console.log('\nStrategy Result:');
        console.log(`Action: ${result.action}`);
        console.log(`MCP Price: ${result.mcp.price}`);
        console.log(`Current Price: ${result.currentPrice}`);
        console.log(`Deviation: ${result.analysis.mcpDeviation}`);
        console.log(`Connection Strength: ${result.analysis.connectionStrength}`);

        if (result.order) {
            console.log('\nOrder Details:');
            console.log(result.order);
        }
    }
}

// Function to view positions
async function viewPositions() {
    // Check authentication first
    if (!isAuthenticated) {
        console.log('Please authenticate first (option 1)');
        return;
    }

    console.log('\nFetching current positions...');

    const result = await callMCPServer('/positions');

    if (result) {
        console.log('\nCurrent Positions:');
        console.log(result);
    }
}

// Function to logout
async function logout() {
    console.log('\nLogging out from Upstox...');

    const result = await callMCPServer('/logout');

    if (result && result.success) {
        console.log('Successfully logged out.');
        isAuthenticated = false;
    } else {
        console.log('Logout failed or not needed.');
    }
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
    // Check authentication status
    if (!isAuthenticated) {
        const status = await checkAuthStatus();
        isAuthenticated = status;
    }

    console.log('\n--- MCP Upstox Trading Tool ---');
    console.log(`Authentication Status: ${isAuthenticated ? 'Authenticated ✓' : 'Not Authenticated ✗'}`);
    console.log('1. Authenticate with Upstox');
    console.log('2. Calculate MCP for a symbol');
    console.log('3. Calculate MCPs for multiple symbols');
    console.log('4. Execute a trade');
    console.log('5. Run MCP strategy');
    console.log('6. View current positions');
    console.log('7. Logout');
    console.log('0. Exit');

    const choice = await promptUser('\nEnter your choice: ');

    switch (choice) {
        case '1':
            await authenticate();
            break;
        case '2':
            await calculateSingleMCP();
            break;
        case '3':
            await calculateMultipleMCPs();
            break;
        case '4':
            await executeTrade();
            break;
        case '5':
            await runStrategy();
            break;
        case '6':
            await viewPositions();
            break;
        case '7':
            await logout();
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
    console.log('Welcome to the MCP Upstox Trading Tool!');
    console.log('This tool allows you to interact with your MCP server from Cursor AI');

    // Check if already authenticated
    const authStatus = await checkAuthStatus();
    if (authStatus) {
        console.log('Already authenticated with Upstox.');
        isAuthenticated = true;
    } else {
        console.log('You need to authenticate before using the tools.');
    }

    await showMenu();
})();