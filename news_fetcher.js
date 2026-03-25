// 新聞抓取模組 - 使用 fetch 抓取真實新聞

async function fetchNews(source) {
  try {
    let newsData = [];

    if (source === 'openclaw') {
      // 抓取 ETtoday 東森新聞 sitemap
      const response = await fetch('https://www.ettoday.net/news/sitemap.xml', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/xml,application/xml',
          'Accept-Language': 'zh-TW,zh;q=0.9'
        }
      });
      const xml = await response.text();
      
      // 解析 XML 取得新聞連結
      const urlMatches = [...xml.matchAll(/<loc>(https:\/\/www\.ettoday\.net\/news\/\d+\/\d+\.htm)<\/loc>/g)];
      
      if (urlMatches.length > 0) {
        for (let i = 0; i < Math.min(urlMatches.length, 5); i++) {
          const url = urlMatches[i][1];
          newsData.push({
            title: `ETtoday 新聞 ${i + 1}`,
            date: new Date().toLocaleDateString('zh-TW'),
            summary: '點擊查看完整新聞',
            url: url
          });
        }
      }
      
      if (newsData.length === 0) {
        newsData = [
          { title: 'ETtoday 最新新聞', date: new Date().toLocaleDateString('zh-TW'), summary: 'ETtoday 新聞雲即時新聞', url: 'https://www.ettoday.net/news/' },
          { title: 'ETtoday 政治新聞', date: new Date().toLocaleDateString('zh-TW'), summary: 'ETtoday 政治新聞', url: 'https://www.ettoday.net/news/political/' },
          { title: 'ETtoday 財經新聞', date: new Date().toLocaleDateString('zh-TW'), summary: 'ETtoday 財經新聞', url: 'https://www.ettoday.net/news/finance/' }
        ];
      }
    } else if (source === '世界' || source === 'world') {
      // 抓取 BBC 中文網 RSS
      const response = await fetch('https://feeds.bbci.co.uk/zhongwen/trad/rss.xml', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/xml,application/xml',
          'Accept-Language': 'zh-TW,zh;q=0.9'
        }
      });
      const xml = await response.text();
      
      // 解析 RSS XML
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
      
      for (let i = 0; i < Math.min(items.length, 5); i++) {
        const item = items[i][0];
        const titleMatch = item.match(/<title>([^<]+)<\/title>/);
        const linkMatch = item.match(/<link>([^<]+)<\/link>/);
        const descMatch = item.match(/<description>([^<]+)<\/description>/);
        
        newsData.push({
          title: titleMatch ? titleMatch[1] : `BBC 新聞 ${i + 1}`,
          date: new Date().toLocaleDateString('zh-TW'),
          summary: descMatch ? descMatch[1].substring(0, 50) + '...' : '點擊查看完整新聞',
          url: linkMatch ? linkMatch[1] : 'https://www.bbc.com/zhongwen/trad'
        });
      }
      
      if (newsData.length === 0) {
        newsData = [
          { title: 'BBC 中文網：國際新聞', date: new Date().toLocaleDateString('zh-TW'), summary: 'BBC 中文網最新國際新聞', url: 'https://www.bbc.com/zhongwen/trad/world' },
          { title: 'BBC 中文網：兩岸新聞', date: new Date().toLocaleDateString('zh-TW'), summary: 'BBC 中文網兩岸新聞', url: 'https://www.bbc.com/zhongwen/trad/china' },
          { title: 'BBC 中文網：財經新聞', date: new Date().toLocaleDateString('zh-TW'), summary: 'BBC 中文網財經新聞', url: 'https://www.bbc.com/zhongwen/trad/business' }
        ];
      }
    } else {
      // 預設：Yahoo 新聞 RSS
      const response = await fetch('https://tw.news.yahoo.com/rss', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/xml,application/xml',
          'Accept-Language': 'zh-TW,zh;q=0.9'
        }
      });
      const xml = await response.text();
      
      // 解析 RSS XML
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
      
      for (let i = 0; i < Math.min(items.length, 5); i++) {
        const item = items[i][0];
        const titleMatch = item.match(/<title>([^<]+)<\/title>/);
        const linkMatch = item.match(/<link>([^<]+)<\/link>/);
        const descMatch = item.match(/<description>([^<]+)<\/description>/);
        
        newsData.push({
          title: titleMatch ? titleMatch[1] : `Yahoo 新聞 ${i + 1}`,
          date: new Date().toLocaleDateString('zh-TW'),
          summary: descMatch ? descMatch[1].substring(0, 50) + '...' : '點擊查看完整新聞',
          url: linkMatch ? linkMatch[1] : 'https://tw.news.yahoo.com/'
        });
      }
      
      if (newsData.length === 0) {
        newsData = [
          { title: 'Yahoo 新聞：即時新聞', date: new Date().toLocaleDateString('zh-TW'), summary: 'Yahoo 新聞最新即時新聞', url: 'https://tw.news.yahoo.com/' },
          { title: 'Yahoo 新聞：政治新聞', date: new Date().toLocaleDateString('zh-TW'), summary: 'Yahoo 新聞政治新聞', url: 'https://tw.news.yahoo.com/politics' },
          { title: 'Yahoo 新聞：財經新聞', date: new Date().toLocaleDateString('zh-TW'), summary: 'Yahoo 新聞財經新聞', url: 'https://tw.news.yahoo.com/finance' }
        ];
      }
    }

    return { success: true, news: newsData.slice(0, 5), count: newsData.length };
  } catch (err) {
    console.error('fetchNews error:', err.message);
    return {
      success: false,
      news: [
        { title: 'ETtoday 新聞雲', date: new Date().toLocaleDateString('zh-TW'), summary: 'ETtoday 新聞雲即時新聞...', url: 'https://www.ettoday.net/news/' },
        { title: 'BBC 中文網', date: new Date().toLocaleDateString('zh-TW'), summary: 'BBC 中文網國際新聞...', url: 'https://www.bbc.com/zhongwen/trad' },
        { title: 'Yahoo 新聞', date: new Date().toLocaleDateString('zh-TW'), summary: 'Yahoo 新聞提供各類即時新聞...', url: 'https://tw.news.yahoo.com/' }
      ],
      count: 3,
      error: err.message
    };
  }
}

module.exports = { fetchNews };
