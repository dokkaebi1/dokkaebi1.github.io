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
  var STATUS_WORD = { w: '승인 대기', t: '예약 완료', b: '예약 불가' };

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
    }
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
    return { update: update, flash: flash, seats: seats, scrollTo: scrollTo };
  }
  function toSet(a) { var o = {}; (a || []).forEach(function (x) { o[x] = true; }); return o; }

  function legend(kind) {
    var items = kind === 'mine'
      ? [['me', '내 좌석'], ['', '다른 좌석']]
      : kind === 'admin'
        ? [['', '빈 좌석'], ['sel', '고른 좌석'], ['w', '승인 대기'], ['t', '확정'], ['arr', '도착'], ['b', '막음'], ['wh', '휠체어석']]
        : [['', '예약 가능'], ['sel', '내가 고른 좌석'], ['w', '승인 대기'], ['t', '예약 완료'], ['b', '예약 불가'], ['wh', '휠체어석 ♿']];
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

  /* 확인 창 (Promise<boolean>) */
  function confirmBox(title, text, okLabel, danger) {
    return new Promise(function (resolve) {
      var d = el('dialog', 'rv-dlg');
      d.innerHTML = '<div class="in"><header><h2>' + esc(title) + '</h2></header><div class="body"><p style="margin:0">' + esc(text).replace(/\n/g, '<br>') + '</p></div>'
        + '<footer><button type="button" class="rv-btn rv-btn-line" data-no>닫기</button><button type="button" class="rv-btn ' + (danger ? 'rv-btn-red' : 'rv-btn-ink') + '" data-yes>' + esc(okLabel || '확인') + '</button></footer></div>';
      document.body.appendChild(d);
      function done(v) { d.close(); d.remove(); resolve(v); }
      d.querySelector('[data-no]').onclick = function () { done(false); };
      d.querySelector('[data-yes]').onclick = function () { done(true); };
      d.addEventListener('cancel', function (e) { e.preventDefault(); done(false); });
      d.showModal();
      d.querySelector('[data-yes]').focus();
    });
  }

  /* 화면이 보일 때만 주기적으로 새로고침 */
  function poll(fn, ms) {
    var timer = null, busy = false;
    function tick() {
      clearTimeout(timer);
      if (document.hidden) return;
      if (busy) { timer = setTimeout(tick, ms); return; }
      busy = true;
      Promise.resolve(fn()).catch(function () {}).then(function () { busy = false; timer = setTimeout(tick, ms); });
    }
    document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
    tick();
    return { now: tick };
  }

  /* 서버 주소는 페이지의 <meta name="dokkaebi-api"> 에서 읽습니다 (홈페이지 접수와 같은 서버) */
  var meta = document.querySelector('meta[name="dokkaebi-api"]');
  var API = meta ? meta.getAttribute('content') : '';
  function api(action, data) {
    if (!API) return Promise.resolve({ ok: false, code: 'off', message: '예약 서버가 아직 연결되지 않았어요. ' + R.EVENT.phone + '으로 문의해 주세요.' });
    return fetch(API, { method: 'POST', body: JSON.stringify(Object.assign({ action: action }, data || {})), redirect: 'follow' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .catch(function () { return { ok: false, code: 'network', message: '연결이 잠시 원활하지 않아요. 잠시 후 다시 시도해 주세요.' }; });
  }

  function fieldErrors(form, errors) {
    form.querySelectorAll('.rv-fld').forEach(function (f) { f.classList.remove('bad'); var e = f.querySelector('.err'); if (e) e.remove(); });
    var first = null;
    Object.keys(errors || {}).forEach(function (k) {
      var inp = form.querySelector('[name="' + k + '"]');
      var f = inp && inp.closest('.rv-fld');
      if (!f) return;
      f.classList.add('bad');
      f.appendChild(el('span', 'err', esc(errors[k])));
      if (!first) first = inp;
    });
    if (first) first.focus();
  }

  window.RSVUI = { esc: esc, $: $, el: el, hall: hall, legend: legend, toast: toast, confirm: confirmBox, poll: poll, api: api, fieldErrors: fieldErrors };
})();
