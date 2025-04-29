# MCP Upstox Trading Server

## Project Overview

The Most Connected Pivot (MCP) Upstox Trading Server is an automated trading application that identifies and trades based on high-probability support and resistance levels in the market. The system analyzes historical price data to identify pivot points where price has repeatedly interacted with specific levels, and executes trades when current prices approach these significant levels.

### What is MCP (Most Connected Pivot)?

MCP is a technical analysis concept that identifies price levels that have acted as significant support or resistance in the past. These are points where:

1. Price has crossed its average multiple times (pivots)
2. Multiple price points have clustered around a specific level (connections)
3. The level with the most connections becomes the MCP - a high-probability reversal zone

The strategy assumes that price is more likely to respect levels that have previously acted as support/resistance multiple times, giving traders a statistical edge.

## Prerequisites

- Node.js (v14 or higher)
- NPM (Node Package Manager)
- Upstox Developer Account with API access
- Basic understanding of JavaScript and trading concepts

## Installation Steps

1. **Create a project directory**
   ```bash
   mkdir mcp-upstox-server
   cd mcp-upstox-server
   ```

2. **Initialize the project**
   ```bash
   npm init -y
   ```

3. **Install required dependencies**
   ```bash
   npm install express axios cors dotenv upstox-js-sdk
   ```

4. **Create server files**
   - Copy the provided server code into a file named `server.js`
   - Create a `.env` file with the configuration provided

5. **Get Upstox API credentials**
   - Log in to your Upstox Developer Account
   - Create a new application to get your API key and secret
   - Set the redirect URI as `http://localhost:3000/callback` or your custom domain
   - Update the `.env` file with your credentials

## Environment Setup

### Development Environment

Create a `.env.development` file with the following configuration:

```
PORT=3000
UPSTOX_API_KEY=your_development_api_key
UPSTOX_API_SECRET=your_development_api_secret
REDIRECT_URI=http://localhost:3000/callback
NODE_ENV=development
```

To run in development mode:

```bash
NODE_ENV=development node server.js
```

### Testing Environment

Create a `.env.test` file:

```
PORT=3001
UPSTOX_API_KEY=your_test_api_key
UPSTOX_API_SECRET=your_test_api_secret
REDIRECT_URI=http://localhost:3001/callback
NODE_ENV=test
```

To run in test mode:

```bash
NODE_ENV=test node server.js
```

### Production Environment

Create a `.env.production` file:

```
PORT=8080
UPSTOX_API_KEY=your_production_api_key
UPSTOX_API_SECRET=your_production_api_secret
REDIRECT_URI=https://your-domain.com/callback
NODE_ENV=production
```

To run in production mode:

```bash
NODE_ENV=production node server.js
```

## Deployment Options

### Local Deployment

For personal or development use:

```bash
node server.js
```

### Cloud Deployment

#### Heroku

1. Create a Procfile:
   ```
   web: node server.js
   ```

2. Set up environment variables in Heroku dashboard

3. Deploy:
   ```bash
   git push heroku main
   ```

#### AWS EC2

1. Set up an EC2 instance
2. Install Node.js and npm
3. Clone repository
4. Set up environment variables
5. Use PM2 to manage the Node process:
   ```bash
   npm install -g pm2
   pm2 start server.js
   ```

#### Docker Deployment

Create a Dockerfile:

```dockerfile
FROM node:16
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 8080
CMD ["node", "server.js"]
```

Build and run:

```bash
docker build -t mcp-upstox-server .
docker run -p 8080:8080 -d mcp-upstox-server
```

## Running the Server

1. **Start the server**
   ```bash
   node server.js
   ```

2. **Authenticate with Upstox**
   - Open your browser and navigate to `http://localhost:3000/auth`
   - You will be redirected to Upstox login page
   - After logging in and authorizing the application, you'll be redirected back to your server
   - You should see a success message indicating authentication was successful
   - Your tokens are now securely stored and will automatically refresh when needed

## Authentication Improvements

The server now includes the following authentication improvements:

1. **Token Persistence**
   - Access and refresh tokens are stored securely in a local file (`token.json`)
   - Tokens are loaded on server startup, eliminating the need to re-authenticate

2. **Automatic Token Refresh**
   - The system automatically detects when tokens are about to expire
   - Tokens are refreshed in the background 5 minutes before expiry
   - All API calls use the middleware that ensures a valid token is available

3. **Logout Functionality**
   - A new `/logout` endpoint allows users to completely sign out
   - This clears all stored tokens from memory and disk

## Upstox SDK Integration

The server now uses the official Upstox JavaScript SDK, providing:

1. **Simplified API Calls**
   - Direct access to all Upstox API endpoints through a consistent interface
   - Type checking and better error handling for API requests

2. **Automatic Request Formatting**
   - The SDK handles proper formatting of all API requests
   - Ensures compliance with Upstox API requirements

3. **Easier Maintenance**
   - API changes are handled through SDK updates
   - Reduces the need to modify code when the Upstox API evolves

## Using the MCP Trading API

### Calculate MCP for a Symbol

**Request:**
```
GET /historical-data/NSE_FO%7CNIFTY-I/1D?from=2023-01-01&to=2023-04-01
```

**Response:**
```json
{
  "symbol": "NSE_FO|NIFTY-I",
  "interval": "1D",
  "dataPoints": [...],
  "mcp": {
    "timestamp": "2023-02-15T09:15:00.000Z",
    "price": 17865.75,
    "connections": 12
  }
}
```

### Calculate MCPs for Multiple Symbols

**Request:**
```
POST /mcp/calculate
Content-Type: application/json

{
  "symbols": ["NSE_FO|NIFTY-I", "NSE_FO|BANKNIFTY-I"],
  "interval": "1D",
  "from": "2023-01-01",
  "to": "2023-04-01"
}
```

**Response:**
```json
{
  "NSE_FO|NIFTY-I": {
    "timestamp": "2023-02-15T09:15:00.000Z",
    "price": 17865.75,
    "connections": 12
  },
  "NSE_FO|BANKNIFTY-I": {
    "timestamp": "2023-02-18T09:15:00.000Z",
    "price": 41235.50,
    "connections": 9
  }
}
```

### Execute a Trade

**Request:**
```
POST /trade
Content-Type: application/json

{
  "symbol": "NSE_FO|NIFTY-I",
  "quantity": 50,
  "side": "BUY",
  "orderType": "LIMIT",
  "price": 17850
}
```

**Response:**
```json
{
  "order_id": "12345678",
  "status": "success",
  "message": "Order placed successfully"
}
```

### Run Automated MCP Strategy

**Request:**
```
POST /strategy/mcp
Content-Type: application/json

{
  "symbol": "NSE_FO|NIFTY-I",
  "interval": "1D",
  "lookbackDays": 30,
  "investmentAmount": 100000
}
```

**Response:**
```json
{
  "strategy": "MCP",
  "action": "BUY",
  "order": {
    "order_id": "12345678",
    "status": "success"
  },
  "mcp": {
    "timestamp": "2023-03-15T09:15:00.000Z",
    "price": 17865.75,
    "connections": 12
  },
  "currentPrice": 17870.25,
  "analysis": {
    "mcpDeviation": "0.03%",
    "connectionStrength": 12
  }
}
```

## Security Considerations

### Development Environment
- Use test API keys with limited permissions
- Store tokens in memory only (disable file persistence)
- Enable detailed error logging

### Production Environment
- Use proper API key management with restricted permissions
- Use a secure database for token storage instead of file system
- Implement IP whitelisting for API access
- Enable HTTPS for all connections
- Use a reverse proxy like Nginx
- Implement rate limiting

Add the following code to server.js for production mode:

```javascript
if (process.env.NODE_ENV === 'production') {
  // Force HTTPS
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      res.redirect(`https://${req.header('host')}${req.url}`);
    } else {
      next();
    }
  });
  
  // Rate limiting
  const rateLimit = require('express-rate-limit');
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
  });
  app.use(limiter);
}
```

## Troubleshooting

- **Authentication Issues**: Ensure API credentials are correct in `.env` file
- **Order Placement Errors**: Check quantity meets minimum lot size requirements
- **Data Retrieval Issues**: Verify symbol format is correct (NSE_FO|SYMBOL-I)
- **Token Refresh Failures**: Check if your API key has expired or been revoked

## Further Customization

The MCP calculation and trading logic can be customized by modifying:

1. `calculateMCP()` function - Adjust connection criteria, pivot point identification
2. Strategy endpoint - Modify deviation threshold, trend identification logic
3. Order parameters - Change order types, validity, disclosure quantity

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License.