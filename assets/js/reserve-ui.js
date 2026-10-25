/* 극단 도깨비 · 좌석 예약 화면 공용 도구 (좌석 배치도 그리기, 알림, 확인 창, 자동 새로고침) */
(function () {
  'use strict';
  var R = window.RSV;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  /* 좌석 배치도: 무대가 위, A열이 무대 앞. O·P열은 2층 양옆 */
  var ROW_LINE = {}; // 그리드 줄 번호
  R.ROWS.forEach(function (r, i) { ROW_LINE[r] = i < 7 ? 3 + i : 4 + i; }); // A~G: 3~9, (통로 10), H~N: 11~17
  var STATUS_WORD = { h: '다른 분이 예약 중', w: '승인 대기', t: '예약 완료', b: '예약 불가' };

  function hall(host, opts) {
    opts = opts || {};
    var ro = !!opts.readonly;
    var g = el('div', 'hall' + (opts.admin ? ' adm' : ''));
    g.setAttribute('role', 'group');
    g.setAttribute('aria-label', '안데르센극장 좌석 배치도 (위쪽이 무대)');
    function put(node, col, row) { node.style.gridColumn = col; node.style.gridRow = row; g.appendChild(node); return node; }
    put(el('div', 'stage', 'STAGE · 무대'), '4 / 21', '1');
    put(el('div', 'floor', '1층'), '1', '3');
    put(el('div', 'floor', '2층'), '1', '11');
    put(el('div', 'aisle', '<span>출입구 →</span>'), '4 / 21', '10');
    put(el('div', 'booth', ''), '8 / 17', '17');
    put(el('div', 'exit', '↓ 출입구'), '4 / 21', '18');
    var seats = {};
    function seatNode(id, n) {
      var b = el(ro ? 'span' : 'button', 'seat', '<span class="r">' + id.charAt(0) + '</span>' + n);
      if (!ro) { b.type = 'button'; b.addEventListener('click', function () { if (opts.onPick) opts.onPick(id, b); }); }
      else b.classList.add('ro');
      b.dataset.s = id;
      if (R.WHEEL.indexOf(id) >= 0) b.classList.add('wh');
      seats[id] = b;
      return b;
    }
    R.ROWS.forEach(function (r) {
      var line = ROW_LINE[r];
      put(el('div', 'rl', r), '3', String(line)).setAttribute('aria-hidden', 'true');
      put(el('div', 'rl', r), '21', String(line)).setAttribute('aria-hidden', 'true');
      R.rowNums(r).forEach(function (n) { put(seatNode(r + n, n), String(3 + n), String(line)); });
    });
    ['O', 'P'].forEach(function (r) {
      var col = r === 'O' ? '1' : '23';
      put(el('div', 'rl side-l', r + '열'), col, '12').setAttribute('aria-hidden', 'true');
      var box = put(el('div', 'side'), col, '13 / 18');
      R.rowNums(r).forEach(function (n) { box.appendChild(seatNode(r + n, n)); });
    });
    host.innerHTML = '';
    host.appendChild(g);

    /* view: { occ: {A5:'w'}, sel: [..], me: [..], arr: [..], focus: 'A5' } */
    function update(view) {
      view = view || {};
      var occ = view.occ || {}, sel = toSet(view.sel), me = toSet(view.me), arr = toSet(view.arr);
      Object.keys(seats).forEach(function (id) {
        var b = seats[id], code = occ[id] || '';
        var cls = 'seat' + (ro ? ' ro' : '') + (R.WHEEL.indexOf(id) >= 0 ? ' wh' : '');
        if (me[id]) cls += ' me';
        else if (sel[id]) cls += ' sel';
        else if (code) cls += ' ' + code;
        if (arr[id]) cls += ' arr';
        if (view.focus && view.focus[id]) cls += ' focus';
        if (b.className.indexOf('flash') >= 0) cls += ' flash';
        b.className = cls;
        var label = R.seatName(id) + (R.WHEEL.indexOf(id) >= 0 ? ' 휠체어석' : '');
        var word = me[id] ? '내 좌석' : sel[id] ? '선택함' : STATUS_WORD[code] || '예약 가능';
        b.setAttribute('aria-label', label + ', ' + word);
        if (!ro) {
          b.setAttribute('aria-pressed', sel[id] ? 'true' : 'false');
          if (!opts.admin) b.setAttribute('aria-disabled', code && !sel[id] ? 'true' : 'false');
        }
      });
      last = view;
      if (mini) mini.draw();
    }
    var last = {};

    /* 위치 지도: 좌석표가 화면보다 넓을 때(휴대폰) 극장 전체를 작게 보여 주고,
       지금 화면에 보이는 부분을 빨간 네모로 표시. 누르면 그곳으로 이동 */
    var mini = opts.minimap ? minimap(opts.minimap) : null;
    function minimap(box) {
      var cv = el('canvas', 'mini-cv'), sc = host.closest('.rv-scroll');
      cv.setAttribute('role', 'img');
      cv.setAttribute('aria-label', '극장 전체 좌석 위치 지도. 빨간 네모가 지금 보고 있는 부분이에요');
      box.innerHTML = '';
      box.appendChild(cv);
      box.appendChild(el('p', 'mini-note', '<b>지금 보고 있는 곳</b><br>빨간 네모가 화면에 보이는 좌석이에요. 지도를 누르면 그곳으로 이동해요.'));
      var COL = { '': '#FFFFFF', sel: '#B21A2D', h: '#EFA2AC', w: '#F6DD9E', t: '#B9AD99', b: '#B9AD99', me: '#1F3B60', arr: '#2E7D4F' };
      var raf = 0;
      function rects() {   // 좌석·무대 위치 (좌석표 왼쪽 위 기준)
        var gr = g.getBoundingClientRect(), out = [];
        Object.keys(seats).forEach(function (id) { var r = seats[id].getBoundingClientRect(); out.push([id, r.left - gr.left, r.top - gr.top, r.width, r.height]); });
        var st = g.querySelector('.stage').getBoundingClientRect();
        return { gr: gr, seats: out, stage: [st.left - gr.left, st.top - gr.top, st.width, st.height] };
      }
      function draw() {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(function () {
          var need = sc && g.scrollWidth > sc.clientWidth + 4;
          box.hidden = !need;
          if (!need) return;
          var R2 = rects(), W = g.scrollWidth, H = g.scrollHeight;
          var maxW = Math.min(170, box.clientWidth * 0.5), k = Math.min(maxW / W, 120 / H), dpr = window.devicePixelRatio || 1;
          var cw = Math.round(W * k), ch = Math.round(H * k);
          cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
          cv.width = cw * dpr; cv.height = ch * dpr;
          var c = cv.getContext('2d');
          c.setTransform(dpr, 0, 0, dpr, 0, 0);
          c.fillStyle = '#F6EFE3'; c.fillRect(0, 0, cw, ch);
          c.fillStyle = '#15110F'; c.fillRect(R2.stage[0] * k, R2.stage[1] * k, R2.stage[2] * k, R2.stage[3] * k);
          var occ = last.occ || {}, sel = toSet(last.sel), me = toSet(last.me), arr = toSet(last.arr);
          R2.seats.forEach(function (s) {
            var id = s[0], code = me[id] ? 'me' : arr[id] ? 'arr' : sel[id] ? 'sel' : (occ[id] || '');
            c.fillStyle = COL[code] || COL[''];
            c.fillRect(s[1] * k, s[2] * k, Math.max(1.5, s[3] * k), Math.max(1.5, s[4] * k));
            if (!code) { c.strokeStyle = '#CDBFA6'; c.lineWidth = .5; c.strokeRect(s[1] * k, s[2] * k, Math.max(1.5, s[3] * k), Math.max(1.5, s[4] * k)); }
          });
          // 지금 보이는 부분 = 가로: 스크롤 상자 / 세로: 화면에서 머리글·위치 지도·아래 바를 뺀 곳
          var sr = sc.getBoundingClientRect(), top = box.getBoundingClientRect().bottom, bar = document.querySelector('.rv-bar.show');
          var bottom = Math.min(window.innerHeight - (bar ? bar.offsetHeight : 0), sr.bottom);
          var x0 = Math.max(sr.left, R2.gr.left) - R2.gr.left, x1 = Math.min(sr.right, R2.gr.right) - R2.gr.left;
          var y0 = Math.max(top, R2.gr.top) - R2.gr.top, y1 = Math.min(bottom, R2.gr.bottom) - R2.gr.top;
          if (x1 > x0 && y1 > y0) {
            c.strokeStyle = '#C21C31'; c.lineWidth = 2.5;
            c.strokeRect(x0 * k + 1, y0 * k + 1, Math.max(4, (x1 - x0) * k - 2), Math.max(4, (y1 - y0) * k - 2));
            c.fillStyle = 'rgba(194, 28, 49, .12)'; c.fillRect(x0 * k, y0 * k, (x1 - x0) * k, (y1 - y0) * k);
          }
          cv._k = k;
        });
      }
      cv.addEventListener('click', function (e) {
        var k = cv._k; if (!k) return;
        var r = cv.getBoundingClientRect(), hx = (e.clientX - r.left) / k, hy = (e.clientY - r.top) / k;
        sc.scrollTo({ left: hx - sc.clientWidth / 2, behavior: 'smooth' });
        var gr = g.getBoundingClientRect(), mid = (box.getBoundingClientRect().bottom + window.innerHeight) / 2;
        window.scrollBy({ top: gr.top + hy - mid, behavior: 'smooth' });
      });
      if (sc) sc.addEventListener('scroll', draw, { passive: true });
      window.addEventListener('scroll', draw, { passive: true });
      window.addEventListener('resize', draw);
      // 글꼴·좌석표 크기가 늦게 정해져도 다시 그리기
      if (window.ResizeObserver && sc) new ResizeObserver(draw).observe(g);
      window.addEventListener('load', draw);
      return { draw: draw };
    }
    /* 처음에는 좌석표 가운데(무대 정면)가 보이게 */
    var wantCenter = false;
    function center() {
      var sc = host.closest('.rv-scroll');
      if (!sc || !sc.clientWidth || g.scrollWidth <= sc.clientWidth) { wantCenter = true; return; }   // 아직 크기가 안 정해졌으면 정해질 때 맞춤
      wantCenter = false;
      sc.scrollLeft = (sc.scrollWidth - sc.clientWidth) / 2;
    }
    if (window.ResizeObserver) new ResizeObserver(function () { if (wantCenter) center(); }).observe(g);
    function flash(ids) {
      (ids || []).forEach(function (id) {
        var b = seats[id]; if (!b) return;
        b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash');
        setTimeout(function () { b.classList.remove('flash'); }, 1300);
      });
    }
    function scrollTo(id) {
      var b = seats[id], sc = host.closest('.rv-scroll');
      if (!b || !sc) return;
      var r = b.getBoundingClientRect(), s = sc.getBoundingClientRect();
      sc.scrollLeft += (r.left + r.width / 2) - (s.left + s.width / 2);
    }
    /* 읽기 전용 작은 좌석표: 상자 너비에 맞춰 통째로 줄여 보여 줌 (옆으로 밀 필요 없게) */
    function fit() {
      var box = host.parentElement; if (!box) return;
      g.style.transform = ''; g.style.transformOrigin = 'top left'; box.style.height = ''; box.style.overflow = 'hidden';
      var w = g.scrollWidth, avail = box.clientWidth;
      if (w > avail) { var k = avail / w; g.style.transform = 'scale(' + k + ')'; box.style.height = Math.ceil(g.scrollHeight * k) + 'px'; }
    }
    if (opts.fit) {
      requestAnimationFrame(fit); window.addEventListener('resize', fit); window.addEventListener('load', fit);
      var fbox = host.parentElement, fw = 0;   // 상자 너비가 늦게 정해져도 다시 맞춤
      if (window.ResizeObserver && fbox) new ResizeObserver(function () { if (fbox.clientWidth !== fw) { fw = fbox.clientWidth; fit(); } }).observe(fbox);
    }
    return { update: update, flash: flash, seats: seats, scrollTo: scrollTo, center: center, redraw: function () { if (mini) mini.draw(); } };
  }
  /* 문의 전화 링크들 (여러 번호) */
  function telLinks() { return R.EVENT.phones.map(function (p) { return '<a href="tel:' + p.replace(/-/g, '') + '">' + p + '</a>'; }).join(' · '); }
  /* 문의 안내 전체: 공연 문의 전화 · 예약 문의 메일 · 예약 시스템 문의 */
  function contactLinks() {
    var E = R.EVENT;
    return '공연 문의 ' + telLinks() + ' · 예약 문의 메일 <a href="mailto:' + E.email + '">' + E.email + '</a>'
      + ' · 예약 시스템 문의 <a href="tel:' + E.sysPhone.replace(/-/g, '') + '">' + E.sysPhone + '</a>';
  }
  function toSet(a) { var o = {}; (a || []).forEach(function (x) { o[x] = true; }); return o; }

  function legend(kind) {
    var items = kind === 'mine'
      ? [['me', '내 좌석'], ['', '다른 좌석']]
      : kind === 'admin'
        ? [['', '빈 좌석'], ['sel', '고른 좌석'], ['w', '승인 대기'], ['t', '확정'], ['arr', '도착'], ['b', '막음'], ['wh', '휠체어석']]
        : [['', '빈 좌석'], ['w', '승인 대기'], ['t', '예약 완료'], ['b', '예약 불가'], ['wh', '휠체어석 ♿']];
    return '<ul class="rv-legend">' + items.map(function (x) { return '<li><span class="sw ' + x[0] + '"></span>' + x[1] + '</li>'; }).join('') + '</ul>';
  }

  /* 알림 */
  var toastTimer;
  function toast(msg, bad) {
    var t = $('.rv-toast');
    if (!t) { t = el('div', 'rv-toast'); t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite'); document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.toggle('bad', !!bad);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, bad ? 5200 : 3200);
  }

  /* 확인 창 (Promise<boolean>). 취소·삭제 같은 위험한 일(danger)은 처음 초점을 '닫기'에 둠 (Enter 한 번에 실행되지 않게) */
  var dlgN = 0;
  function confirmBox(title, text, okLabel, danger) {
    return new Promise(function (resolve) {
      var d = el('dialog', 'rv-dlg'), n = ++dlgN;
      d.setAttribute('aria-labelledby', 'rv-cf-t' + n);
      d.setAttribute('aria-describedby', 'rv-cf-d' + n);
      d.innerHTML = '<div class="in"><header><h2 id="rv-cf-t' + n + '">' + esc(title) + '</h2></header><div class="body"><p id="rv-cf-d' + n + '" style="margin:0">' + esc(text).replace(/\n/g, '<br>') + '</p></div>'
        + '<footer><button type="button" class="rv-btn rv-btn-line" data-no>닫기</button><button type="button" class="rv-btn ' + (danger ? 'rv-btn-red' : 'rv-btn-ink') + '" data-yes>' + esc(okLabel || '확인') + '</button></footer></div>';
      document.body.appendChild(d);
      function done(v) { d.close(); d.remove(); resolve(v); }
      d.querySelector('[data-no]').onclick = function () { done(false); };
      d.querySelector('[data-yes]').onclick = function () { done(true); };
      d.addEventListener('cancel', function (e) { e.preventDefault(); done(false); });
      d.showModal();
      d.querySelector(danger ? '[data-no]' : '[data-yes]').focus();
    });
  }

  /* 화면이 보일 때만 주기적으로 새로고침 */
  /* fn 을 ms 마다 부름 (화면이 가려져 있으면 쉼). ms 는 숫자 또는 다음 간격을 돌려주는 함수.
     접속자가 같은 순간에 몰리지 않게 간격을 ±15% 흩뜨림 */
  function poll(fn, ms) {
    var timer = null, busy = false;
    function gap() { return (typeof ms === 'function' ? ms() : ms) * (0.85 + Math.random() * 0.3); }
    function tick() {
      clearTimeout(timer);
      if (document.hidden) return;
      if (busy) { timer = setTimeout(tick, gap()); return; }
      busy = true;
      Promise.resolve(fn()).catch(function () {}).then(function () { busy = false; timer = setTimeout(tick, gap()); });
    }
    document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
    tick();
    return { now: tick };
  }

  /* 서버 주소는 페이지의 <meta name="dokkaebi-api"> 에서 읽습니다 (홈페이지 접수와 같은 서버) */
  var meta = document.querySelector('meta[name="dokkaebi-api"]');
  var API = meta ? meta.getAttribute('content') : '';
  /* 서버 요청. 시간 안에 답이 없으면 code 'timeout' (신청은 40초, 나머지는 20초) */
  function api(action, data, ms) {
    if (!API) return Promise.resolve({ ok: false, code: 'off', message: '예약 서버가 아직 연결되지 않았어요. 예약 시스템 문의 ' + R.EVENT.sysPhone + '로 연락해 주세요.' });
    var ctl = window.AbortController ? new AbortController() : null, timedOut = false;
    var timer = setTimeout(function () { timedOut = true; if (ctl) ctl.abort(); }, ms || (action === 'rsvBook' ? 40000 : 20000));
    return fetch(API, { method: 'POST', body: JSON.stringify(Object.assign({ action: action }, data || {})), redirect: 'follow', signal: ctl ? ctl.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .catch(function () {
        return timedOut ? { ok: false, code: 'timeout', message: '서버 응답이 늦어요. 잠시 후 다시 시도해 주세요.' }
          : { ok: false, code: 'network', message: '연결이 잠시 원활하지 않아요. 잠시 후 다시 시도해 주세요.' };
      })
      .then(function (r) { clearTimeout(timer); return r; });
  }

  /* 입력 칸 오류 표시: 칸에 aria-invalid, 오류 문구를 aria-describedby 로 이어 줌 (화면 읽기 프로그램이 같이 읽게) */
  var errN = 0;
  function fieldErrors(form, errors) {
    form.querySelectorAll('.rv-fld').forEach(function (f) {
      f.classList.remove('bad');
      var e = f.querySelector('.err'); if (e) e.remove();
      var i = f.querySelector('input, select, textarea');
      if (i) { i.removeAttribute('aria-invalid'); if (i.dataset.desc != null) { if (i.dataset.desc) i.setAttribute('aria-describedby', i.dataset.desc); else i.removeAttribute('aria-describedby'); } }
    });
    var first = null;
    Object.keys(errors || {}).forEach(function (k) {
      var inp = form.querySelector('[name="' + k + '"]');
      var f = inp && inp.closest('.rv-fld');
      if (!f) return;
      f.classList.add('bad');
      var msg = el('span', 'err', esc(errors[k]));
      msg.id = 'rv-err-' + (++errN);
      f.appendChild(msg);
      if (inp.dataset.desc == null) inp.dataset.desc = inp.getAttribute('aria-describedby') || '';
      inp.setAttribute('aria-invalid', 'true');
      inp.setAttribute('aria-describedby', (inp.dataset.desc ? inp.dataset.desc + ' ' : '') + msg.id);
      if (!first) first = inp;
    });
    if (first) first.focus();
  }

  /* 머리글 높이를 CSS 변수로 (위치 지도·차례가 머리글 바로 아래에 붙도록) */
  function headH() { var h = document.querySelector('.rv-header'); if (h) document.documentElement.style.setProperty('--rv-head', h.offsetHeight + 'px'); }
  headH(); window.addEventListener('resize', headH); window.addEventListener('load', headH);

  window.RSVUI = { esc: esc, $: $, el: el, hall: hall, legend: legend, toast: toast, confirm: confirmBox, poll: poll, api: api, fieldErrors: fieldErrors, telLinks: telLinks, contactLinks: contactLinks };
})();
