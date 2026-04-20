const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

// rss2json converts any RSS feed to clean JSON automatically — free, no key needed
const RSS2JSON = 'https://api.rss2json.com/v1/api.json?rss_url=';

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

const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

async function fetchFeed(feedInfo) {
  try {
    const res = await fetch(`${RSS2JSON}${encodeURIComponent(feedInfo.url)}&count=20`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const data = await res.json();

    if (data.status !== 'ok' || !data.items) return [];

    const now = Date.now();

    return data.items
      .filter(item => {
        if (!item.title || item.title === '[Removed]') return false;
        if (item.pubDate) {
          const age = now - new Date(item.pubDate).getTime();
          if (age > MAX_AGE_MS) return false;
        }
        return true;
      })
      .map(item => ({
        title: item.title,
        description: item.description
          ? item.description.replace(/<[^>]+>/g, '').slice(0, 250)
          : '',
        url: item.link || item.guid,
        urlToImage: item.thumbnail || item.enclosure?.link || '',
        publishedAt: item.pubDate
          ? new Date(item.pubDate).toISOString()
          : new Date().toISOString(),
        source: { name: feedInfo.source }
      }));
  } catch (err) {
    console.log(`Failed: ${feedInfo.source} — ${err.message}`);
    return [];
  }
}

app.get('/news', async (req, res) => {
  try {
    const results = await Promise.allSettled(FEEDS.map(f => fetchFeed(f)));

    let all = [];
    results.forEach(r => {
      if (r.status === 'fulfilled') all = all.concat(r.value);
    });

    // Deduplicate by title
    const seen = new Set();
    const unique = all.filter(a => {
      const key = a.title.slice(0, 60).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort newest first
    unique.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    console.log(`Fetched ${unique.length} articles from ${results.filter(r => r.status === 'fulfilled' && r.value.length > 0).length} sources`);

    res.json({ articles: unique.slice(0, 120) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check — visit /health in browser to see how many articles loaded
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
    res.json({ summary: data.choices[0].message.content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => console.log('Tsismis backend running'));
