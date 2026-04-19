const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

// ── NEWS from Philippine RSS feeds (completely free)
app.get('/news', async (req, res) => {
  const feeds = [
    'https://www.rappler.com/feed/',
    'https://newsinfo.inquirer.net/feed',
    'https://www.philstar.com/rss/headlines',
    'https://news.abs-cbn.com/rss/news'
  ];

  try {
    for (const feedUrl of feeds) {
      try {
        const response = await fetch(feedUrl);
        const xml = await response.text();

        const articles = [];
        const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];

        items.slice(0, 30).forEach(item => {
          const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
                         item.match(/<title>(.*?)<\/title>/))?.[1] || '';
          const desc  = (item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
                         item.match(/<description>(.*?)<\/description>/))?.[1] || '';
          const link  = item.match(/<link>(.*?)<\/link>/)?.[1] ||
                        item.match(/<link\s[^>]*href="([^"]+)"/)?.[1] || '';
          const pub   = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
          const img   = item.match(/<media:content[^>]*url="([^"]+)"/)?.[1] ||
                        item.match(/<enclosure[^>]*url="([^"]+)"/)?.[1] || '';
          const src   = feedUrl.includes('rappler') ? 'Rappler'
                      : feedUrl.includes('inquirer') ? 'Inquirer'
                      : feedUrl.includes('philstar') ? 'PhilStar'
                      : 'ABS-CBN';

          if (title) articles.push({
            title,
            description: desc.replace(/<[^>]+>/g,'').slice(0,200),
            url: link,
            urlToImage: img,
            publishedAt: pub,
            source: { name: src }
          });
        });

        if (articles.length > 0) return res.json({ articles });
      } catch (e) { continue; }
    }

    res.json({ articles: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── AI SUMMARY using Groq (free forever)
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