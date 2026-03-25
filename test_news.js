// 測試新聞抓取
const { fetchNews } = require('./news_fetcher');

async function test() {
  console.log('測試 openclaw 新聞...');
  const result1 = await fetchNews('openclaw');
  console.log('openclaw 結果:', JSON.stringify(result1, null, 2));
  
  console.log('\n測試世界新聞...');
  const result2 = await fetchNews('世界');
  console.log('世界新聞結果:', JSON.stringify(result2, null, 2));
  
  console.log('\n測試 Yahoo 新聞...');
  const result3 = await fetchNews('yahoo');
  console.log('Yahoo 新聞結果:', JSON.stringify(result3, null, 2));
}

test().catch(console.error);
