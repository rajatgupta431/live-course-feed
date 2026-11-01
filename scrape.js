// Reads the "Popular courses" on the Masterscave store with a real (headless) browser and writes courses.json:
// [{title, text, image, url, price, mrp, badge, tags, coupon}]
// Usage: node scrape.js [storeUrl] > courses.json
const { chromium } = require('playwright');
const STORE = process.argv[2] || 'https://www.masterscave.in/courses';
const MAX = +(process.env.MAX_COURSES || 8);
const TAGS = /^(new|live class|free content|tests?|videos?|notes|recorded|bestseller|popular|trending)$/i;

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36' });
  const page = await ctx.newPage();
  await page.goto(STORE, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('text=/Get this course/i', { timeout: 30000 }).catch(() => {});
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 1500); await page.waitForTimeout(500); }

  // one entry per "Get this course" button; prefer the cards under the "Popular courses" heading
  const cards = await page.evaluate(({ tagsSrc }) => {
    const TAGS = new RegExp(tagsSrc, 'i');
    const btns = [...document.querySelectorAll('a,button,div,span')].filter(e =>
      /^\s*(get this course|buy now|enroll now|view course)\s*$/i.test(e.textContent) && !e.querySelector('a,button'));
    const popH = [...document.querySelectorAll('h1,h2,h3,h4,div,p,span')].find(e => /^\s*popular courses\s*$/i.test(e.textContent));
    const out = [], seen = new Set();
    btns.forEach((b, idx) => {
      let card = b;   // climb until the box also holds a picture
      while (card.parentElement && !(card.querySelector('img') || /url\(/.test(getComputedStyle(card).backgroundImage))) card = card.parentElement;
      if (seen.has(card)) return; seen.add(card);
      const img = card.querySelector('img');
      let image = img ? (img.currentSrc || img.src || img.getAttribute('data-src')) : '';
      if (!image) { const m = /url\("?(.*?)"?\)/.exec(getComputedStyle(card).backgroundImage); image = m ? m[1] : ''; }
      const lines = card.innerText.split('\n').map(s => s.trim()).filter(Boolean);
      const tags = [...new Set([...card.querySelectorAll('*')].filter(e => !e.children.length && TAGS.test(e.textContent.trim())).map(e => e.textContent.trim()))];
      const price = lines.find(l => /^₹\s?[\d,]+/.test(l)) || '';
      const prices = lines.filter(l => /^₹\s?[\d,]+$/.test(l));
      const coupon = lines.find(l => /coupon|discount|off\b/i.test(l)) || '';
      const title = lines.find(l => !TAGS.test(l) && !tags.some(t => l.startsWith(t)) && l !== price && l !== coupon && !/^₹/.test(l) && !/get this course|buy now|enroll/i.test(l) && l.length > 6) || (img && img.alt) || '';
      const a = b.closest('a') || card.querySelector('a[href]') || card.closest('a');
      out.push({ idx, title, image, href: a ? a.href : '', price, prices, tags, coupon,
        popular: !!(popH && (popH.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING)) });
    });
    return out;
  }, { tagsSrc: TAGS.source });

  let list = cards.some(c => c.popular) ? cards.filter(c => c.popular) : cards;
  list = list.slice(0, MAX);

  // open each course to get its real buy link, full name, description and full-size thumbnail
  for (const c of list) {
    try {
      let url = c.href;
      if (!url) {   // card is not a link: click its button and see where it goes
        await page.goto(STORE, { waitUntil: 'networkidle', timeout: 60000 });
        await page.waitForSelector('text=/Get this course/i', { timeout: 30000 });
        const btn = page.locator('text=/^\\s*(Get this course|Buy now|Enroll now|View course)\\s*$/i').nth(c.idx);
        const [popup] = await Promise.all([ctx.waitForEvent('page', { timeout: 5000 }).catch(() => null),
          btn.click().then(() => page.waitForURL(u => u.href !== STORE, { timeout: 10000 }).catch(() => {}))]);
        url = popup ? (await popup.waitForLoadState().then(() => popup.url())) : page.url();
        if (popup) await popup.close();
      }
      c.url = url && url !== STORE ? url : STORE;
      if (c.url !== STORE) {
        const p = await ctx.newPage();
        await p.goto(c.url, { waitUntil: 'networkidle', timeout: 60000 });
        const d = await p.evaluate(() => {
          const meta = n => (document.querySelector(`meta[property="${n}"],meta[name="${n}"]`) || {}).content || '';
          const h1 = document.querySelector('h1');
          return { title: meta('og:title') || (h1 && h1.innerText) || document.title, image: meta('og:image'), text: meta('og:description') || meta('description') };
        });
        await p.close();
        if (d.title && d.title.length > (c.title || '').replace(/\.\.\.|…$/, '').length && !/^masters? ?cave$/i.test(d.title.trim())) c.title = d.title.trim();
        if (!c.image && d.image) c.image = d.image;
        if (d.text) c.text = d.text.trim();
      }
    } catch (e) { c.url = c.url || STORE; }
  }
  await browser.close();

  const num = s => s ? +String(s).replace(/[^\d.]/g, '') : null;
  const out = list.filter(c => c.title).map(c => {
    const ps = (c.prices || []).map(num).filter(n => n !== null);
    const price = num(c.price), mrp = ps.length > 1 ? Math.max(...ps) : null;
    return { title: c.title.replace(/\s+/g, ' ').trim(), text: (c.text || c.coupon || '').slice(0, 160), image: c.image || '', url: c.url,
      price, mrp: mrp && mrp > price ? mrp : null, badge: c.tags.find(t => /new|popular|best|trend/i.test(t)) ? c.tags.find(t => /new|popular|best|trend/i.test(t)).toUpperCase() : '',
      tags: c.tags.filter(t => !/^new$/i.test(t)), coupon: c.coupon };
  });
  if (!out.length) { console.error('No courses found on ' + STORE); process.exit(1); }
  process.stdout.write(JSON.stringify({ updated: new Date().toISOString(), source: STORE, courses: out }, null, 1));
})();
