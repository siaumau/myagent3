import re

# 讀取 server.js
with open(r'C:\D\eric\myagent3\server.js', 'r', encoding='utf8') as f:
    content = f.read()

# 找到 get_news 函式的起始和 get_air_quality 的起始
start_pattern = r"    \} else if \(name === 'get_news'\) \{"
end_pattern = r"    \} else if \(name === 'get_air_quality'\)"

# 替換整個 get_news 區塊
new_get_news = """    } else if (name === 'get_news') {
      // 獲取最新新聞 - 使用 news_fetcher 模組抓取真實新聞
      const { source, category } = args;
      const result = await fetchNews(source || 'openclaw');
      
      functionResult = {
        source: source || '新聞',
        category: category || '全部',
        news: result.news,
        count: result.count
      };
      
      if (!result.success) {
        console.warn('News fetch returned error:', result.error);
      }

"""

# 使用 re.sub 替換
content = re.sub(r"    \} else if \(name === 'get_news'\) \{[\s\S]*?    \} else if \(name === 'get_air_quality'\)", new_get_news + "    } else if (name === 'get_air_quality')", content)

# 寫入 server.js
with open(r'C:\D\eric\myagent3\server.js', 'w', encoding='utf8') as f:
    f.write(content)

print('Done! server.js updated.')
