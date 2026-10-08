// Mini App "Профиль Фини". Data comes from tgcloud/endpoints/profile.js.
// Every user-supplied string is inserted with textContent, never as HTML.
(function () {
  'use strict';

  var tg = window.Telegram && window.Telegram.WebApp;
  var app = document.getElementById('app');
  var MSK = 3 * 3600;
  var WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  var HISTORY = {
    comment: ['💬', 'Комментарий'],
    reaction: ['❤️', 'Реакция'],
    owner_xp: ['👑', 'Изменение XP владельцем'],
    owner_rank: ['👑', 'Звание от владельца'],
  };
  var state = { data: null, tab: 'activity', top: 'all' };

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

  function haptic() {
    try { tg.HapticFeedback.selectionChanged(); } catch (e) { /* not supported */ }
  }

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
    if (day === today) return 'сегодня, ' + time;
    if (day === today - 1) return 'вчера, ' + time;
    return pad(d.getUTCDate()) + '.' + pad(d.getUTCMonth() + 1) + ', ' + time;
  }

  function signed(n) {
    return (n > 0 ? '+' : '') + n;
  }

  function plural(n, one, few, many) {
    var m10 = n % 10;
    var m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  function showState(title, text, retry) {
    app.replaceChildren(h('div', { class: 'state' },
      h('h2', { text: title }),
      text ? h('p', { text: text }) : null,
      retry ? h('button', { class: 'btn', onclick: load, text: 'Повторить' }) : null));
  }

  // ---- views ----------------------------------------------------------------

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
      var fill = h('i');
      progress = h('div', { class: 'progress' },
        h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100',
          'aria-valuenow': String(me.progress.percent) }, fill),
        h('div', { class: 'progress-label' },
          h('span', { text: 'До «' + me.progress.next.name + '»' }),
          h('span', { text: me.progress.left + ' XP' })));
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { fill.style.width = Math.max(2, me.progress.percent) + '%'; });
      });
    }
    var note = null;
    if (me.founder) note = 'Звание основателя Сквада.';
    else if (me.manualRank) note = 'Звание назначено владельцем. XP продолжает копиться.';
    else if (!me.progress) note = 'Высшее звание достигнуто.';
    return h('section', { class: 'hero' },
      h('div', { class: 'who' }, avatar(me),
        h('div', { style: 'min-width:0' },
          h('p', { class: 'name', text: me.name }),
          h('span', { class: 'badge' }, h('b', { text: me.rank.roman }), me.rank.name))),
      h('p', { class: 'xp-total' }, String(me.xp), ' ', h('small', { text: 'XP' })),
      progress,
      note ? h('div', { class: 'note', text: note }) : null);
  }

  function stats(me) {
    var place = me.place ? '#' + me.place : '—';
    var of = me.place ? 'место из ' + me.participants : 'нет в топе';
    return h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('b', { text: me.today + '/' + me.dailyLimit }), h('span', { text: 'сегодня' })),
      h('div', { class: 'stat' }, h('b', { text: signed(me.week) }), h('span', { text: 'за неделю' })),
      h('div', { class: 'stat' }, h('b', { text: place }), h('span', { text: of })));
  }

  function tabs() {
    var items = [['activity', 'Активность'], ['top', 'Топ'], ['ranks', 'Звания']];
    return h('div', { class: 'tabs', role: 'tablist' }, items.map(function (t) {
      return h('button', {
        role: 'tab', 'aria-selected': String(state.tab === t[0]), text: t[1],
        onclick: function () { if (state.tab !== t[0]) { state.tab = t[0]; haptic(); render(); } },
      });
    }));
  }

  function chart(days) {
    var max = days.reduce(function (m, d) { return Math.max(m, d.xp); }, 0) || 1;
    var today = days.length - 1;
    return h('section', { class: 'card' }, h('h3', { text: 'XP за 7 дней' }),
      h('div', { class: 'chart' }, days.map(function (d, i) {
        var bar = h('i');
        bar.style.height = Math.round((d.xp / max) * 84) + 'px';
        return h('div', { class: 'col' + (d.xp ? ' has' : '') + (i === today ? ' today' : '') },
          h('em', { text: d.xp ? String(d.xp) : '' }), bar,
          h('span', { text: i === today ? 'сег' : WEEKDAYS[msk(d.day).getUTCDay()] }));
      })));
  }

  function historyCard(items) {
    var body;
    if (!items.length) {
      body = h('p', { class: 'empty', text: 'Пока пусто. Оставь комментарий под постом Сквада.' });
    } else {
      body = h('ul', { class: 'list' }, items.map(function (it) {
        var meta = HISTORY[it.kind] || ['•', it.kind];
        var title = it.kind === 'owner_rank' ? (it.rank ? 'Звание ' + it.rank + ' от владельца' : 'Звание снова по XP') : meta[1];
        return h('li', { class: 'row' },
          h('div', { class: 'ico', text: meta[0] }),
          h('div', { class: 'main' }, h('b', { text: title }), h('span', { text: when(it.at) })),
          it.points ? h('div', { class: 'pts' + (it.points < 0 ? ' neg' : ''), text: signed(it.points) + ' XP' }) : null);
      }));
    }
    return h('section', { class: 'card' }, h('h3', { text: 'История' }), body);
  }

  function topCard(top) {
    var rows = state.top === 'week' ? top.week : top.all;
    var seg = h('div', { class: 'seg', role: 'tablist' }, [['all', 'За всё время'], ['week', 'За неделю']].map(function (t) {
      return h('button', {
        role: 'tab', 'aria-selected': String(state.top === t[0]), text: t[1],
        onclick: function () { if (state.top !== t[0]) { state.top = t[0]; haptic(); render(); } },
      });
    }));
    var medals = ['🥇', '🥈', '🥉'];
    var body = rows.length ? h('ul', { class: 'list' }, rows.map(function (r) {
      return h('li', { class: 'row' + (r.me ? ' me' : '') },
        h('div', { class: 'ico place', text: medals[r.place - 1] || String(r.place) }),
        h('div', { class: 'main' }, h('b', { text: r.name + (r.me ? ' (ты)' : '') }), h('span', { text: r.rank.roman + ' · ' + r.rank.name })),
        h('div', { class: 'pts', text: r.score + ' XP' }));
    })) : h('p', { class: 'empty', text: state.top === 'week' ? 'На этой неделе ещё никто не заработал XP.' : 'Пока никто не заработал XP.' });
    var note = state.top === 'week' ? h('p', { class: 'foot', text: 'Неделя начинается в понедельник по Москве.' }) : null;
    return h('section', { class: 'card' }, h('h3', { text: 'Топ Сквада' }), seg, body, note);
  }

  function ranksCard(ranks, rules, me) {
    var list = h('ul', { class: 'list' }, ranks.map(function (r) {
      return h('li', { class: 'row rank-row' + (r.reached ? ' done' : '') },
        h('div', { class: 'ico', text: r.roman }),
        h('div', { class: 'main' }, h('b', { text: r.name }), h('span', { text: 'от ' + r.from + ' XP' })),
        r.reached ? h('div', { class: 'pts', text: '✓' }) : null);
    }).concat([h('li', { class: 'row rank-row' + (me.founder ? ' done' : '') },
      h('div', { class: 'ico', text: 'X' }),
      h('div', { class: 'main' }, h('b', { text: 'Основатель SQUAD' }), h('span', { text: 'только владелец' })),
      me.founder ? h('div', { class: 'pts', text: '✓' }) : null)]));
    var how = h('ul', { class: 'rules' },
      h('li', { text: '+' + rules.comment + ' XP за комментарий под постом (от 5 букв, не чаще раза в минуту).' }),
      h('li', { text: '+' + rules.reaction + ' XP за реакцию в обсуждениях, до ' + rules.dailyReactions + ' в день.' }),
      h('li', { text: 'Не больше ' + me.dailyLimit + ' XP в день по Москве.' }));
    return [h('section', { class: 'card' }, h('h3', { text: 'Звания' }), list),
      h('section', { class: 'card' }, h('h3', { text: 'Как получить XP' }), how)];
  }

  // The header is built once; tab switches redraw only the part below it.
  var view = null;

  function render() {
    var d = state.data;
    if (!view) {
      view = h('div');
      app.replaceChildren(hero(d.me), stats(d.me), view, h('p', { class: 'foot', text: 'FINYA HELPER · T.N.K.C SQUAD' }));
    }
    var body;
    if (state.tab === 'top') body = topCard(d.top);
    else if (state.tab === 'ranks') body = ranksCard(d.ranks, d.rules, d.me);
    else body = [chart(d.chart), historyCard(d.history)];
    view.replaceChildren(tabs(), h('div', null, body));
  }

  // ---- data -----------------------------------------------------------------

  function load() {
    if (!tg || !tg.initData || !tg.Serverless) {
      showState('Открой профиль в Telegram', 'Нажми «Профиль» в чате с Финей.', false);
      return;
    }
    app.replaceChildren(h('div', { class: 'state' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }),
      h('p', { text: 'Загружаю профиль…' })));
    tg.Serverless.call('profile', {}, function (err, data) {
      if (err || !data) {
        showState('Не удалось загрузить профиль', err && err.type === 'ENDPOINT_ERROR' ? err.message : 'Проверь интернет и попробуй ещё раз.', true);
        return;
      }
      state.data = data;
      view = null;
      render();
    });
  }

  if (tg) {
    try { tg.ready(); tg.expand(); } catch (e) { /* old client */ }
    try { tg.setHeaderColor('secondary_bg_color'); tg.setBackgroundColor('secondary_bg_color'); } catch (e) { /* old client */ }
  }
  load();
})();
