import serverless from 'serverless-http';
import express, { Request, Response } from 'express';
import mysql from 'mysql2/promise';
import { createClient } from 'redis';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const app = express();
const secretsClient = new SecretsManagerClient({});

async function getDbPassword(): Promise<string> {
  if (process.env.DB_PASSWORD) return process.env.DB_PASSWORD;
  if (process.env.DB_PASSWORD_SECRET_ARN) {
    const response = await secretsClient.send(
      new GetSecretValueCommand({ SecretId: process.env.DB_PASSWORD_SECRET_ARN })
    );
    if (response.SecretString) {
      const secret = JSON.parse(response.SecretString) as { password?: string };
      if (secret.password) return secret.password;
    }
  }
  return 'password';
}

app.use(express.json());

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'UP', timestamp: new Date() });
});

app.get('/test-db', async (req: Request, res: Response) => {
  try {
    const password = await getDbPassword();
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'mysql',
      user: process.env.DB_USER || 'user',
      password,
      database: process.env.DB_NAME || 'myapp'
    });
    const [rows] = await connection.execute('SELECT 1 as result');
    await connection.end();
    const firstRow = Array.isArray(rows) && rows.length > 0 ? (rows[0] as any) : null;
    res.json({ status: 'connected', result: firstRow ? firstRow.result : null });
  } catch (err) {
    const error = err as Error;
    res.status(500).json({ status: 'error', message: error.message });
  }
});

app.get('/test-redis', async (req: Request, res: Response) => {
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
    const error = err as Error;
    res.status(500).json({ status: 'error', message: error.message });
  }
});

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Backend API listening at http://0.0.0.0:${port}`);
  });
}

export const handler = serverless(app);

