# 資料庫查詢功能設定說明

## 1. 安裝依賴

已自動安裝 `mysql2` 套件。

## 2. 設定 .env 檔案

在 `.env` 檔案中設定資料庫連線資訊：

```env
# Database configuration
DB_TYPE=mysql
DB_HOST=localhost
DB_PORT=3306
DB_NAME=testdb
DB_USER=root
DB_PASSWORD=password
```

## 3. 可用功能

### 3.1 列出所有表

**指令：**
- `列出資料庫中所有的表`
- `有哪些表`
- `查看資料庫表`

**回覆範例：**
```
資料庫 "testdb" 共有 5 個表：
users, products, orders, categories, logs
```

### 3.2 查詢特定表

**指令：**
- `查詢 users 表的資料`
- `查看 products 表有什麼資料`

**回覆範例：**
```
資料庫 "testdb" 的表 "users"，找到 3 筆資料：
[
  {
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com"
  },
  ...
]
```

### 3.3 搜尋特定資料

**指令：**
- `查詢 users 表中有沒有 John 的資訊`
- `搜尋 products 表包含 test 的資料`

**回覆範例：**
```
資料庫 "testdb" 的表 "users" 搜尋 "John"，找到 1 筆資料：
[
  {
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com"
  }
]
```

## 4. 安全說明

- 表名會經過驗證，防止 SQL 注入
- 查詢結果限制最多 50 筆
- 連線會在使用後自動關閉

## 5. 測試資料庫

如果你還沒有測試資料庫，可以使用以下 SQL 建立：

```sql
CREATE DATABASE testdb;
USE testdb;

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100),
  email VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO users (name, email) VALUES 
  ('John Doe', 'john@example.com'),
  ('Jane Smith', 'jane@example.com'),
  ('Bob Wilson', 'bob@example.com');
```

然後修改 `.env` 中的資料庫配置。
