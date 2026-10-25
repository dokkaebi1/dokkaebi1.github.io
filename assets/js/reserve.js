/* 좌석 예약 화면: 회차 고르기 → 인원 정하기 → 좌석 고르기(실시간) → 예약 신청
   - 예약 오픈 전(기본 11월 4일 오전 10시)에는 좌석표만 보여 주고 남은 시간을 셉니다
   - 인원을 먼저 정하면 좌석 하나를 눌렀을 때 붙어 있는 빈 좌석을 인원만큼 자동으로 고릅니다 */
(function () {
  'use strict';
  var R = window.RSV, U = window.RSVUI, esc = U.esc;
  var S = { data: null, show: null, sel: [], need: 1, auto: true, t0: Date.now(), map: null, busy: false, holds: {}, syncing: false, again: false, timer: null, deadline: null, warned: false, centered: false };
  var POLL_MS = 5000, HOLD_MS = (R.HOLD_SEC || 300) * 1000;
  /* 이 화면(브라우저 탭)의 이름표: 내가 고른 좌석을 다른 분 화면에 '예약 중'으로 보여 주는 데 씁니다 */
  var HOLDER = (function () {
    var k = 'dk-rsv-holder', v = null;
    try { v = sessionStorage.getItem(k); } catch (e) {}
    if (!/^[a-f0-9]{24}$/.test(v || '')) {
      var a = new Uint8Array(12); (window.crypto || window.msCrypto).getRandomValues(a);
      v = Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      try { sessionStorage.setItem(k, v); } catch (e) {}
    }
    return v;
  })();

  var showsBox = U.$('#rv-shows'), board = U.$('#rv-hall'), live = U.$('#rv-live'), bar = U.$('.rv-bar'), dlg = U.$('#rv-dlg');
  var openBox = U.$('#rv-open'), party = U.$('#rv-party'), nInput = U.$('#rv-n'), autoBox = U.$('#rv-auto');
  U.$('#rv-legend').innerHTML = U.legend('public');
  S.map = U.hall(board, { onPick: pick, minimap: U.$('#rv-mini') });

  function maxN() { return (S.data && S.data.max) || 100; }
  function notYet() { return !!(S.data && S.data.notYet) && Date.now() < openMs(); }
  function openMs() { return S.data && S.data.openAt ? Date.parse(S.data.openAt.replace(' ', 'T') + ':00+09:00') : 0; }

  /* 예약된 좌석 + 다른 분이 지금 고르고 있는 좌석('h') */
  function occ() {
    var o = {}, a = (S.data && S.data.seats[S.show]) || {}, h = S.holds[S.show] || {}, k;
    for (k in h) o[k] = 'h';
    for (k in a) o[k] = a[k];
    return o;
  }

  /* 고른 좌석을 서버에 알려 '예약 중'으로 잡아 둠. 처음 고른 때부터 5분 안에 신청하지 않으면 풀림 (연장 없음) */
  function syncHold() {
    if (!S.show) return Promise.resolve();
    if (S.syncing) { S.again = true; return Promise.resolve(); }
    S.syncing = true;
    var show = S.show, sent = S.sel.slice();
    return U.api('rsvHold', { show: show, seats: sent, holder: HOLDER }).then(function (r) {
      S.syncing = false;
      if (r.ok) {
        S.holds = r.holds || S.holds;
        if (show === S.show && S.sel.length && r.until) S.deadline = Date.now() + (r.until - r.now);   // 서버 시계 기준 남은 시간
        var lost = (r.lost || []).filter(function (x) { return S.sel.indexOf(x) >= 0 && show === S.show; });
        if (lost.length) {
          S.sel = S.sel.filter(function (x) { return lost.indexOf(x) < 0; });
          U.toast(lost.join(', ') + ' 좌석은 다른 분이 방금 고르셨어요. 다른 좌석을 골라 주세요.', true);
          S.map.flash(lost);
        }
        S.map.update({ occ: occ(), sel: S.sel });
        renderBar();
        S.holdFails = 0;
      } else if (r.code === 'closed' || r.code === 'notyet') { U.toast(r.message, true); S.sel = []; render(); }
      else if ((r.code === 'network' || r.code === 'timeout') && S.sel.length) {   // 좌석을 아직 못 잡았음: 다시 시도, 계속 안 되면 알림
        S.holdFails = (S.holdFails || 0) + 1;
        if (S.holdFails === 2) U.toast('연결이 불안정해 고른 좌석을 아직 잡지 못했어요. 신청할 때 다시 확인해요.', true);
        if (S.holdFails < 6) setTimeout(holdSoon, 3000);
      }
      if (S.again) { S.again = false; syncHold(); }
    });
  }
  function holdSoon() { clearTimeout(S.timer); S.timer = setTimeout(syncHold, 250); }
  function release(show) {
    var body = JSON.stringify({ action: 'rsvHold', show: show, seats: [], holder: HOLDER });
    var meta = document.querySelector('meta[name="dokkaebi-api"]'), api = meta && meta.content;
    if (api && navigator.sendBeacon) navigator.sendBeacon(api, body);
  }
  window.addEventListener('pagehide', function () { if (S.sel.length && S.show) release(S.show); });
  function showInfo(id) { return S.data && S.data.shows.filter(function (s) { return s.id === id; })[0]; }

  function load() {
    return U.api('rsvState', { holder: HOLDER }).then(function (r) {
      if (!r.ok) {
        live.classList.add('off'); live.lastChild.textContent = r.code === 'off' ? '연결 전' : '연결이 잠시 끊겼어요';
        if (!S.data) showsBox.innerHTML = '<p class="rv-err">' + esc(r.message) + '</p>';
        return;
      }
      live.classList.remove('off'); live.lastChild.textContent = '실시간 좌석 · ' + r.now.slice(11) + ' 기준';
      S.data = r;
      S.holds = r.holds || {};
      if (!S.show || !showInfo(S.show)) {
        var first = r.shows.filter(function (s) { return s.open; })[0] || r.shows[0];
        S.show = first.id;
      }
      // 고른 좌석이 그사이 다른 분께 예약됐으면 빼기
      var o = occ(), lost = S.sel.filter(function (s) { return o[s]; });
      if (lost.length) {
        S.sel = S.sel.filter(function (s) { return !o[s]; });
        U.toast('고르신 ' + lost.join(', ') + ' 좌석이 방금 다른 분께 예약되었어요.', true);
        S.map.flash(lost);
      }
      if (!S.sel.length) S.deadline = null;
      render();
      if (!S.centered) { S.centered = true; S.map.center(); }
    });
  }

  function render() {
    var d = S.data, wait = notYet();
    showsBox.innerHTML = d.shows.map(function (s) {
      var p = R.dateLabel(s.date);
      var left = s.closed ? '예약 마감' : wait ? '빈 좌석 ' + s.left + '석' : !d.open ? '예약 중단' : s.left ? '남은 좌석 ' + s.left + '석' : '매진';
      return '<button type="button" class="rv-show" data-show="' + s.id + '" aria-pressed="' + (s.id === S.show) + '"' + (s.closed ? ' disabled' : '') + '>'
        + '<span class="d">' + esc(p) + '</span><span class="t">' + esc(R.timeLabel(s.time)) + ' 공연</span>'
        + '<span class="left">' + left + '</span></button>';
    }).join('');
    renderParty();
    renderOpen();
    S.map.update({ occ: occ(), sel: S.sel });
    renderBar();
  }

  /* ---------- 예약 오픈 전 안내 (남은 시간) ---------- */
  function renderOpen() {
    if (!openBox || !S.data) return;
    var wait = notYet();
    openBox.hidden = !wait;
    document.body.classList.toggle('rv-notyet', wait);
    if (!wait) return;
    var ms = openMs() - Date.now(), d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5), m = Math.floor(ms % 36e5 / 6e4), s = Math.floor(ms % 6e4 / 1e3);
    U.$('[data-open-at]', openBox).textContent = S.data.openAtLabel;
    U.$('[data-open-left]', openBox).textContent = d > 0 ? d + '일 ' + h + '시간 ' + m + '분' : h + '시간 ' + m + '분 ' + s + '초';
  }
  setInterval(function () {
    if (!S.data || !S.data.notYet) return;
    if (Date.now() >= openMs()) { S.data.notYet = false; load(); } else renderOpen();
  }, 1000);

  /* ---------- 인원 정하기 ---------- */
  function setNeed(n) {
    n = Math.max(1, Math.min(maxN(), parseInt(n, 10) || 1));
    S.need = n;
    if (S.sel.length > n) {
      var drop = S.sel.slice(n);
      S.sel = S.sel.slice(0, n);
      U.toast('인원을 ' + n + '명으로 줄여서 ' + drop.join(', ') + ' 좌석을 뺐어요.');
      S.map.update({ occ: occ(), sel: S.sel });
      holdSoon();
    }
    renderParty();
    renderBar();
  }
  function renderParty() {
    if (!party) return;
    nInput.max = maxN();
    if (document.activeElement !== nInput) nInput.value = S.need;
    party.querySelectorAll('[data-set]').forEach(function (b) {
      b.hidden = +b.dataset.set > maxN();
      b.setAttribute('aria-pressed', String(+b.dataset.set === S.need));
    });
    document.querySelectorAll('[data-max]').forEach(function (b) { b.textContent = maxN(); });
    autoBox.closest('label').hidden = S.need < 2;
  }
  party.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.set) setNeed(b.dataset.set);
    if (b.dataset.step) setNeed(S.need + +b.dataset.step);
  });
  nInput.addEventListener('change', function () { setNeed(nInput.value); });
  nInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); setNeed(nInput.value); nInput.blur(); } });
  autoBox.addEventListener('change', function () { S.auto = autoBox.checked; });

  /* 누른 좌석부터 붙어 있는 빈 좌석 고르기: 같은 줄에서 가까운 순 → 뒷줄 → 앞줄 (휠체어석은 직접 누를 때만) */
  function autoFill(start, count) {   // 규칙은 reserve-core.js autoPick (같은 층·통로 안 넘음·차 있는 좌석 안 넘음)
    var o = occ(), chosen = {};
    S.sel.forEach(function (x) { chosen[x] = true; });
    return R.autoPick(start, count, function (id) { return !o[id] && !chosen[id]; });
  }
  /* 고른 좌석이 여러 곳으로 나뉘면 알려 줄 문장 (한 묶음이면 '') */
  function splitNote() {
    var g = R.seatGroups(S.sel);
    return g.length > 1 ? '좌석이 ' + g.length + '곳으로 나뉘어 있어요: ' + g.join(' · ') : '';
  }

  /* ---------- 남은 시간: 1초마다 표시, 1분 남으면 알림, 0이 되면 고른 좌석을 비움 ---------- */
  function clock(ms) { var s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); }
  function tick() {
    var els = document.querySelectorAll('[data-timer]');
    if (!S.deadline || !S.sel.length) { els.forEach(function (e) { e.hidden = true; }); return; }
    var left = S.deadline - Date.now();
    if (left <= 0) { if (!S.busy) expire(); return; }
    if (left <= 60000 && !S.warned) { S.warned = true; U.toast('1분 남았어요. 1분 안에 신청하지 않으면 고른 좌석이 풀려요.', true); }
    els.forEach(function (e) { e.hidden = false; e.classList.toggle('warn', left <= 60000); e.textContent = '남은 시간 ' + clock(left); });
  }
  function expire() {
    var gone = S.sel.slice();
    S.sel = []; S.deadline = null; S.warned = false;
    if (dlg.open && U.$('.done-pane', dlg).hidden) dlg.close();
    render();
    syncHold();
    U.toast('5분 안에 신청하지 않아 고른 좌석(' + gone.join(', ') + ')이 풀렸어요. 다시 골라 주세요.', true);
  }
  setInterval(tick, 1000);

  function renderBar() {
    var n = S.sel.length;
    if (!n) { S.deadline = null; S.warned = false; }
    bar.classList.toggle('show', n > 0);
    U.$('.picked b', bar).textContent = n ? R.dateLabel(S.show) + ' · ' + S.need + '명 중 ' + n + '석 고름' : '';
    var note = splitNote();
    U.$('.picked span', bar).textContent = note || S.sel.join(' · ');
    bar.classList.toggle('split', !!note);
    var apply = U.$('[data-apply]', bar);
    apply.textContent = n < S.need ? (S.need - n) + '석 더 골라 주세요' : '예약 신청';
    apply.classList.toggle('rv-btn-wait', n < S.need);
    S.map.redraw();
  }

  showsBox.addEventListener('click', function (e) {
    var b = e.target.closest('[data-show]');
    if (!b || b.disabled || b.dataset.show === S.show) return;
    if (S.sel.length) { U.toast('회차를 바꿔서 고른 좌석을 비웠어요.'); U.api('rsvHold', { show: S.show, seats: [], holder: HOLDER }); }
    S.show = b.dataset.show; S.sel = []; S.deadline = null; S.warned = false;
    render();
  });

  function pick(id) {
    if (!S.data) return;
    if (notYet()) { U.toast('좌석 예약은 ' + S.data.openAtLabel + '에 열려요. 지금은 좌석만 미리 볼 수 있어요.', true); return; }
    var info = showInfo(S.show);
    if (!info.open) { U.toast(info.closed ? '이 회차는 예약이 끝났어요.' : '지금은 예약을 받지 않아요.', true); return; }
    var i = S.sel.indexOf(id);
    if (i >= 0) S.sel.splice(i, 1);
    else {
      var code = occ()[id];
      if (code) { U.toast(code === 'h' ? '다른 분이 지금 이 좌석을 예약하고 있어요. 잠시 뒤에 다시 확인해 주세요.' : code === 'w' ? '다른 분이 신청해서 승인 대기 중인 좌석이에요.' : '이미 예약된 좌석이에요.'); return; }
      var room = S.need - S.sel.length;
      if (room <= 0) { U.toast('인원 ' + S.need + '명만큼 다 골랐어요. 바꾸려면 고른 좌석을 눌러 빼거나 위에서 인원을 바꿔 주세요.', true); return; }
      var picks = S.auto && room > 1 ? autoFill(id, room) : [id];
      if (picks.length < room && S.auto && room > 1) U.toast('같은 층에 붙어 있는 빈 좌석이 모자라 ' + picks.length + '석만 골랐어요. 나머지 ' + (room - picks.length) + '석은 다른 곳을 눌러 더 골라 주세요.', true);
      if (!S.sel.length) { S.deadline = Date.now() + HOLD_MS; S.warned = false; }   // 서버 답이 오면 맞춤
      S.sel = S.sel.concat(picks).sort(R.seatSort);
      if (picks.length > 1) S.map.flash(picks);
      if (R.WHEEL.indexOf(id) >= 0) U.toast('휠체어석이에요. 휠체어를 이용하는 관객만 골라 주세요.');
    }
    S.map.update({ occ: occ(), sel: S.sel });
    renderBar();
    tick();
    holdSoon();
  }

  U.$('[data-clear]', bar).addEventListener('click', function () { S.sel = []; render(); holdSoon(); });
  U.$('[data-apply]', bar).addEventListener('click', function () {
    if (S.sel.length < S.need) { U.toast('인원 ' + S.need + '명 중 ' + S.sel.length + '석만 골랐어요. ' + (S.need - S.sel.length) + '석을 더 고르거나 위에서 인원을 줄여 주세요.', true); return; }
    openForm();
  });

  /* ---------- 예약 신청 ---------- */
  var form = U.$('form', dlg);
  function panes(done) {
    dlg.querySelectorAll('.form-pane').forEach(function (p) { p.hidden = done; });
    dlg.querySelectorAll('.done-pane').forEach(function (p) { p.hidden = !done; });
  }
  function openForm() {
    if (!S.sel.length) return;
    if (!S.reqId) S.reqId = HOLDER + '-' + Date.now().toString(36);   // 같은 신청을 다시 보내도 한 번만 접수
    U.$('[data-pick]', dlg).innerHTML = '<b>' + esc(R.showLabel(S.show)) + '</b><span class="seats">' + S.sel.length + '명 · ' + esc(S.sel.join(', ')) + '</span>'
      + (splitNote() ? '<span class="rv-split">⚠ ' + esc(splitNote()) + '. 함께 앉으려면 좌석을 다시 골라 주세요.</span>' : '')
      + '<span class="rv-timer" data-timer hidden></span><small>좌석을 처음 고른 때부터 5분 안에 신청해 주세요. 시간이 지나면 좌석이 풀려요.</small>';
    tick();
    panes(false);
    U.$('.rv-err', dlg).textContent = '';
    U.fieldErrors(form, {});
    dlg.showModal();
    setTimeout(function () { form.elements.name.focus(); }, 30);
  }
  form.addEventListener('change', function (e) {
    if (!e.target.hasAttribute('data-showpw')) return;
    form.querySelectorAll('input[name^="password"]').forEach(function (i) { i.type = e.target.checked ? 'text' : 'password'; });
  });
  U.$('.x', dlg).addEventListener('click', function () { dlg.close(); });
  U.$('[data-close]', dlg).addEventListener('click', function () { dlg.close(); });
  U.$('[data-done]', dlg).addEventListener('click', function () { dlg.close(); });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (S.busy) return;
    var f = form.elements, errs = {};
    if (f.email.value.trim().toLowerCase() !== f.email2.value.trim().toLowerCase()) errs.email2 = '이메일이 서로 달라요. 다시 확인해 주세요';
    if (f.password.value !== f.password2.value) errs.password2 = '비밀번호가 서로 달라요';
    if (Object.keys(errs).length) { U.fieldErrors(form, errs); return; }
    var btn = U.$('[type=submit]', form);
    S.busy = true; btn.disabled = true; btn.textContent = '보내는 중...';
    U.$('.rv-err', dlg).textContent = '';
    var body = {
      show: S.show, seats: S.sel, name: f.name.value, org: f.org.value, phone: f.phone.value, email: f.email.value,
      password: f.password.value, note: f.note.value, consent: f.consent.checked, website: f.website.value, elapsed: Date.now() - S.t0, holder: HOLDER, reqId: S.reqId
    };
    function send(tries) {   // 응답이 없으면 같은 요청번호로 한 번 더 (서버가 이미 받았으면 그 결과가 돌아옴)
      return U.api('rsvBook', body).then(function (r) {
        if ((r.code === 'timeout' || r.code === 'network') && tries < 1) { btn.textContent = '접수됐는지 확인하는 중...'; return new Promise(function (ok) { setTimeout(ok, 2500); }).then(function () { return send(tries + 1); }); }
        return r;
      });
    }
    send(0).then(function (r) {
      S.busy = false; btn.disabled = false; btn.textContent = '예약 신청하기';
      if (r.ok) {
        S.reqId = null;
        panes(true);
        U.$('[data-mail-ok]', dlg).hidden = r.mailed === false;
        U.$('[data-mail-fail]', dlg).hidden = r.mailed !== false;
        U.$('[data-no]', dlg).textContent = r.id;
        U.$('[data-what]', dlg).textContent = r.showLabel + ' · ' + r.seats.length + '명 · ' + r.seats.join(', ');
        U.$('[data-mail]', dlg).textContent = f.email.value.trim();
        form.reset();
        form.querySelectorAll('input[name^="password"]').forEach(function (i) { i.type = 'password'; });
        S.sel = [];
        S.t0 = Date.now();
        load();
        return;
      }
      if (r.code === 'invalid') { U.fieldErrors(form, r.errors); U.$('.rv-err', dlg).textContent = r.message; return; }
      if (r.code === 'taken') {
        dlg.close();
        S.sel = S.sel.filter(function (s) { return r.taken.indexOf(s) < 0; });
        U.toast(r.message + ' — 다른 좌석을 골라 주세요.', true);
        load().then(function () { S.map.flash(r.taken); holdSoon(); });
        return;
      }
      if (r.code === 'timeout' || r.code === 'network') {
        U.$('.rv-err', dlg).innerHTML = '서버 응답을 받지 못했어요. 이미 접수됐을 수 있으니 <a href="my.html" target="_blank">내 예약 확인</a>에서 먼저 확인해 주세요. 다시 ‘예약 신청하기’를 눌러도 두 번 접수되지 않아요.';
        return;
      }
      if (r.code === 'dup') { U.$('.rv-err', dlg).innerHTML = esc(r.message) + ' <a href="my.html" target="_blank">내 예약 확인 열기</a>'; return; }
      U.$('.rv-err', dlg).textContent = r.message || '잠시 후 다시 시도해 주세요.';
    });
  });

  U.poll(load, POLL_MS);
})();
