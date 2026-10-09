// Renders the story cards the Mini App shares (webapp/img/story/<rank>.jpg),
// one per rank, from the cover, the logo and the rank insignia.
//
//   node tools/story_cards.mjs [path/to/playwright/index.mjs] [chromium] [fonts dir]
//
// Playwright is not a dependency of the bot; point at any installed copy.
// The fonts dir may hold roboto-{cyrillic,latin}-{400,700,900}-normal.woff2
// (from @fontsource/roboto); without it the system sans-serif is used.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '../webapp');
const [pwPath = 'playwright', chromium = undefined, fonts = null] = process.argv.slice(2);
const { chromium: browserType } = await import(pwPath.startsWith('/') ? pathToFileURL(pwPath).href : pwPath);

const RANKS = [
  ['I', 'Искра'], ['II', 'Звено'], ['III', 'Клинок'], ['IV', 'Страж Круга'], ['V', 'Вестник Свободы'],
  ['VI', 'Командор Алой Звезды'], ['VII', 'Маршал Свободы'], ['VIII', 'Архонт Круга'],
  ['IX', 'Верховный Архонт'], ['X', 'Основатель SQUAD'],
];

const url = (p) => pathToFileURL(path.join(web, p)).href;
let faces = '';
if (fonts) {
  for (const w of [400, 700, 900]) {
    for (const set of ['latin', 'cyrillic']) {
      const f = path.join(fonts, `roboto-${set}-${w}-normal.woff2`);
      if (fs.existsSync(f)) faces += `@font-face{font-family:R;font-weight:${w};src:url(${pathToFileURL(f).href})}`;
    }
  }
}

function page(roman, name) {
  return `<!doctype html><meta charset="utf-8"><style>${faces}
  *{margin:0;box-sizing:border-box}
  body{width:1080px;height:1920px;overflow:hidden;background:#070203;font-family:R,Roboto,Arial,sans-serif;color:#f8e9ea;position:relative}
  .bg{position:absolute;inset:-40px;background:url(${url('img/squad-cover.jpg')}) 50% 50%/auto 110% no-repeat;filter:blur(14px) brightness(.45) saturate(1.2)}
  .shade{position:absolute;inset:0;background:radial-gradient(70% 45% at 50% 47%,rgba(255,30,60,.42),transparent 70%),linear-gradient(180deg,rgba(7,2,3,.2),rgba(7,2,3,.1) 40%,rgba(7,2,3,.92) 85%)}
  .top{position:absolute;top:150px;left:0;right:0;display:flex;flex-direction:column;align-items:center;gap:22px}
  .logo{width:170px;height:170px;border-radius:50%;border:5px solid #ff2d48;box-shadow:0 0 60px rgba(255,30,60,.8)}
  .squad{font-size:64px;font-weight:900;letter-spacing:6px}.squad b{color:#ff2d48;text-shadow:0 0 40px rgba(255,30,60,.9)}
  .ins{position:absolute;left:50%;top:520px;height:820px;transform:translateX(-50%);filter:drop-shadow(0 0 70px rgba(255,30,60,.75)) drop-shadow(0 30px 40px rgba(0,0,0,.8))}
  .bottom{position:absolute;bottom:200px;left:60px;right:60px;text-align:center}
  .kick{font-size:40px;font-weight:700;letter-spacing:10px;color:#ff6b7d;text-transform:uppercase}
  .roman{font-size:150px;line-height:160px;font-weight:900;color:#ff2d48;text-shadow:0 0 60px rgba(255,30,60,.9);margin-top:10px}
  .name{font-size:76px;line-height:88px;font-weight:700;margin-top:6px}
  .foot{position:absolute;bottom:90px;left:0;right:0;text-align:center;font-size:34px;letter-spacing:4px;color:rgba(248,233,234,.6)}
  </style><div class="bg"></div><div class="shade"></div>
  <div class="top"><img class="logo" src="${url('img/squad-logo.jpg')}"><div class="squad">T.N.K.C <b>SQUAD</b></div></div>
  <img class="ins" src="${url(`img/ranks/${roman}.webp`)}">
  <div class="bottom"><div class="kick">Моё звание</div><div class="roman">${roman}</div><div class="name">${name}</div></div>
  <div class="foot">@THKC_SQUAD · ПРОФИЛЬ ФИНИ</div>`;
}

const browser = await browserType.launch(chromium ? { executablePath: chromium } : {});
const tab = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
const tmp = path.join(web, 'img/story/.card.html');
for (const [roman, name] of RANKS) {
  fs.writeFileSync(tmp, page(roman, name));
  await tab.goto(pathToFileURL(tmp).href);
  await tab.waitForLoadState('networkidle');
  await tab.screenshot({ path: path.join(web, `img/story/${roman}.jpg`), type: 'jpeg', quality: 80 });
}
fs.unlinkSync(tmp);
await browser.close();
