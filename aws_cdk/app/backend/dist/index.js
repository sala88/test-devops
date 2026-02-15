"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const serverless_http_1 = __importDefault(require("serverless-http"));
const express_1 = __importDefault(require("express"));
const promise_1 = __importDefault(require("mysql2/promise"));
const redis_1 = require("redis");
const client_secrets_manager_1 = require("@aws-sdk/client-secrets-manager");
const app = (0, express_1.default)();
const secretsClient = new client_secrets_manager_1.SecretsManagerClient({});
async function getDbPassword() {
    if (process.env.DB_PASSWORD)
        return process.env.DB_PASSWORD;
    if (process.env.DB_PASSWORD_SECRET_ARN) {
        const response = await secretsClient.send(new client_secrets_manager_1.GetSecretValueCommand({ SecretId: process.env.DB_PASSWORD_SECRET_ARN }));
        if (response.SecretString) {
            const secret = JSON.parse(response.SecretString);
            if (secret.password)
                return secret.password;
        }
    }
    return 'password';
}
app.use(express_1.default.json());
app.get('/health', (req, res) => {
    res.json({ status: 'UP', timestamp: new Date() });
});
app.get('/test-db', async (req, res) => {
    try {
        const password = await getDbPassword();
        const connection = await promise_1.default.createConnection({
            host: process.env.DB_HOST || 'mysql',
            user: process.env.DB_USER || 'user',
            password,
            database: process.env.DB_NAME || 'myapp'
        });
        const [rows] = await connection.execute('SELECT 1 as result');
        await connection.end();
        const firstRow = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
        res.json({ status: 'connected', result: firstRow ? firstRow.result : null });
    }
    catch (err) {
        const error = err;
        res.status(500).json({ status: 'error', message: error.message });
    }
});
app.get('/test-redis', async (req, res) => {
    try {
        const client = (0, redis_1.createClient)({
            url: `redis://${process.env.REDIS_HOST || 'redis'}:${process.env.REDIS_PORT || 6379}`
        });
        client.on('error', err => console.log('Redis Client Error', err));
        await client.connect();
        const pong = await client.ping();
        await client.disconnect();
        res.json({ status: 'connected', result: pong });
    }
    catch (err) {
        const error = err;
        res.status(500).json({ status: 'error', message: error.message });
    }
});
if (require.main === module) {
    const port = Number(process.env.PORT) || 3000;
    app.listen(port, '0.0.0.0', () => {
        console.log(`Backend API listening at http://0.0.0.0:${port}`);
    });
}
exports.handler = (0, serverless_http_1.default)(app);
