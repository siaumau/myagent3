// Todo List Service with AI-powered task completion
const mysql = require('mysql2/promise');

// Database configuration from .env
const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'testdb'
};

// Initialize todo_tasks table
async function initTable() {
  let connection;
  try {
    connection = await mysql.createConnection(DB_CONFIG);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS todo_tasks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(500) NOT NULL,
        description TEXT,
        status ENUM('pending', 'in_progress', 'completed', 'failed') DEFAULT 'pending',
        priority ENUM('low', 'medium', 'high') DEFAULT 'medium',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        completed_at TIMESTAMP NULL,
        ai_analysis TEXT,
        verification_result TEXT,
        error_message TEXT
      )
    `);
    console.log('[TodoService] Table initialized');
  } catch (err) {
    console.error('[TodoService] Table init error:', err.message);
  } finally {
    if (connection) await connection.end();
  }
}

// Create a new task
async function createTask(title, description = null, priority = 'medium') {
  let connection;
  try {
    connection = await mysql.createConnection(DB_CONFIG);
    const [result] = await connection.query(
      'INSERT INTO todo_tasks (title, description, priority) VALUES (?, ?, ?)',
      [title, description, priority]
    );
    return { id: result.insertId, title, description, priority, status: 'pending' };
  } catch (err) {
    throw new Error(`Create task failed: ${err.message}`);
  } finally {
    if (connection) await connection.end();
  }
}

// Get all tasks
async function getAllTasks() {
  let connection;
  try {
    connection = await mysql.createConnection(DB_CONFIG);
    const [rows] = await connection.query('SELECT * FROM todo_tasks ORDER BY created_at DESC');
    return rows;
  } catch (err) {
    throw new Error(`Get tasks failed: ${err.message}`);
  } finally {
    if (connection) await connection.end();
  }
}

// Get pending tasks
async function getPendingTasks() {
  let connection;
  try {
    connection = await mysql.createConnection(DB_CONFIG);
    const [rows] = await connection.query(
      'SELECT * FROM todo_tasks WHERE status = ? ORDER BY priority DESC, created_at ASC',
      ['pending']
    );
    return rows;
  } catch (err) {
    throw new Error(`Get pending tasks failed: ${err.message}`);
  } finally {
    if (connection) await connection.end();
  }
}

// Update task status
async function updateTaskStatus(id, status, aiAnalysis = null, verificationResult = null, errorMessage = null) {
  let connection;
  try {
    connection = await mysql.createConnection(DB_CONFIG);
    const updates = ['status = ?'];
    const params = [status];

    if (aiAnalysis !== null) {
      updates.push('ai_analysis = ?');
      params.push(aiAnalysis);
    }
    if (verificationResult !== null) {
      updates.push('verification_result = ?');
      params.push(verificationResult);
    }
    if (errorMessage !== null) {
      updates.push('error_message = ?');
      params.push(errorMessage);
    }
    if (status === 'completed') {
      updates.push('completed_at = CURRENT_TIMESTAMP');
    }

    params.push(id);
    await connection.query(
      `UPDATE todo_tasks SET ${updates.join(', ')} WHERE id = ?`,
      params
    );
    return { id, status };
  } catch (err) {
    throw new Error(`Update task failed: ${err.message}`);
  } finally {
    if (connection) await connection.end();
  }
}

// Get task by ID
async function getTaskById(id) {
  let connection;
  try {
    connection = await mysql.createConnection(DB_CONFIG);
    const [rows] = await connection.query('SELECT * FROM todo_tasks WHERE id = ?', [id]);
    return rows[0] || null;
  } catch (err) {
    throw new Error(`Get task failed: ${err.message}`);
  } finally {
    if (connection) await connection.end();
  }
}

// Delete task
async function deleteTask(id) {
  let connection;
  try {
    connection = await mysql.createConnection(DB_CONFIG);
    await connection.query('DELETE FROM todo_tasks WHERE id = ?', [id]);
    return { id, deleted: true };
  } catch (err) {
    throw new Error(`Delete task failed: ${err.message}`);
  } finally {
    if (connection) await connection.end();
  }
}

module.exports = {
  initTable,
  createTask,
  getAllTasks,
  getPendingTasks,
  updateTaskStatus,
  getTaskById,
  deleteTask
};
