/* 좌석 예약 화면: 회차 고르기 → 인원(휠체어 이용 인원) 정하기 → 예약 신청 → 배정된 좌석 보기
   - 좌석은 손님이 고르지 않고 서버가 신청 순서대로 자동 배정합니다 (규칙: reserve-core.js assignSeats)
   - 예약 오픈 전(기본 11월 4일 오전 10시)에는 좌석 현황만 보여 주고 남은 시간을 셉니다 (서버 시계 기준)
   - 신청마다 요청번호(reqId)를 붙임: 회차·인원·휠체어·연락처가 같으면 같은 번호 → 응답을 못 받고 다시 보내도 한 번만 접수.
     보낸 뒤 답을 못 받은 신청은 이 탭에 기억해 두고(sessionStorage), 내용을 바꾸거나 새로고침하면 먼저 접수됐는지 서버에 물어봄 */
(function () {
  'use strict';
  var R = window.RSV, U = window.RSVUI, esc = U.esc;
  var S = { data: null, show: null, need: 1, wheel: 0, t0: Date.now(), map: null, busy: false, centered: false, skew: 0 };
  var PEND = 'dk-rsv-pending';   // 보냈지만 답을 못 받은 신청 { reqId, key }
  var POLL_MS = 5000;
  /* 이 화면(브라우저 탭)의 이름표: 요청번호 앞부분에 씀 */
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
  function now() { return Date.now() + S.skew; }   // 서버 시계 (기기 시계가 빠르거나 늦어도 오픈 시각은 서버 기준)
  function notYet() { return !!(S.data && S.data.notYet) && now() < openMs(); }
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
      if (r.ms) S.skew = r.ms - Date.now();
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
      var cnt = '일반석 ' + s.leftGen + '석' + (s.leftWheel ? ' · 휠체어석 ' + s.leftWheel + '석' : '');
      var left = s.closed ? '예약 마감' : wait ? '빈 좌석 ' + cnt : !d.open ? '예약 중단' : s.left ? '남은 좌석 ' + cnt : '매진';
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
    var ms = openMs() - now(), d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5), m = Math.floor(ms % 36e5 / 6e4), s = Math.floor(ms % 6e4 / 1e3);
    U.$('[data-open-at]', openBox).textContent = S.data.openAtLabel;
    U.$('[data-open-left]', openBox).textContent = d > 0 ? d + '일 ' + h + '시간 ' + m + '분' : h + '시간 ' + m + '분 ' + s + '초';
  }
  setInterval(function () {
    if (!S.data || !S.data.notYet) return;
    if (now() >= openMs()) { S.data.notYet = false; load(); } else renderOpen();
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
    if (info.leftGen < S.need - S.wheel) { U.toast('이 회차에 남은 일반석이 ' + info.leftGen + '석이에요. 인원을 줄이거나 다른 회차를 골라 주세요.', true); return; }
    if (info.leftWheel < S.wheel) { U.toast('이 회차에 남은 휠체어석이 ' + info.leftWheel + '석이에요. 휠체어 이용 인원을 확인해 주세요.', true); return; }
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

  /* ---------- 요청번호 · 답을 못 받은 신청 ---------- */
  function pendGet() { try { return JSON.parse(sessionStorage.getItem(PEND) || 'null'); } catch (e) { return null; } }
  function pendSet(v) { try { if (v) sessionStorage.setItem(PEND, JSON.stringify(v)); else sessionStorage.removeItem(PEND); } catch (e) {} }
  /* 신청 내용 지문 (비밀번호는 그대로 두지 않고 짧은 해시만) — 하나라도 바뀌면 새 요청번호 */
  function hash(t) { var h = 5381; for (var i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  function contentKey(f) {
    return [S.show, S.need, S.wheel, f.phone.value.replace(/\D/g, ''), f.email.value.trim().toLowerCase(),
      hash([f.name.value.trim(), f.org.value.trim(), f.note.value.trim(), f.password.value].join('\u0001'))].join('|');
  }
  function newReqId() {
    var a = new Uint8Array(6); (window.crypto || window.msCrypto).getRandomValues(a);
    return HOLDER + '-' + Date.now().toString(36) + Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  /* 앞서 답을 못 받은 신청이 서버에 접수됐는지 물어봄 → 접수됐으면 그 결과, 없으면 null.
     '아직 없음'은 '접수 안 됨'이 아닐 수 있음(서버가 아직 처리 중) → 보낸 지 7분(서버 한 번 실행의 최대 6분 + 여유)이 안 됐으면 { wait: true }.
     보낸 시각이 없는 예전 기록은 지금부터 셈 */
  var PEND_WAIT = 420000;
  function checkPending() {
    var p = pendGet();
    if (!p) return Promise.resolve(null);
    if (!p.at) { p.at = Date.now(); pendSet(p); }
    return U.api('rsvBookStatus', { reqId: p.reqId }).then(function (r) {
      if (!r.ok) return Promise.reject(r);
      if (r.found) { pendSet(null); return r; }
      if (Date.now() - (p.at || 0) < PEND_WAIT) return { wait: true };
      pendSet(null);
      return null;
    });
  }
  /* 완료창: 서버가 돌려준 상태 그대로 보여 줌 (승인 대기 · 확정 · 취소/거절) */
  var DONE = {};
  DONE[R.ST.WAIT] = ['예약 신청을 받았어요', 'wait', '승인 대기'];
  DONE[R.ST.OK] = ['예약이 확정됐어요', 'ok', '예약 확정'];
  DONE[R.ST.CANCEL] = ['이 신청은 취소된 예약이에요', 'no', '취소'];
  DONE[R.ST.NO] = ['이 신청은 확정되지 않았어요', 'no', '거절'];
  function showDone(r, email) {
    panes(true);
    var d = DONE[r.status] || DONE[R.ST.WAIT], live = r.status === R.ST.WAIT || r.status === R.ST.OK;
    U.$('.done-pane h3', dlg).textContent = d[0];
    var badge = U.$('[data-st]', dlg); badge.className = 'st-badge ' + d[1]; badge.textContent = d[2];
    U.$('.rv-assigned', dlg).hidden = !live;
    U.$('[data-done-dead]', dlg).hidden = live;
    U.$('[data-done-live]', dlg).hidden = !live;   // 공연 당일 도착 안내는 살아 있는 예약에만
    U.$('[data-mail-ok]', dlg).hidden = !live || r.mailed !== true;     // 보낸 것이 확인된 때만 '보냈어요'
    U.$('[data-mail-fail]', dlg).hidden = !live || r.mailed !== false;
    U.$('[data-mail-unknown]', dlg).hidden = !live || r.mailed === true || r.mailed === false;
    U.$('[data-no]', dlg).textContent = r.id;
    U.$('[data-what]', dlg).textContent = r.showLabel + ' · ' + r.seats.length + '명' + (r.again ? ' (앞서 보낸 신청)' : '');
    U.$('[data-mail]', dlg).textContent = email || '';
    showAssigned(r.seats);
    if (!dlg.open) dlg.showModal();
    setTimeout(function () { U.$('.done-pane h3', dlg).focus(); }, 30);
  }

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
    // 보내기 전에 빈 칸·형식 먼저 확인 (서버도 같은 규칙으로 다시 확인)
    var digits = f.phone.value.replace(/\D/g, '');
    if (!f.name.value.trim()) errs.name = '예약자 성함을 적어 주세요';
    if (!f.phone.value.trim()) errs.phone = '연락처를 적어 주세요';
    else if (!/^[\d\s()+-]+$/.test(f.phone.value.trim()) || digits.length < 9 || digits.length > 12) errs.phone = '전화번호를 확인해 주세요 (예: 010-1234-5678)';
    if (!f.email.value.trim()) errs.email = '확정 메일을 받을 이메일을 적어 주세요';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.value.trim())) errs.email = '이메일 주소를 확인해 주세요';
    if (f.password.value.length < 4 || f.password.value.length > 30) errs.password = '비밀번호는 4~30자로 정해 주세요';
    if (!f.consent.checked) errs.consent = '개인정보 수집·이용에 동의해 주세요';
    if (Object.keys(errs).length) { U.fieldErrors(form, errs); U.$('.rv-err', dlg).textContent = '입력한 내용을 확인해 주세요.'; return; }
    var btn = U.$('[type=submit]', form), err = U.$('.rv-err', dlg);
    function idle() { S.busy = false; btn.disabled = false; btn.textContent = '예약 신청하기'; }
    S.busy = true; btn.disabled = true; btn.textContent = '보내는 중...';
    err.textContent = '';
    var key = contentKey(f), p = pendGet();
    // 앞서 답을 못 받은 신청이 있으면: 같은 내용이면 같은 요청번호로 다시, 내용이 바뀌었으면 먼저 접수됐는지 확인
    var ready = p && p.key === key ? Promise.resolve(p.reqId)
      : checkPending().then(function (prev) {
        if (prev && prev.wait) { idle(); err.innerHTML = '앞서 보낸 신청이 접수됐는지 아직 확인 중이에요. 1~2분 뒤 다시 눌러 주시거나 <a href="my.html" target="_blank">내 예약 확인</a>을 먼저 봐 주세요.'; return null; }
        if (prev) { idle(); showDone(prev, ''); U.toast('앞서 보낸 신청이 이미 접수돼 있어요. 바꾸려면 담당자에게 연락해 주세요.', true); return null; }
        return newReqId();
      }, function () { return Promise.reject({ ok: false, code: 'network' }); });
    ready.then(function (reqId) {
      if (!reqId) return;
      pendSet({ reqId: reqId, key: key, at: (pendGet() || {}).reqId === reqId ? pendGet().at : Date.now() });
      var body = {
        v: R.API_V, show: S.show, count: S.need, wheel: S.wheel, name: f.name.value, org: f.org.value, phone: f.phone.value, email: f.email.value,
        password: f.password.value, note: f.note.value, consent: f.consent.checked, website: f.website.value, elapsed: Date.now() - S.t0, reqId: reqId
      };
      function send(tries) {   // 응답이 없으면 같은 요청번호로 한 번 더 (서버가 이미 받았으면 그 결과가 돌아옴)
        return U.api('rsvBook', body).then(function (r) {
          if ((r.code === 'timeout' || r.code === 'network') && tries < 1) { btn.textContent = '접수됐는지 확인하는 중...'; return new Promise(function (ok) { setTimeout(ok, 2500); }).then(function () { return send(tries + 1); }); }
          return r;
        });
      }
      return send(0).then(function (r) {
        idle();
        // 결과가 분명할 때만 요청번호를 잊음. 응답 없음·저장 확인 못 함(unsure)·서버 오류는 같은 요청번호를 그대로 둠 (다시 누르면 이어서 처리)
        var unsure = r.code === 'timeout' || r.code === 'network' || r.code === 'unsure' || r.code === 'server';
        if (!unsure) pendSet(null);
        if (r.ok) {
          showDone(r, f.email.value.trim());
          form.reset();
          form.querySelectorAll('input[name^="password"]').forEach(function (i) { i.type = 'password'; });
          S.t0 = Date.now();
          load();
          return;
        }
        if (r.code === 'invalid') { U.fieldErrors(form, r.errors); err.textContent = r.message; return; }
        if (r.code === 'full' || r.code === 'wheel') { err.textContent = r.message; load(); return; }
        if (r.code === 'unsure' || r.code === 'server') { err.textContent = (r.message || '잠시 문제가 생겼어요.') + (r.code === 'server' ? ' 내용을 바꾸지 말고 다시 눌러도 두 번 접수되지 않아요.' : ''); return; }
        if (r.code === 'timeout' || r.code === 'network') {
          err.innerHTML = '서버 응답을 받지 못했어요. 이미 접수됐을 수 있으니 <a href="my.html" target="_blank">내 예약 확인</a>에서 먼저 확인해 주세요. 내용을 바꾸지 않고 다시 ‘예약 신청하기’를 눌러도 두 번 접수되지 않아요.';
          return;
        }
        if (r.code === 'old') { err.innerHTML = esc(r.message) + ' <button type="button" class="rv-link" onclick="location.reload()">새로고침</button>'; return; }
        if (r.code === 'dup' || r.code === 'reqchanged') { err.innerHTML = esc(r.message) + ' <a href="my.html" target="_blank">내 예약 확인 열기</a>'; return; }
        err.textContent = r.message || '잠시 후 다시 시도해 주세요.';
      });
    }).catch(function () {
      idle();
      err.textContent = '연결이 잠시 원활하지 않아요. 잠시 후 다시 ‘예약 신청하기’를 눌러 주세요.';
    });
  });

  // 새로고침·다시 들어왔을 때: 답을 못 받은 신청이 있으면 접수됐는지 먼저 확인해서 보여 줌
  if (pendGet()) checkPending().then(function (prev) { if (prev && !prev.wait) showDone(prev, ''); }, function () {});

  U.poll(load, POLL_MS);
})();
