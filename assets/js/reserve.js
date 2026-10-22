/* 좌석 예약 화면: 회차 고르기 → 좌석 고르기(실시간) → 예약 신청 */
(function () {
  'use strict';
  var R = window.RSV, U = window.RSVUI, esc = U.esc;
  var S = { data: null, show: null, sel: [], t0: Date.now(), map: null, busy: false };
  var POLL_MS = 5000;

  var showsBox = U.$('#rv-shows'), board = U.$('#rv-hall'), live = U.$('#rv-live'), bar = U.$('.rv-bar'), dlg = U.$('#rv-dlg');
  U.$('#rv-legend').innerHTML = U.legend('public');

  S.map = U.hall(board, { onPick: pick });

  function occ() { return (S.data && S.data.seats[S.show]) || {}; }
  function showInfo(id) { return S.data && S.data.shows.filter(function (s) { return s.id === id; })[0]; }

  function load() {
    return U.api('rsvState').then(function (r) {
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
      // 고른 좌석이 그사이 다른 분께 예약됐으면 빼기
      var o = occ(), lost = S.sel.filter(function (s) { return o[s]; });
      if (lost.length) {
        S.sel = S.sel.filter(function (s) { return !o[s]; });
        U.toast('고르신 ' + lost.join(', ') + ' 좌석이 방금 다른 분께 예약되었어요.', true);
        S.map.flash(lost);
      }
      render();
    });
  }

  function render() {
    var d = S.data;
    showsBox.innerHTML = d.shows.map(function (s) {
      var p = R.dateLabel(s.date);
      var left = s.closed ? '예약 마감' : !d.open ? '예약 중단' : s.left ? '남은 좌석 ' + s.left + '석' : '매진';
      return '<button type="button" class="rv-show" data-show="' + s.id + '" aria-pressed="' + (s.id === S.show) + '"' + (s.closed ? ' disabled' : '') + '>'
        + '<span class="d">' + esc(p) + '</span><span class="t">' + esc(R.timeLabel(s.time)) + ' 공연</span>'
        + '<span class="left">' + left + '</span></button>';
    }).join('');
    S.map.update({ occ: occ(), sel: S.sel });
    renderBar();
  }

  function renderBar() {
    var n = S.sel.length;
    bar.classList.toggle('show', n > 0);
    U.$('.picked b', bar).textContent = n ? R.dateLabel(S.show) + ' · ' + n + '석 선택' : '';
    U.$('.picked span', bar).textContent = S.sel.join(' · ');
  }

  showsBox.addEventListener('click', function (e) {
    var b = e.target.closest('[data-show]');
    if (!b || b.disabled || b.dataset.show === S.show) return;
    if (S.sel.length) U.toast('회차를 바꿔서 고른 좌석을 비웠어요.');
    S.show = b.dataset.show; S.sel = [];
    render();
  });

  function pick(id) {
    if (!S.data) return;
    var info = showInfo(S.show);
    if (!info.open) { U.toast(info.closed ? '이 회차는 예약이 끝났어요.' : '지금은 온라인 예약을 받지 않아요. ' + R.EVENT.phone + '으로 문의해 주세요.', true); return; }
    var i = S.sel.indexOf(id);
    if (i >= 0) S.sel.splice(i, 1);
    else {
      var code = occ()[id];
      if (code) { U.toast(code === 'w' ? '다른 분이 신청해서 승인 대기 중인 좌석이에요.' : '이미 예약된 좌석이에요.'); return; }
      if (S.sel.length >= S.data.max) { U.toast('한 번에 ' + S.data.max + '석까지 고를 수 있어요. 단체는 ' + R.EVENT.phone + '으로 문의해 주세요.', true); return; }
      S.sel.push(id);
      S.sel.sort(R.seatSort);
      if (R.WHEEL.indexOf(id) >= 0) U.toast('휠체어석이에요. 휠체어를 이용하는 관객만 골라 주세요.');
    }
    S.map.update({ occ: occ(), sel: S.sel });
    renderBar();
  }

  U.$('[data-clear]', bar).addEventListener('click', function () { S.sel = []; render(); });
  U.$('[data-apply]', bar).addEventListener('click', openForm);

  /* ---------- 예약 신청 ---------- */
  var form = U.$('form', dlg);
  function panes(done) {
    dlg.querySelectorAll('.form-pane').forEach(function (p) { p.hidden = done; });
    dlg.querySelectorAll('.done-pane').forEach(function (p) { p.hidden = !done; });
  }
  function openForm() {
    if (!S.sel.length) return;
    U.$('[data-pick]', dlg).innerHTML = '<b>' + esc(R.showLabel(S.show)) + '</b><span class="seats">' + esc(S.sel.map(R.seatName).join(', ')) + ' · ' + S.sel.length + '석</span>';
    panes(false);
    U.$('.rv-err', dlg).textContent = '';
    U.fieldErrors(form, {});
    dlg.showModal();
    setTimeout(function () { form.elements.name.focus(); }, 30);
  }
  U.$('.x', dlg).addEventListener('click', function () { dlg.close(); });
  U.$('[data-close]', dlg).addEventListener('click', function () { dlg.close(); });
  U.$('[data-done]', dlg).addEventListener('click', function () { dlg.close(); });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (S.busy) return;
    var f = form.elements, errs = {};
    if (f.password.value !== f.password2.value) errs.password2 = '비밀번호가 서로 달라요';
    if (Object.keys(errs).length) { U.fieldErrors(form, errs); return; }
    var btn = U.$('[type=submit]', form);
    S.busy = true; btn.disabled = true; btn.textContent = '보내는 중...';
    U.api('rsvBook', {
      show: S.show, seats: S.sel, name: f.name.value, org: f.org.value, phone: f.phone.value, email: f.email.value,
      password: f.password.value, note: f.note.value, consent: f.consent.checked, website: f.website.value, elapsed: Date.now() - S.t0
    }).then(function (r) {
      S.busy = false; btn.disabled = false; btn.textContent = '예약 신청하기';
      if (r.ok) {
        panes(true);
        U.$('[data-no]', dlg).textContent = r.id;
        U.$('[data-what]', dlg).textContent = r.showLabel + ' · ' + r.seats.map(R.seatName).join(', ') + ' (' + r.seats.length + '석)';
        U.$('[data-mail]', dlg).textContent = f.email.value.trim();
        form.reset();
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
        load().then(function () { S.map.flash(r.taken); });
        return;
      }
      U.$('.rv-err', dlg).textContent = r.message || '잠시 후 다시 시도해 주세요.';
    });
  });

  U.poll(load, POLL_MS);
})();
