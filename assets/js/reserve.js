/* 좌석 예약 화면: 회차 고르기 → 인원(휠체어 이용 인원) 정하기 → 예약 신청 → 배정된 좌석 보기
   - 좌석은 손님이 고르지 않고 서버가 신청 순서대로 자동 배정합니다 (규칙: reserve-core.js assignSeats)
   - 예약 오픈 전(기본 11월 4일 오전 10시)에는 좌석 현황만 보여 주고 남은 시간을 셉니다 */
(function () {
  'use strict';
  var R = window.RSV, U = window.RSVUI, esc = U.esc;
  var S = { data: null, show: null, need: 1, wheel: 0, t0: Date.now(), map: null, busy: false, centered: false, reqId: null };
  var POLL_MS = 5000;
  /* 이 화면(브라우저 탭)의 이름표: 같은 신청을 다시 보낼 때 요청번호에 씀 */
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
  var openBox = U.$('#rv-open'), party = U.$('#rv-party'), nInput = U.$('#rv-n'), wheelSel = U.$('#rv-wheel');
  U.$('#rv-legend').innerHTML = U.legend('public');
  S.map = U.hall(board, { readonly: true, minimap: U.$('#rv-mini') });   // 좌석 현황 보기 (누를 수 없음)

  function maxN() { return (S.data && S.data.max) || 100; }
  function notYet() { return !!(S.data && S.data.notYet) && Date.now() < openMs(); }
  function openMs() { return S.data && S.data.openAt ? Date.parse(S.data.openAt.replace(' ', 'T') + ':00+09:00') : 0; }
  function occ() { return (S.data && S.data.seats[S.show]) || {}; }
  function showInfo(id) { return S.data && S.data.shows.filter(function (s) { return s.id === id; })[0]; }

  function load() {
    return U.api('rsvState', {}).then(function (r) {
      if (!r.ok) {
        live.classList.add('off'); live.lastChild.textContent = r.code === 'off' ? '연결 전' : '연결이 잠시 끊겼어요';
        if (!S.data) showsBox.innerHTML = '<p class="rv-err">' + esc(r.message) + '</p>';
        return;
      }
      live.classList.remove('off'); live.lastChild.textContent = '실시간 좌석 · ' + r.now.slice(11) + ' 기준';
      S.data = r;
      if (!S.show || !showInfo(S.show)) {
        var first = r.shows.filter(function (s) { return s.open; })[0] || r.shows[0];
        S.show = first.id;
      }
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
    S.map.update({ occ: occ() });
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

  /* ---------- 인원 · 휠체어 이용 인원 ---------- */
  function setNeed(n) {
    S.need = Math.max(1, Math.min(maxN(), parseInt(n, 10) || 1));
    if (S.wheel > Math.min(3, S.need)) { S.wheel = Math.min(3, S.need); wheelSel.value = String(S.wheel); }
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
    wheelSel.querySelectorAll('option').forEach(function (o) { o.disabled = +o.value > S.need; });
  }
  party.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.set) setNeed(b.dataset.set);
    if (b.dataset.step) setNeed(S.need + +b.dataset.step);
  });
  nInput.addEventListener('change', function () { setNeed(nInput.value); });
  nInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); setNeed(nInput.value); nInput.blur(); } });
  wheelSel.addEventListener('change', function () { S.wheel = Math.min(+wheelSel.value || 0, S.need); renderBar(); });

  function partyText() { return S.need + '명' + (S.wheel ? ' (휠체어 ' + S.wheel + '명)' : ''); }
  function renderBar() {
    var ok = !!S.data && !notYet() && (showInfo(S.show) || {}).open;
    bar.classList.toggle('show', !!ok);
    if (!ok) return;
    U.$('.picked b', bar).textContent = R.dateLabel(S.show) + ' · ' + partyText();
    U.$('.picked span', bar).textContent = '좌석은 신청 순서대로 자동 배정돼요';
    S.map.redraw();
  }

  showsBox.addEventListener('click', function (e) {
    var b = e.target.closest('[data-show]');
    if (!b || b.disabled || b.dataset.show === S.show) return;
    S.show = b.dataset.show;
    render();
  });

  function tryApply() {
    if (!S.data) return;
    if (notYet()) { U.toast('좌석 예약은 ' + S.data.openAtLabel + '에 열려요. 그때 신청해 주세요.', true); return; }
    var info = showInfo(S.show);
    if (!info.open) { U.toast(info.closed ? '이 회차는 예약이 끝났어요.' : '지금은 예약을 받지 않아요.', true); return; }
    if (info.left < S.need) { U.toast('이 회차에 남은 좌석이 ' + info.left + '석이에요. 인원을 줄이거나 다른 회차를 골라 주세요.', true); return; }
    openForm();
  }
  document.querySelectorAll('[data-apply]').forEach(function (b) { b.addEventListener('click', tryApply); });

  /* ---------- 예약 신청 ---------- */
  var form = U.$('form', dlg);
  function panes(done) {
    dlg.querySelectorAll('.form-pane').forEach(function (p) { p.hidden = done; });
    dlg.querySelectorAll('.done-pane').forEach(function (p) { p.hidden = !done; });
  }
  function openForm() {
    if (!S.reqId) S.reqId = HOLDER + '-' + Date.now().toString(36);   // 같은 신청을 다시 보내도 한 번만 접수
    U.$('[data-pick]', dlg).innerHTML = '<b>' + esc(R.showLabel(S.show)) + '</b><span class="seats">' + esc(partyText()) + '</span>'
      + '<small>좌석은 신청을 마치는 순서대로 자동 배정돼요. 신청이 끝나면 배정된 좌석이 바로 보여요.</small>';
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

  function showAssigned(seats) {
    U.$('[data-seats]', dlg).innerHTML = R.seatGroups(seats).map(function (g) { return '<li><b>' + esc(g) + '</b></li>'; }).join('')
      + '<li><small>좌석마다 극장 안에서 찾아가는 길은 ‘내 예약 확인’과 확정 메일에 나와요.</small></li>';
    var host = U.$('[data-done-map]', dlg);
    host.innerHTML = '';
    var m = U.hall(host, { readonly: true, fit: true });
    m.update({ me: seats });
  }

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
      show: S.show, count: S.need, wheel: S.wheel, name: f.name.value, org: f.org.value, phone: f.phone.value, email: f.email.value,
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
        U.$('[data-what]', dlg).textContent = r.showLabel + ' · ' + r.seats.length + '명';
        U.$('[data-mail]', dlg).textContent = f.email.value.trim();
        showAssigned(r.seats);
        form.reset();
        form.querySelectorAll('input[name^="password"]').forEach(function (i) { i.type = 'password'; });
        S.t0 = Date.now();
        load();
        return;
      }
      if (r.code === 'invalid') { U.fieldErrors(form, r.errors); U.$('.rv-err', dlg).textContent = r.message; return; }
      if (r.code === 'full' || r.code === 'wheel') { U.$('.rv-err', dlg).textContent = r.message; load(); return; }
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
