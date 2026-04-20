const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const RSSParser = require('rss-parser');

const app = express();
app.use(cors());
app.use(express.json());

const parser = new RSSParser({
  timeout: 10000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: false }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: false }],
      ['enclosure', 'enclosure', { keepArray: false }],
    ]
  }
});

const FEEDS = [
  { url: 'https://www.rappler.com/feed/', source: 'Rappler' },
  { url: 'https://newsinfo.inquirer.net/feed', source: 'Inquirer' },
  { url: 'https://technology.inquirer.net/feed', source: 'Inquirer Tech' },
  { url: 'https://entertainment.inquirer.net/feed', source: 'Inquirer Entertainment' },
  { url: 'https://sports.inquirer.net/feed', source: 'Inquirer Sports' },
  { url: 'https://business.inquirer.net/feed', source: 'Inquirer Business' },
  { url: 'https://www.philstar.com/rss/headlines', source: 'PhilStar' },
  { url: 'https://www.philstar.com/rss/entertainment', source: 'PhilStar Entertainment' },
  { url: 'https://www.philstar.com/rss/sports', source: 'PhilStar Sports' },
  { url: 'https://www.gmanetwork.com/news/rss/news', source: 'GMA News' },
  { url: 'https://www.gmanetwork.com/news/rss/entertainment', source: 'GMA Entertainment' },
  { url: 'https://www.gmanetwork.com/news/rss/sports', source: 'GMA Sports' },
  { url: 'https://mb.com.ph/feed', source: 'Manila Bulletin' },
];

const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const imageCache = new Map();

function getImageFromItem(item) {
  if (item.mediaContent?.['$']?.url) return item.mediaContent['$'].url;
  if (item.mediaThumbnail?.['$']?.url) return item.mediaThumbnail['$'].url;
  if (item.enclosure?.url) return item.enclosure.url;
  if (item['media:content']?.['$']?.url) return item['media:content']['$'].url;
  const html = item['content:encoded'] || item.content || item.summary || '';
  const imgMatch = html.match(/<img[^>]+src="([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i);
  if (imgMatch && imgMatch[1].startsWith('http')) return imgMatch[1];
  return '';
}

async function getOgImage(url) {
  if (!url) return '';
  if (imageCache.has(url)) return imageCache.get(url);
  try {
    const res = await fetch(url, {
      timeout: 5000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' }
    });
    const html = await res.text();
    const ogMatch = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)
                 || html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i);
    if (ogMatch && ogMatch[1].startsWith('http')) { imageCache.set(url, ogMatch[1]); return ogMatch[1]; }
    const twitterMatch = html.match(/<meta[^>]+name="twitter:image"[^>]+content="([^"]+)"/i);
    if (twitterMatch && twitterMatch[1].startsWith('http')) { imageCache.set(url, twitterMatch[1]); return twitterMatch[1]; }
  } catch (e) {}
  imageCache.set(url, '');
  return '';
}

async function fetchFeed(feedInfo) {
  try {
    const feed = await parser.parseURL(feedInfo.url);
    const now = Date.now();
    const articles = [];
    for (const item of feed.items || []) {
      if (!item.title || item.title === '[Removed]') continue;
      const pubDate = item.pubDate || item.isoDate;
      if (pubDate && now - new Date(pubDate).getTime() > MAX_AGE_MS) continue;
      const desc = (item['content:encoded'] || item.contentSnippet || item.summary || '')
        .replace(/<[^>]+>/g, '').trim().slice(0, 250);
      articles.push({
        title: item.title.trim(),
        description: desc,
        url: item.link || item.guid || '',
        urlToImage: getImageFromItem(item),
        publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        source: { name: feedInfo.source }
      });
    }
    return articles;
  } catch (err) {
    console.log(`Failed ${feedInfo.source}: ${err.message}`);
    return [];
  }
}

app.get('/news', async (req, res) => {
  try {
    const results = await Promise.allSettled(FEEDS.map(f => fetchFeed(f)));
    let all = [];
    results.forEach(r => { if (r.status === 'fulfilled') all = all.concat(r.value); });
    const seen = new Set();
    const unique = all.filter(a => {
      const key = a.title.slice(0, 60).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    unique.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    const sliced = unique.slice(0, 120);
    const noImage = sliced.filter(a => !a.urlToImage && a.url);
    await Promise.allSettled(noImage.slice(0, 30).map(async (a) => { a.urlToImage = await getOgImage(a.url); }));
    console.log(`Serving ${sliced.length} articles`);
    res.json({ articles: sliced });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', async (req, res) => {
  const results = await Promise.allSettled(FEEDS.map(f => fetchFeed(f)));
  const report = FEEDS.map((f, i) => ({
    source: f.source,
    count: results[i].status === 'fulfilled' ? results[i].value.length : 0,
    status: results[i].status === 'fulfilled' ? 'ok' : 'failed'
  }));
  res.json(report);
});

app.post('/summarize', async (req, res) => {
  const { title, description } = req.body;
  try {
    console.log('Summarize request for:', title);
    console.log('GROQ_API_KEY exists:', !!process.env.GROQ_API_KEY);

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama3-8b-8192',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `Ikaw ay isang Filipino Gen Z news explainer. 
Ipaliwanag ang balitang ito sa casual na Taglish para sa mga kabataang Pilipino.

Balita: "${title}"
${description ? `Detalye: ${description}` : ''}

Gawin mo ito sa 3 short paragraphs:
1. Ano ang nangyari? (explain simply)
2. Bakit ito mahalaga sa atin?
3. Ano ang mangyayari next?

Tapos mag-end ng isang "Vibe check:" line gamit ang Gen Z slang.
Walang bullet points, Taglish lang, relatable.`
        }]
      })
    });

    const data = await response.json();
    console.log('Groq status:', response.status);
    console.log('Groq response:', JSON.stringify(data));

    if (!data.choices || !data.choices[0]) {
      return res.status(500).json({ error: 'No choices in response', raw: data });
    }

    res.json({ summary: data.choices[0].message.content });
  } catch (err) {
    console.log('Summarize error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => console.log('Tsismis backend running'));
