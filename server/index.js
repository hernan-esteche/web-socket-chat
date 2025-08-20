import { createServer } from 'node:http';
import { connect } from '@tursodatabase/serverless';
import dotenv from 'dotenv';
import express from 'express';
import morgan from 'morgan';
import { Server } from 'socket.io';

dotenv.config();

const app = express();
app.disable('x-powered-by');

app.use(express.static('client'));
app.use(morgan('dev'));

const httpServer = createServer(app);
const io = new Server(httpServer, { connectionStateRecovery: {} });

const conn = connect({
	url: process.env.TURSO_DB_URL,
	authToken: process.env.TURSO_AUTH_TOKEN,
});

await conn.batch([
	`CREATE TABLE IF NOT EXISTS messages (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	content TEXT NOT NULL,
	username TEXT NOT NULL
)`,
]);

io.on('connection', async (socket) => {
	const { username, serverOffset } = socket.handshake.auth;
	console.log(`${username} connected`);

	socket.on('disconnect', () => {
		console.log(`${username} disconnected`);
	});

	socket.on('chat message', async (msg) => {
		let result;
		try {
			const insertStmt = conn.prepare(
				`INSERT INTO messages (content, username) VALUES (?, ?)`,
			);
			result = await insertStmt.run([msg, username]);
		} catch (error) {
			console.error('Error handling chat message:', error);
			return;
		}

		io.emit('chat message', msg, result.lastInsertRowid, username);
	});

	if (!socket.recovered) {
		try {
			const stmt = conn.prepare(
				`SELECT id, content, username FROM messages WHERE id > ?`,
			);
			const results = await stmt.all([serverOffset]);

			results.forEach((row) => {
				const { content, id, username } = row;
				socket.emit('chat message', content, id, username);
			});
		} catch (error) {
			console.error('Error fetching chat history:', error);
		}
	}
});

app.get('/', (_req, res) => {
	res.sendFile(`${process.cwd()}/client/index.html`);
});

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
	console.log(`Server is running on port ${PORT}`);
});
