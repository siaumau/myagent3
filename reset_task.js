const mysql = require('mysql2/promise');

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'todo_app'
};

async function resetTask(taskId) {
  let connection;
  try {
    connection = await mysql.createConnection(DB_CONFIG);

    const query = 'UPDATE tasks SET status = ?, ai_analysis = NULL, verification_result = NULL, error_message = NULL WHERE id = ?';
    const [result] = await connection.execute(query, ['pending', taskId]);

    if (result.affectedRows > 0) {
      console.log(`✅ Task ${taskId} reset to pending status`);
    } else {
      console.log(`❌ Task ${taskId} not found`);
    }
  } catch (err) {
    console.error('Error resetting task:', err.message);
  } finally {
    if (connection) await connection.end();
  }
}

const taskId = process.argv[2] || 25;
resetTask(taskId);
