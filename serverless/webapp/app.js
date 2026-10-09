// Mini App "Профиль Фини": dark blood-red theme, Material 3 shapes and motion.
// Data comes from tgcloud/endpoints/profile.js.
// Every user-supplied string is inserted with textContent, never as HTML.
// Icons: Material Symbols Rounded (Apache License 2.0), inlined as SVG paths.
(function () {
  'use strict';

  var ICONS = {
    monitoring: 'M128.5-128.63Q120-137.25 120-150v-46q0-12.75 8.68-21.38 8.67-8.62 21.5-8.62 12.82 0 21.32 8.62 8.5 8.63 8.5 21.38v46q0 12.75-8.68 21.37-8.67 8.63-21.5 8.63-12.82 0-21.32-8.63Zm165 0Q285-137.25 285-150v-206q0-12.75 8.68-21.38 8.67-8.62 21.5-8.62 12.82 0 21.32 8.62 8.5 8.63 8.5 21.38v206q0 12.75-8.68 21.37-8.67 8.63-21.5 8.63-12.82 0-21.32-8.63Zm165 0Q450-137.25 450-150v-146q0-12.75 8.68-21.38 8.67-8.62 21.5-8.62 12.82 0 21.32 8.62 8.5 8.63 8.5 21.38v146q0 12.75-8.68 21.37-8.67 8.63-21.5 8.63-12.82 0-21.32-8.63Zm165 0Q615-137.25 615-150v-246q0-12.75 8.68-21.38 8.67-8.62 21.5-8.62 12.82 0 21.32 8.62 8.5 8.63 8.5 21.38v246q0 12.75-8.68 21.37-8.67 8.63-21.5 8.63-12.82 0-21.32-8.63Zm165 0Q780-137.25 780-150v-366q0-12.75 8.68-21.38 8.67-8.62 21.5-8.62 12.82 0 21.32 8.62 8.5 8.63 8.5 21.38v366q0 12.75-8.68 21.37-8.67 8.63-21.5 8.63-12.82 0-21.32-8.63ZM559.5-499q-11.5 0-22.46-4.7-10.97-4.69-20.04-13.3L400-634 172-407q-9.07 9-21.53 8.5-12.47-.5-21.34-9.5-8.13-9-8.63-21t8.5-21l229-227q9.07-8.87 20.04-12.93Q389-694 400-694t22.34 4.07Q433.68-685.87 442-677l118 118 229-229q9-9 21-9t20.87 9q8.13 9 8.63 21t-8.5 21L602-517q-8 9-19.5 13.5t-23 4.5Z',
    monitoring_fill: 'M128.5-128.63Q120-137.25 120-150v-46q0-12.75 8.68-21.38 8.67-8.62 21.5-8.62 12.82 0 21.32 8.62 8.5 8.63 8.5 21.38v46q0 12.75-8.68 21.37-8.67 8.63-21.5 8.63-12.82 0-21.32-8.63Zm165 0Q285-137.25 285-150v-206q0-12.75 8.68-21.38 8.67-8.62 21.5-8.62 12.82 0 21.32 8.62 8.5 8.63 8.5 21.38v206q0 12.75-8.68 21.37-8.67 8.63-21.5 8.63-12.82 0-21.32-8.63Zm165 0Q450-137.25 450-150v-146q0-12.75 8.68-21.38 8.67-8.62 21.5-8.62 12.82 0 21.32 8.62 8.5 8.63 8.5 21.38v146q0 12.75-8.68 21.37-8.67 8.63-21.5 8.63-12.82 0-21.32-8.63Zm165 0Q615-137.25 615-150v-246q0-12.75 8.68-21.38 8.67-8.62 21.5-8.62 12.82 0 21.32 8.62 8.5 8.63 8.5 21.38v246q0 12.75-8.68 21.37-8.67 8.63-21.5 8.63-12.82 0-21.32-8.63Zm165 0Q780-137.25 780-150v-366q0-12.75 8.68-21.38 8.67-8.62 21.5-8.62 12.82 0 21.32 8.62 8.5 8.63 8.5 21.38v366q0 12.75-8.68 21.37-8.67 8.63-21.5 8.63-12.82 0-21.32-8.63ZM559.5-499q-11.5 0-22.46-4.7-10.97-4.69-20.04-13.3L400-634 172-407q-9.07 9-21.53 8.5-12.47-.5-21.34-9.5-8.13-9-8.63-21t8.5-21l229-227q9.07-8.87 20.04-12.93Q389-694 400-694t22.34 4.07Q433.68-685.87 442-677l118 118 229-229q9-9 21-9t20.87 9q8.13 9 8.63 21t-8.5 21L602-517q-8 9-19.5 13.5t-23 4.5Z',
    leaderboard: 'M140-180h187v-360H140v360Zm247 0h186v-600H387v600Zm246 0h187v-280H633v280Zm-553 0v-360q0-24.75 17.63-42.38Q115.25-600 140-600h187v-180q0-24.75 17.63-42.38Q362.25-840 387-840h186q24.75 0 42.38 17.62Q633-804.75 633-780v260h187q24.75 0 42.38 17.62Q880-484.75 880-460v280q0 24.75-17.62 42.37Q844.75-120 820-120H140q-24.75 0-42.37-17.63Q80-155.25 80-180Z',
    leaderboard_fill: 'M110-120q-12.75 0-21.37-8.63Q80-137.25 80-150v-420q0-12.75 8.63-21.38Q97.25-600 110-600h150q12.75 0 21.38 8.62Q290-582.75 290-570v420q0 12.75-8.62 21.37Q272.75-120 260-120H110Zm295 0q-12.75 0-21.37-8.63Q375-137.25 375-150v-660q0-12.75 8.63-21.38Q392.25-840 405-840h150q12.75 0 21.38 8.62Q585-822.75 585-810v660q0 12.75-8.62 21.37Q567.75-120 555-120H405Zm295 0q-12.75 0-21.37-8.63Q670-137.25 670-150v-340q0-12.75 8.63-21.38Q687.25-520 700-520h150q12.75 0 21.38 8.62Q880-502.75 880-490v340q0 12.75-8.62 21.37Q862.75-120 850-120H700Z',
    military_tech: 'm480-161-73 54q-9 7-17.5.5T384-124l28-90-73-54q-9-7-5.25-17T348-295h90l25-97-140-82q-20.37-11.7-31.68-30.85Q280-524 280-547v-273q0-24.75 17.63-42.38Q315.25-880 340-880h280q24.75 0 42.38 17.62Q680-844.75 680-820v273q0 23-11.32 42.15Q657.37-485.7 637-474l-141 82 26 97h89q10.5 0 14.25 10T620-268l-73 54 28 90q3 11-5.5 17t-17.5-1l-72-53ZM340-820v273q0 7 4.5 13t13.5 11l96 53v-350H340Zm280 0H514v350l88-53q9-5 13.5-11t4.5-13v-273ZM484-637Zm-30-8Zm60 0Z',
    military_tech_fill: 'm480-161-73 54q-9 7-17.5.5T384-124l28-90-73-54q-9-7-5.5-17t14.5-10h90l25-97-140-82q-20-12-31.5-31T280-547v-273q0-25 17.5-42.5T340-880h280q25 0 42.5 17.5T680-820v273q0 23-11.5 42T637-474l-141 82 26 97h89q11 0 14.5 10t-5.5 17l-73 54 28 90q3 11-5.5 17t-17.5-1l-72-53Zm-26-659v350l30 16 30-16v-350h-60Z',
    chat_bubble_fill: 'M240-240 131-131q-14 14-32.5 6.5T80-152v-668q0-24 18-42t42-18h680q24 0 42 18t18 42v520q0 24-18 42t-42 18H240Z',
    favorite_fill: 'M458-144q-11-4-19-12l-53-49Q262-320 171-424.5T80-643q0-90 60.5-150.5T290-854q51 0 101 24.5t89 80.5q44-56 91-80.5t99-24.5q89 0 149.5 60.5T880-643q0 114-91 218.5T574-205l-53 49q-8 8-19 12t-22 4q-11 0-22-4Z',
    shield_person_fill: 'M577-490.17q40-40.17 40-97T576.83-684q-40.17-40-97-40T383-683.83q-40 40.17-40 97T383.17-490q40.17 40 97 40T577-490.17ZM480-143q60-20 108-59.5t83-90.5q-44.67-21.02-92.97-32.01Q529.72-336 479.86-336t-98.07 10.99Q333.58-314.02 289-293q35 51 83 90.5T480-143Zm-9.88 58q-4.56-1-9.12-3-139-47-220-168.5t-81-266.61V-719q0-19.26 10.88-34.66Q181.75-769.07 199-776l260-97q11-4 21-4t21 4l260 97q17.25 6.93 28.13 22.34Q800-738.26 800-719v195.89Q800-378 719-256.5T499-88q-4.56 2-9.12 3T480-84q-5.32 0-9.88-1Z',
    local_fire_department_fill: 'M160-400q0-116 71.5-225T428-811q17-11 34.5-.5T480-780v72q0 34 23.5 57t57.5 23q18 0 33.5-7.5T622-658q8-9 18-12.5t19 2.5q66 45 103.5 116T800-400q0 95-49 171.5T622-113q23-26 35.5-58t12.5-67q0-38-14-71.5T615-370L480-502 346-370q-28 27-42 60.5T290-238q0 35 12.5 67t35.5 58q-80-39-129-115.5T160-400Zm320-18 92 90q18 18 28 41t10 49q0 53-38 90.5T480-110q-54 0-92-37.5T350-238q0-26 9.5-49t28.5-41l92-90Z',
    calendar_month_fill: 'M180-80q-24 0-42-18t-18-42v-620q0-24 18-42t42-18h65v-28q0-13.6 9-22.8 9-9.2 23.02-9.2t23.5 9.2Q310-861.6 310-848v28h340v-28q0-13.6 9-22.8 9-9.2 23.02-9.2t23.5 9.2Q715-861.6 715-848v28h65q24 0 42 18t18 42v620q0 24-18 42t-42 18H180Zm0-60h600v-430H180v430Zm300-260q-17 0-28.5-11.5T440-440q0-17 11.5-28.5T480-480q17 0 28.5 11.5T520-440q0 17-11.5 28.5T480-400Zm-188.5-11.5Q280-423 280-440t11.5-28.5Q303-480 320-480t28.5 11.5Q360-457 360-440t-11.5 28.5Q337-400 320-400t-28.5-11.5ZM640-400q-17 0-28.5-11.5T600-440q0-17 11.5-28.5T640-480q17 0 28.5 11.5T680-440q0 17-11.5 28.5T640-400ZM480-240q-17 0-28.5-11.5T440-280q0-17 11.5-28.5T480-320q17 0 28.5 11.5T520-280q0 17-11.5 28.5T480-240Zm-188.5-11.5Q280-263 280-280t11.5-28.5Q303-320 320-320t28.5 11.5Q360-297 360-280t-11.5 28.5Q337-240 320-240t-28.5-11.5ZM640-240q-17 0-28.5-11.5T600-280q0-17 11.5-28.5T640-320q17 0 28.5 11.5T680-280q0 17-11.5 28.5T640-240Z',
    trophy_fill: 'M284-526v-166H180v44q0 45 29.5 78.5T284-526Zm392 0q45-10 74.5-43.5T780-648v-44H676v166ZM450-180v-148q-54-11-96-46.5T296-463q-74-8-125-60t-51-125v-44q0-24.75 17.63-42.38Q155.25-752 180-752h104v-28q0-24.75 17.63-42.38Q319.25-840 344-840h272q24.75 0 42.38 17.62Q676-804.75 676-780v28h104q24.75 0 42.38 17.62Q840-716.75 840-692v44q0 73-51 125t-125 60q-16 53-58 88.5T510-328v148h122q12.75 0 21.38 8.68 8.62 8.67 8.62 21.5 0 12.82-8.62 21.32-8.63 8.5-21.38 8.5H328q-12.75 0-21.37-8.68-8.63-8.67-8.63-21.5 0-12.82 8.63-21.32 8.62-8.5 21.37-8.5h122Z',
    check: 'm378-332 363-363q9-9 21.5-9t21.5 9q9 9 9 21.5t-9 21.5L399-267q-9 9-21 9t-21-9L175-449q-9-9-8.5-21.5T176-492q9-9 21.5-9t21.5 9l159 160Z',
    check_circle_fill: 'm421-389-98-98q-9-9-22-9t-23 10q-9 9-9 22t9 22l122 123q9 9 21 9t21-9l239-239q10-10 10-23t-10-23q-10-9-23.5-8.5T635-603L421-389Zm59 309q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-156t86-127Q252-817 325-848.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 82-31.5 155T763-197.5q-54 54.5-127 86T480-80Z',
    refresh: 'M480-160q-133 0-226.5-93.5T160-480q0-133 93.5-226.5T480-800q85 0 149 34.5T740-671v-99q0-13 8.5-21.5T770-800q13 0 21.5 8.5T800-770v194q0 13-8.5 21.5T770-546H576q-13 0-21.5-8.5T546-576q0-13 8.5-21.5T576-606h138q-38-60-97-97t-137-37q-109 0-184.5 75.5T220-480q0 109 75.5 184.5T480-220q75 0 140-39.5T717-366q5-11 16.5-16.5t22.5-.5q12 5 16 16.5t-1 23.5q-39 84-117.5 133.5T480-160Z',
    history: 'M477-120q-142 0-243.5-95.5T121-451q-1-12 7.5-21t21.5-9q12 0 20.5 8.5T181-451q11 115 95 193t201 78q127 0 215-89t88-216q0-124-89-209.5T477-780q-68 0-127.5 31T246-667h75q13 0 21.5 8.5T351-637q0 13-8.5 21.5T321-607H172q-13 0-21.5-8.5T142-637v-148q0-13 8.5-21.5T172-815q13 0 21.5 8.5T202-785v76q52-61 123.5-96T477-840q75 0 141 28t115.5 76.5Q783-687 811.5-622T840-482q0 75-28.5 141t-78 115Q684-177 618-148.5T477-120Zm34-374 115 113q9 9 9 21.5t-9 21.5q-9 9-21 9t-21-9L460-460q-5-5-7-10.5t-2-11.5v-171q0-13 8.5-21.5T481-683q13 0 21.5 8.5T511-653v159Z',
  };

  var tg = window.Telegram && window.Telegram.WebApp;
  var app = document.getElementById('app');
  var SVG = 'http://www.w3.org/2000/svg';
  var MSK = 3 * 3600;
  var WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  var HISTORY = {
    comment: ['chat_bubble_fill', 'Комментарий', 'primary'],
    reaction: ['favorite_fill', 'Реакция', ''],
    owner_xp: ['shield_person_fill', 'Изменение XP владельцем', 'muted'],
    owner_rank: ['shield_person_fill', 'Звание от владельца', 'muted'],
  };
  var TABS = [
    ['activity', 'Активность', 'monitoring'],
    ['top', 'Топ', 'leaderboard'],
    ['ranks', 'Звания', 'military_tech'],
  ];
  // Telegram's header and bottom bar blend into the page (see style.css).
  var BG = '#070203';
  var BAR = '#090203';
  // Material 3 fade through: the old content fades out for 90 ms.
  var FADE_OUT_MS = 90;
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var state = { data: null, tab: 'activity', top: 'all' };
  var view = null;
  var nav = null;
  var dests = [];

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      (Array.isArray(c) ? c : [c]).forEach(function (x) {
        if (x == null || x === false) return;
        el.appendChild(typeof x === 'string' || typeof x === 'number' ? document.createTextNode(String(x)) : x);
      });
    }
    return el;
  }

  function icon(name, cls) {
    var svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 -960 960 960');
    svg.setAttribute('class', cls || 'icon');
    svg.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', ICONS[name]);
    svg.appendChild(path);
    return svg;
  }

  function loader() {
    var svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 48 48');
    svg.setAttribute('class', 'cpi');
    svg.setAttribute('aria-hidden', 'true');
    var c = document.createElementNS(SVG, 'circle');
    c.setAttribute('cx', '24');
    c.setAttribute('cy', '24');
    c.setAttribute('r', '20');
    svg.appendChild(c);
    return svg;
  }

  function haptic() {
    try { tg.HapticFeedback.selectionChanged(); } catch (e) { /* not supported */ }
  }

  function paintTelegram() {
    if (!tg) return;
    try { tg.setHeaderColor(BG); } catch (e) { /* old client */ }
    try { tg.setBackgroundColor(BG); } catch (e) { /* old client */ }
    try { tg.setBottomBarColor(BAR); } catch (e) { /* old client */ }
  }

  // ---- motion ---------------------------------------------------------------

  // Staggered entrance (emphasized decelerate), see .enter in style.css.
  function enter(el, i) {
    el.classList.add('enter');
    el.style.setProperty('--i', String(i));
    return el;
  }

  // Fade through: fade the old content out, swap it, fade the new one in.
  function swap(el, build) {
    clearTimeout(el.swapTimer);
    el.classList.remove('fade-in');
    el.classList.add('fade-out');
    el.swapTimer = setTimeout(function () {
      el.replaceChildren.apply(el, [].concat(build()).filter(Boolean));
      el.classList.remove('fade-out');
      void el.offsetWidth;
      el.classList.add('fade-in');
    }, reduceMotion ? 0 : FADE_OUT_MS);
  }

  // Counts a number up from zero; ease-out close to emphasized decelerate.
  function countUp(node, to) {
    if (reduceMotion || to <= 0) return;
    var start = null;
    node.nodeValue = '0';
    function step(ts) {
      if (start == null) start = ts;
      var t = Math.min(1, (ts - start) / 900);
      node.nodeValue = String(Math.round(to * (1 - Math.pow(1 - t, 4))));
      if (t < 1) requestAnimationFrame(step);
    }
    setTimeout(function () { requestAnimationFrame(step); }, 120);
  }

  // Material 3 ripple: a wave grows from the touch point and fades on release.
  function ripple(e) {
    if (e.button > 0 || !e.target.closest) return;
    var host = e.target.closest('.ripple, .dest');
    if (!host) return;
    var centered = host.classList.contains('dest');
    if (centered) host = host.querySelector('.pill');
    var r = host.getBoundingClientRect();
    var x = centered ? r.width / 2 : e.clientX - r.left;
    var y = centered ? r.height / 2 : e.clientY - r.top;
    var size = 2 * Math.sqrt(Math.pow(Math.max(x, r.width - x), 2) + Math.pow(Math.max(y, r.height - y), 2));
    var wave = h('span', { class: 'wave', 'aria-hidden': 'true' });
    wave.style.width = wave.style.height = size + 'px';
    wave.style.left = (x - size / 2) + 'px';
    wave.style.top = (y - size / 2) + 'px';
    host.appendChild(wave);
    function release() {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      wave.classList.add('release');
      setTimeout(function () { wave.remove(); }, 400);
    }
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
  }

  // ---- helpers --------------------------------------------------------------

  function msk(ts) {
    return new Date((ts + MSK) * 1000);
  }

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function when(ts) {
    var d = msk(ts);
    var today = Math.floor((state.data.now + MSK) / 86400);
    var day = Math.floor((ts + MSK) / 86400);
    var time = pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
    if (day === today) return 'Сегодня, ' + time;
    if (day === today - 1) return 'Вчера, ' + time;
    return pad(d.getUTCDate()) + '.' + pad(d.getUTCMonth() + 1) + ', ' + time;
  }

  function signed(n) {
    return (n > 0 ? '+' : '') + n;
  }

  function dropNav() {
    if (nav) { nav.remove(); nav = null; }
    dests = [];
    view = null;
  }

  function showState(title, text, retry) {
    dropNav();
    app.replaceChildren(h('div', { class: 'state enter' },
      h('h2', { text: title }),
      text ? h('p', { text: text }) : null,
      retry ? h('button', { class: 'btn-filled ripple', onclick: load }, icon('refresh'), 'Повторить') : null));
  }

  // ---- header ---------------------------------------------------------------

  function avatar(me) {
    var user = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
    var box = h('div', { class: 'avatar', 'aria-hidden': 'true' }, Array.from(me.name || '?')[0].toUpperCase());
    if (user && user.photo_url) {
      var img = h('img', { alt: '', src: user.photo_url });
      img.addEventListener('load', function () { box.replaceChildren(img); });
    }
    return box;
  }

  function hero(me) {
    var progress = null;
    if (me.progress) {
      var ind = h('i', { class: 'ind' });
      progress = h('div', { class: 'progress' },
        h('div', { class: 'lp', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100',
          'aria-valuenow': String(me.progress.percent) }, ind, h('i', { class: 'trk' })),
        h('div', { class: 'progress-label' },
          h('span', { text: 'До «' + me.progress.next.name + '»' }),
          h('span', null, 'осталось ', h('b', { text: me.progress.left + ' XP' }))));
      setTimeout(function () {
        ind.style.width = 'calc(' + Math.max(1, Math.min(100, me.progress.percent)) + '% - 6px)';
      }, reduceMotion ? 0 : 200);
    }
    var note = null;
    if (me.founder) note = 'Основатель Сквада.';
    else if (me.manualRank) note = 'Звание назначено владельцем. XP продолжает копиться.';
    else if (!me.progress) note = 'Высшее звание достигнуто.';
    var total = h('p', { class: 'xp-total' }, String(me.xp), h('small', { text: 'XP' }));
    countUp(total.firstChild, me.xp);
    return h('section', { class: 'hero' },
      icon('military_tech_fill', 'deco'),
      h('div', { class: 'who' }, avatar(me),
        h('div', { class: 'who-text' },
          h('p', { class: 'name', text: me.name }),
          h('span', { class: 'rank-chip' }, icon('military_tech_fill'), me.rank.roman + ' · ' + me.rank.name))),
      total,
      progress,
      note ? h('div', { class: 'note', text: note }) : null);
  }

  function stats(me) {
    return h('div', { class: 'stats' },
      h('div', { class: 'stat' }, icon('local_fire_department_fill'),
        h('b', { text: me.today + '/' + me.dailyLimit }), h('span', { text: 'XP сегодня' })),
      h('div', { class: 'stat' }, icon('calendar_month_fill'),
        h('b', { text: signed(me.week) }), h('span', { text: 'XP за неделю' })),
      h('div', { class: 'stat' }, icon('trophy_fill'),
        h('b', { text: me.place ? '#' + me.place : '—' }),
        h('span', { text: me.place ? 'место из ' + me.participants : 'пока не в топе' })));
  }

  // ---- tabs -----------------------------------------------------------------

  function chart(days) {
    var max = days.reduce(function (m, d) { return Math.max(m, d.xp); }, 0) || 1;
    var today = days.length - 1;
    return h('section', { class: 'card' }, h('h3', { text: 'XP за 7 дней' }),
      h('div', { class: 'chart' }, days.map(function (d, i) {
        var bar = h('i');
        bar.style.height = Math.round((d.xp / max) * 92) + 'px';
        bar.style.setProperty('--i', String(i));
        return h('div', { class: 'col' + (d.xp ? ' has' : '') + (i === today ? ' today' : '') },
          h('em', { text: d.xp ? String(d.xp) : '' }), bar,
          h('span', { text: i === today ? 'Сег' : WEEKDAYS[msk(d.day).getUTCDay()] }));
      })));
  }

  function withDividers(items) {
    var out = [];
    items.forEach(function (it, i) {
      if (i) out.push(h('li', { class: 'divider', 'aria-hidden': 'true' }));
      out.push(it);
    });
    return out;
  }

  function historyCard(items) {
    var body;
    if (!items.length) {
      body = h('p', { class: 'empty', text: 'Пока пусто. Оставь комментарий под постом Сквада.' });
    } else {
      body = h('ul', { class: 'list' }, withDividers(items.map(function (it) {
        var meta = HISTORY[it.kind] || ['history', it.kind, 'muted'];
        var title = meta[1];
        if (it.kind === 'owner_rank') title = it.rank ? 'Звание ' + it.rank + ' от владельца' : 'Звание снова по XP';
        return h('li', { class: 'item' },
          h('div', { class: 'lead ' + meta[2] }, icon(meta[0])),
          h('div', { class: 'body' }, h('b', { text: title }), h('span', { text: when(it.at) })),
          it.points ? h('div', { class: 'trail' + (it.points < 0 ? ' neg' : ''), text: signed(it.points) + ' XP' }) : null);
      })));
    }
    return h('section', { class: 'card' }, h('h3', { text: 'История' }), body);
  }

  function topList(top) {
    var rows = state.top === 'week' ? top.week : top.all;
    var body = rows.length ? h('ul', { class: 'list' }, withDividers(rows.map(function (r) {
      return h('li', { class: 'item' + (r.me ? ' me' : '') },
        h('div', { class: 'lead place' + (r.place <= 3 ? ' p' + r.place : ''), text: String(r.place) }),
        h('div', { class: 'body' }, h('b', { text: r.name + (r.me ? ' · ты' : '') }), h('span', { text: r.rank.roman + ' · ' + r.rank.name })),
        h('div', { class: 'trail', text: r.score + ' XP' }));
    }))) : h('p', { class: 'empty', text: state.top === 'week' ? 'На этой неделе ещё никто не заработал XP.' : 'Пока никто не заработал XP.' });
    var note = state.top === 'week' ? h('p', { class: 'foot', text: 'Неделя начинается в понедельник по Москве.' }) : null;
    return [body, note];
  }

  function topCard(top) {
    var box = h('div', { class: 'swap' }, topList(top));
    var buttons = [];
    var seg = h('div', { class: 'seg', role: 'tablist' }, [['all', 'Всё время'], ['week', 'Неделя']].map(function (t) {
      var b = h('button', {
        class: 'ripple', role: 'tab', 'aria-selected': String(state.top === t[0]),
        onclick: function () {
          if (state.top === t[0]) return;
          state.top = t[0];
          haptic();
          buttons.forEach(function (x) { x.setAttribute('aria-selected', String(x === b)); });
          swap(box, function () { return topList(top); });
        },
      }, h('span', { class: 'check' }, icon('check')), t[1]);
      buttons.push(b);
      return b;
    }));
    return h('section', { class: 'card' }, h('h3', { text: 'Топ Сквада' }), seg, box);
  }

  function rankItem(roman, name, sub, reached) {
    return h('li', { class: 'item' + (reached ? '' : ' locked') },
      h('div', { class: 'lead ' + (reached ? 'primary' : 'muted'), text: roman }),
      h('div', { class: 'body' }, h('b', { text: name }), h('span', { text: sub })),
      reached ? h('div', { class: 'trail' }, icon('check_circle_fill')) : null);
  }

  function ranksCards(ranks, rules, me) {
    var items = ranks.map(function (r) { return rankItem(r.roman, r.name, 'от ' + r.from + ' XP', r.reached); });
    items.push(rankItem('X', 'Основатель SQUAD', 'только владелец', me.founder));
    var how = h('ul', { class: 'rules' },
      h('li', null, icon('chat_bubble_fill'), h('span', { text: '+' + rules.comment + ' XP за комментарий под постом: от 5 букв, не чаще раза в минуту.' })),
      h('li', null, icon('favorite_fill'), h('span', { text: '+' + rules.reaction + ' XP за реакцию в обсуждениях, до ' + rules.dailyReactions + ' в день.' })),
      h('li', null, icon('local_fire_department_fill'), h('span', { text: 'Не больше ' + me.dailyLimit + ' XP в день по Москве.' })));
    return [h('section', { class: 'card' }, h('h3', { text: 'Звания' }), h('ul', { class: 'list' }, withDividers(items))),
      h('section', { class: 'card' }, h('h3', { text: 'Как получить XP' }), how)];
  }

  function viewBody() {
    var d = state.data;
    if (state.tab === 'top') return [topCard(d.top)];
    if (state.tab === 'ranks') return ranksCards(d.ranks, d.rules, d.me);
    return [chart(d.chart), historyCard(d.history)];
  }

  // ---- navigation bar -------------------------------------------------------

  // Built once, so the active indicator animates between destinations.
  function navbar() {
    dests = TABS.map(function (t) {
      var pill = h('span', { class: 'pill' }, icon(state.tab === t[0] ? t[2] + '_fill' : t[2]));
      var btn = h('button', {
        class: 'dest', role: 'tab', 'aria-selected': String(state.tab === t[0]),
        onclick: function () { selectTab(t[0]); },
      }, pill, t[1]);
      return { tab: t, btn: btn, pill: pill };
    });
    return h('nav', { class: 'navbar', role: 'tablist' },
      h('div', { class: 'navbar-inner' }, dests.map(function (d) { return d.btn; })));
  }

  function selectTab(tab) {
    if (state.tab === tab) return;
    state.tab = tab;
    haptic();
    dests.forEach(function (d) {
      var on = d.tab[0] === tab;
      d.btn.setAttribute('aria-selected', String(on));
      d.pill.replaceChild(icon(on ? d.tab[2] + '_fill' : d.tab[2]), d.pill.querySelector('svg'));
    });
    swap(view, viewBody);
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  function render() {
    var d = state.data;
    var cards = viewBody();
    cards.forEach(function (c, i) { enter(c, 2 + i); });
    view = h('div', { class: 'view' }, cards);
    app.replaceChildren(enter(hero(d.me), 0), enter(stats(d.me), 1), view,
      enter(h('p', { class: 'foot', text: 'FINYA HELPER · T.N.K.C SQUAD' }), 2 + cards.length));
    if (nav) nav.remove();
    nav = navbar();
    document.body.appendChild(nav);
  }

  // ---- data -----------------------------------------------------------------

  function load() {
    if (!tg || !tg.initData || !tg.Serverless) {
      showState('Открой профиль в Telegram', 'Нажми «Профиль» в чате с Финей.', false);
      return;
    }
    dropNav();
    app.replaceChildren(h('div', { class: 'state' }, loader(), h('p', { text: 'Загружаю профиль…' })));
    tg.Serverless.call('profile', {}, function (err, data) {
      if (err || !data) {
        showState('Не удалось загрузить профиль',
          err && err.type === 'ENDPOINT_ERROR' ? err.message : 'Проверь интернет и попробуй ещё раз.', true);
        return;
      }
      state.data = data;
      render();
    });
  }

  document.addEventListener('pointerdown', ripple);
  paintTelegram();
  if (tg) {
    try { tg.ready(); tg.expand(); } catch (e) { /* old client */ }
  }
  load();
})();
