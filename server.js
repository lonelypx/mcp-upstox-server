// MCP Server for Upstox Trading
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const dotenv = require('dotenv');
const UpstoxClient = require('upstox-js-sdk');
const fs = require('fs');
const path = require('path');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Upstox API credentials
const UPSTOX_API_KEY = process.env.UPSTOX_API_KEY;
const UPSTOX_API_SECRET = process.env.UPSTOX_API_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const TOKEN_FILE_PATH = path.join(__dirname, 'token.json');

// Base URLs
const UPSTOX_AUTH_URL = 'https://api.upstox.com/v2/login/authorization/dialog';
const UPSTOX_TOKEN_URL = 'https://api.upstox.com/v2/login/authorization/token';
const UPSTOX_BASE_URL = 'https://api.upstox.com/v2';

// Initialize Upstox SDK client
let upstoxClient = new UpstoxClient.ApiClient();
upstoxClient.basePath = UPSTOX_BASE_URL;

// Authentication state
let authState = {
    accessToken: null,
    refreshToken: null,
    expiresAt: null,
    isAuthenticated: false
};

// Load tokens from file if exists
try {
    if (fs.existsSync(TOKEN_FILE_PATH)) {
        const tokenData = JSON.parse(fs.readFileSync(TOKEN_FILE_PATH, 'utf8'));
        authState = {
            ...tokenData,
            isAuthenticated: !!tokenData.accessToken && new Date(tokenData.expiresAt) > new Date()
        };

        // Set token for SDK client if valid
        if (authState.isAuthenticated) {
            upstoxClient.authentications['OAUTH2'].accessToken = authState.accessToken;
        }
    }
} catch (error) {
    console.error('Error loading token file:', error);
}

// Save token data to file
function saveTokenData() {
    try {
        fs.writeFileSync(TOKEN_FILE_PATH, JSON.stringify(authState, null, 2));
    } catch (error) {
        console.error('Error saving token data:', error);
    }
}

// Check and refresh token if needed
async function ensureValidToken() {
    // If no tokens or expired, return false
    if (!authState.refreshToken || !authState.expiresAt) {
        return false;
    }

    // Check if token is about to expire (within 5 minutes)
    const expiresAt = new Date(authState.expiresAt);
    const now = new Date();
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

    // If token is still valid, return true
    if (expiresAt > fiveMinutesFromNow) {
        return true;
    }

    // Attempt to refresh token
    try {
        const response = await axios.post(UPSTOX_TOKEN_URL, {
            client_id: UPSTOX_API_KEY,
            client_secret: UPSTOX_API_SECRET,
            grant_type: 'refresh_token',
            refresh_token: authState.refreshToken
        });

        // Update auth state with new tokens
        authState = {
            accessToken: response.data.access_token,
            refreshToken: response.data.refresh_token,
            expiresAt: new Date(Date.now() + response.data.expires_in * 1000).toISOString(),
            isAuthenticated: true
        };

        // Update SDK client with new token
        upstoxClient.authentications['OAUTH2'].accessToken = authState.accessToken;

        // Save updated tokens
        saveTokenData();
        return true;
    } catch (error) {
        console.error('Token refresh error:', error.response?.data || error.message);
        return false;
    }
}

// Middleware to check authentication
async function requireAuth(req, res, next) {
    const isValid = await ensureValidToken();

    if (isValid) {
        next();
    } else {
        res.status(401).json({ error: 'Not authenticated or session expired' });
    }
}

// MCP calculation function
function calculateMCP(dataPoints) {
    if (!dataPoints || dataPoints.length === 0) {
        return null;
    }

    // Find the average price
    const sum = dataPoints.reduce((acc, point) => acc + point.price, 0);
    const avgPrice = sum / dataPoints.length;

    // Filter pivot points (points where price crosses the average)
    const pivotPoints = [];
    let aboveAvg = dataPoints[0].price > avgPrice;

    for (let i = 1; i < dataPoints.length; i++) {
        const currentAboveAvg = dataPoints[i].price > avgPrice;

        if (currentAboveAvg !== aboveAvg) {
            // Crossover detected
            pivotPoints.push({
                timestamp: dataPoints[i].timestamp,
                price: dataPoints[i].price
            });
            aboveAvg = currentAboveAvg;
        }
    }

    // Count connections for each pivot point
    const connections = pivotPoints.map(pivot => {
        let connectionCount = 0;

        dataPoints.forEach(point => {
            // Consider a point connected if price difference is within 0.1% of the pivot
            const priceDiff = Math.abs(pivot.price - point.price) / pivot.price;
            if (priceDiff <= 0.001) {
                connectionCount++;
            }
        });

        return {
            ...pivot,
            connections: connectionCount
        };
    });

    // Sort by connection count (descending)
    connections.sort((a, b) => b.connections - a.connections);

    // Return the most connected pivot(s)
    return connections.length > 0 ? connections[0] : null;
}

// Authentication endpoints
app.get('/auth', (req, res) => {
    const authUrl = `${UPSTOX_AUTH_URL}?client_id=${UPSTOX_API_KEY}&redirect_uri=${REDIRECT_URI}&response_type=code`;
    res.redirect(authUrl);
});

app.get('/callback', async (req, res) => {
    const { code } = req.query;

    if (!code) {
        return res.status(400).json({ error: 'Authorization code not provided' });
    }

    try {
        const response = await axios.post(UPSTOX_TOKEN_URL, {
            code,
            client_id: UPSTOX_API_KEY,
            client_secret: UPSTOX_API_SECRET,
            redirect_uri: REDIRECT_URI,
            grant_type: 'authorization_code'
        });

        // Save token data
        authState = {
            accessToken: response.data.access_token,
            refreshToken: response.data.refresh_token,
            expiresAt: new Date(Date.now() + response.data.expires_in * 1000).toISOString(),
            isAuthenticated: true
        };

        // Update SDK client with new token
        upstoxClient.authentications['OAUTH2'].accessToken = authState.accessToken;

        // Save token to file
        saveTokenData();

        res.json({ success: true, message: 'Authentication successful' });
    } catch (error) {
        console.error('Token exchange error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to exchange authorization code for access token' });
    }
});

app.get('/logout', (req, res) => {
    // Clear auth state
    authState = {
        accessToken: null,
        refreshToken: null,
        expiresAt: null,
        isAuthenticated: false
    };

    // Clear token file
    try {
        fs.writeFileSync(TOKEN_FILE_PATH, JSON.stringify({}, null, 2));
    } catch (error) {
        console.error('Error clearing token file:', error);
    }

    res.json({ success: true, message: 'Logged out successfully' });
});

// Market data endpoints
app.get('/historical-data/:symbol/:interval', requireAuth, async (req, res) => {
    const { symbol, interval } = req.params;
    const { from, to } = req.query;

    try {
        // Create SDK instance for this API
        const historicalDataApi = new UpstoxClient.HistoricalCandleDataApi(upstoxClient);

        // Call SDK method
        const response = await historicalDataApi.getHistoricalCandleData(
            symbol,
            interval,
            from,
            to
        );

        const dataPoints = response.data.candles.map(candle => ({
            timestamp: new Date(candle[0]),
            open: parseFloat(candle[1]),
            high: parseFloat(candle[2]),
            low: parseFloat(candle[3]),
            close: parseFloat(candle[4]),
            volume: parseFloat(candle[5]),
            price: parseFloat(candle[4]) // Using close price
        }));

        const mcp = calculateMCP(dataPoints);

        res.json({
            symbol,
            interval,
            dataPoints,
            mcp
        });
    } catch (error) {
        console.error('Historical data error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to fetch historical data' });
    }
});

// Get MCP for multiple symbols
app.post('/mcp/calculate', requireAuth, async (req, res) => {
    const { symbols, interval, from, to } = req.body;

    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
        return res.status(400).json({ error: 'No symbols provided' });
    }

    try {
        const results = {};
        const historicalDataApi = new UpstoxClient.HistoricalCandleDataApi(upstoxClient);

        // Process symbols in sequence to avoid rate limiting
        for (const symbol of symbols) {
            const response = await historicalDataApi.getHistoricalCandleData(
                symbol,
                interval,
                from,
                to
            );

            const dataPoints = response.data.candles.map(candle => ({
                timestamp: new Date(candle[0]),
                price: parseFloat(candle[4]) // Using close price
            }));

            results[symbol] = calculateMCP(dataPoints);
        }

        res.json(results);
    } catch (error) {
        console.error('MCP calculation error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to calculate MCPs' });
    }
});

// Trading execution endpoint
app.post('/trade', requireAuth, async (req, res) => {
    const { symbol, quantity, side, orderType, price } = req.body;

    try {
        const orderApi = new UpstoxClient.OrderApi(upstoxClient);
        const orderRequest = {
            symbol: symbol,
            quantity: quantity,
            side: side, // BUY or SELL
            orderType: orderType, // MARKET, LIMIT, SL, SL-M
            price: price || null,
            validity: 'DAY',
            disclosedQuantity: 0,
            triggerPrice: null,
            isAmo: false
        };

        const response = await orderApi.placeOrder(orderRequest);
        res.json(response.data);
    } catch (error) {
        console.error('Order placement error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to place order' });
    }
});

// Get portfolio positions
app.get('/positions', requireAuth, async (req, res) => {
    try {
        const portfolioApi = new UpstoxClient.PortfolioApi(upstoxClient);
        const response = await portfolioApi.getPositions();
        res.json(response.data);
    } catch (error) {
        console.error('Positions error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to fetch positions' });
    }
});

// Automated MCP trading strategy endpoint
app.post('/strategy/mcp', requireAuth, async (req, res) => {
    const { symbol, interval, lookbackDays, investmentAmount } = req.body;

    try {
        // Calculate dates
        const to = new Date();
        const from = new Date();
        from.setDate(from.getDate() - (lookbackDays || 30));

        const toStr = to.toISOString().split('T')[0];
        const fromStr = from.toISOString().split('T')[0];

        // Fetch historical data using SDK
        const historicalDataApi = new UpstoxClient.HistoricalCandleDataApi(upstoxClient);
        const histResponse = await historicalDataApi.getHistoricalCandleData(
            symbol,
            interval,
            fromStr,
            toStr
        );

        const dataPoints = histResponse.data.candles.map(candle => ({
            timestamp: new Date(candle[0]),
            price: parseFloat(candle[4]) // Using close price
        }));

        // Calculate MCP
        const mcp = calculateMCP(dataPoints);

        if (!mcp) {
            return res.status(404).json({ error: 'No MCP found for given parameters' });
        }

        // Get current market price using SDK
        const marketDataApi = new UpstoxClient.MarketQuoteApi(upstoxClient);
        const quoteResponse = await marketDataApi.getMarketQuoteOHLC([symbol]);
        const currentPrice = quoteResponse.data[symbol].last_price;

        // Determine trading action based on MCP analysis
        let action = null;
        let orderPrice = null;

        const mcpDeviation = Math.abs(currentPrice - mcp.price) / mcp.price;

        if (mcpDeviation <= 0.005) { // Within 0.5% of MCP
            // We're at or near an MCP, evaluate trend direction
            const recentPoints = dataPoints.slice(-10);
            const avgRecentPrice = recentPoints.reduce((sum, p) => sum + p.price, 0) / recentPoints.length;

            if (currentPrice > avgRecentPrice) {
                action = 'BUY'; // Uptrend near MCP
            } else {
                action = 'SELL'; // Downtrend near MCP
            }

            orderPrice = currentPrice;
        }

        if (action) {
            // Calculate quantity based on investment amount
            const quantity = Math.floor(investmentAmount / currentPrice);

            if (quantity > 0) {
                // Place the order using SDK
                const orderApi = new UpstoxClient.OrderApi(upstoxClient);
                const orderRequest = {
                    symbol,
                    quantity,
                    side: action,
                    orderType: 'LIMIT',
                    price: orderPrice,
                    validity: 'DAY',
                    disclosedQuantity: 0,
                    triggerPrice: null,
                    isAmo: false
                };

                const orderResponse = await orderApi.placeOrder(orderRequest);

                res.json({
                    strategy: 'MCP',
                    action,
                    order: orderResponse.data,
                    mcp,
                    currentPrice,
                    analysis: {
                        mcpDeviation: mcpDeviation * 100 + '%',
                        connectionStrength: mcp.connections
                    }
                });
            } else {
                res.status(400).json({ error: 'Investment amount too small for minimum quantity' });
            }
        } else {
            res.json({
                strategy: 'MCP',
                action: 'HOLD',
                reason: 'Price not sufficiently close to MCP',
                mcp,
                currentPrice,
                analysis: {
                    mcpDeviation: mcpDeviation * 100 + '%',
                    connectionStrength: mcp.connections
                }
            });
        }
    } catch (error) {
        console.error('Strategy execution error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to execute MCP strategy' });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`MCP Server running on port ${PORT}`);
});

module.exports = app;