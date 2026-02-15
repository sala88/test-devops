const serverless = require('serverless-http');
const express = require('express');
const mysql = require('mysql2/promise');
const { createClient } = require('redis');
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");

const app = express();
const secretsClient = new SecretsManagerClient();

// Helper to get DB password
async function getDbPassword() {
  if (process.env.DB_PASSWORD) return process.env.DB_PASSWORD;
  if (process.env.DB_PASSWORD_SECRET_ARN) {
    try {
      const response = await secretsClient.send(new GetSecretValueCommand({ SecretId: process.env.DB_PASSWORD_SECRET_ARN }));
      if (response.SecretString) {
        const secret = JSON.parse(response.SecretString);
        return secret.password;
      }
    } catch (error) {
      console.error("Error retrieving secret:", error);
      throw error;
    }
  }
  return 'password'; // Default fallback
}

app.use(express.json());

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'UP', timestamp: new Date() });
});

// MySQL Test
app.get('/test-db', async (req, res) => {
  try {
    const password = await getDbPassword();
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'mysql',
      user: process.env.DB_USER || 'user',
      password: password,
      database: process.env.DB_NAME || 'myapp'
    });
    const [rows] = await connection.execute('SELECT 1 as result');
    await connection.end();
    res.json({ status: 'connected', result: rows[0].result });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Redis Test
app.get('/test-redis', async (req, res) => {
  try {
    const client = createClient({
      url: `redis://${process.env.REDIS_HOST || 'redis'}:${process.env.REDIS_PORT || 6379}`
    });
    client.on('error', err => console.log('Redis Client Error', err));
    await client.connect();
    const pong = await client.ping();
    await client.disconnect();
    res.json({ status: 'connected', result: pong });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Avvio server se eseguito direttamente (Docker/K8s)
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Backend API listening at http://0.0.0.0:${port}`);
  });
}

module.exports.handler = serverless(app);
