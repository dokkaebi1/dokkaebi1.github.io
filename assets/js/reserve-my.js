/* 내 예약 확인 · 공연 당일 입장: 이메일 + 비밀번호로 들어와 좌석을 보고 '도착했어요'를 누릅니다 */
(function () {
  'use strict';
  var R = window.RSV, U = window.RSVUI, esc = U.esc;
  var KEY = 'jg-rsv-token';
  var S = { token: null, data: null, poller: null };
  var root = U.$('#my-root');

  function tokenGet() { try { return sessionStorage.getItem(KEY); } catch (e) { return S.token; } }
  function tokenSet(t) { S.token = t; try { if (t) sessionStorage.setItem(KEY, t); else sessionStorage.removeItem(KEY); } catch (e) {} }

  function loginView(msg) {
    tokenSet(null); S.data = null;
    root.innerHTML = '<div class="rv-card rv-login">'
      + '<div><span class="rv-eyebrow">좌석 예약</span><h2>내 예약 확인 · 입장</h2><p class="rv-sub" style="margin:6px 0 0">예약할 때 적은 이메일과 비밀번호를 넣어 주세요.</p></div>'
      + '<form novalidate style="display:grid;gap:14px">'
      + '<label class="rv-fld"><span>이메일</span><input name="email" type="email" inputmode="email" autocomplete="email" required></label>'
      + '<label class="rv-fld"><span>비밀번호</span><input name="password" type="password" autocomplete="current-password" required></label>'
      + '<p class="rv-err" role="alert">' + esc(msg || '') + '</p>'
      + '<button class="rv-btn rv-btn-red rv-btn-wide" type="submit">예약 확인하기</button>'
      + '</form>'
      + '<p class="rv-sub" style="margin:0;font-size:15px">비밀번호를 잊으셨으면 <a href="tel:01085841753">010-8584-1753</a>으로 연락 주세요. 아직 예약하지 않으셨다면 <a href="./">좌석 예약</a>으로 가세요.</p>'
      + '</div>';
    var form = U.$('form', root);
    form.elements.email.focus();
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = U.$('button', form);
      btn.disabled = true;
      U.api('rsvLogin', { email: form.elements.email.value, password: form.elements.password.value }).then(function (r) {
        btn.disabled = false;
        if (!r.ok) { U.$('.rv-err', form).textContent = r.message; return; }
        tokenSet(r.token);
        S.data = r;
        render();
        startPoll();
      });
    });
  }

  function refresh() {
    if (!S.token) return Promise.resolve();
    return U.api('rsvMine', { token: S.token }).then(function (r) {
      if (!r.ok) { if (r.code === 'auth') loginView('로그인 시간이 지났어요. 다시 넣어 주세요.'); return; }
      var before = JSON.stringify(S.data && S.data.list), after = JSON.stringify(r.list);
      if (S.data && before !== after) {
        var was = {}; S.data.list.forEach(function (x) { was[x.id] = x.status; });
        r.list.forEach(function (x) { if (was[x.id] && was[x.id] !== x.status && x.status === R.ST.OK) U.toast('예약이 확정되었어요!'); });
      }
      S.data = r;
      if (before !== after) render();
    });
  }
  function startPoll() { if (!S.poller) S.poller = U.poll(refresh, 15000); }

  function statusBox(x, today) {
    if (x.status === R.ST.WAIT) return '<div class="waitbox">담당자가 확인하고 있어요. 확정되면 메일로 알려 드려요.</div>';
    if (x.status === R.ST.NO) return '<div class="mutebox">이번에는 예약이 확정되지 않았어요. 다른 좌석이나 회차로 <a href="./">다시 신청</a>할 수 있어요.</div>';
    if (x.status === R.ST.CANCEL) return '<div class="mutebox">취소된 예약이에요.</div>';
    if (x.arrivedAt) return '<div class="arrived"><span class="ic">✓</span><b>도착 확인 완료</b><span>' + esc(x.arrivedAt.slice(11)) + ' 도착 · 입구 안내 직원에게 이 화면을 보여 주세요</span></div>';
    if (today === x.show) return '<button type="button" class="rv-btn rv-btn-ok rv-btn-wide rv-btn-big" data-arrive="' + esc(x.id) + '">공연장에 도착했어요</button>'
      + '<p class="rv-center">극장에 도착한 뒤에 눌러 주세요. 담당자 화면에 바로 표시돼요.</p>';
    if (today > x.show) return '<div class="mutebox">지난 공연이에요. 관람해 주셔서 고맙습니다.</div>';
    return '<button type="button" class="rv-btn rv-btn-ok rv-btn-wide rv-btn-big" disabled>공연장에 도착했어요</button>'
      + '<p class="rv-center">공연 당일(' + esc(R.dateLabel(x.show)) + ') 극장에 도착하면 누를 수 있어요.</p>';
  }
  function badge(x) {
    if (x.status === R.ST.OK && x.arrivedAt) return '<span class="st-badge arr">✓ 도착</span>';
    var cls = { '승인 대기': 'wait', '확정': 'ok', '거절': 'no', '취소': 'no' }[x.status] || 'no';
    return '<span class="st-badge ' + cls + '">' + esc(x.status === R.ST.OK ? '예약 확정' : x.status) + '</span>';
  }

  function render() {
    var d = S.data, today = d.today;
    var list = d.list.slice().sort(function (a, b) { return a.show < b.show ? -1 : a.show > b.show ? 1 : 0; });
    var html = '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:18px;flex-wrap:wrap">'
      + '<h2 class="rv-h2" style="margin:0">내 예약 ' + list.length + '건</h2>'
      + '<button type="button" class="rv-btn rv-btn-line rv-btn-sm" data-logout>나가기</button></div>';
    html += list.map(function (x) {
      var active = x.status === R.ST.OK || x.status === R.ST.WAIT;
      return '<article class="ticket" data-id="' + esc(x.id) + '">'
        + '<div class="top">' + badge(x)
        + '<div class="ttl">' + esc(R.EVENT.series) + ' 〈' + esc(R.EVENT.title) + '〉</div>'
        + '<div class="when">' + esc(x.showLabel) + '</div>'
        + '<div class="where">' + esc(R.EVENT.venue) + ' · ' + esc(R.EVENT.address) + '</div></div>'
        + '<div class="seatbig"><small>내 좌석 ' + x.seats.length + '석 · 극장 안에서 이렇게 찾아가세요</small><ul class="seatlist">'
        + x.seats.map(function (s) { return '<li><span class="code">' + esc(s) + '</span><span><span class="nm">' + esc(R.seatName(s)) + '</span><span class="wh">' + esc(R.seatWhere(s)) + '</span></span></li>'; }).join('')
        + '</ul></div>'
        + '<div class="mid">' + statusBox(x, today)
        + (active ? '<div class="mini"><div class="rv-scroll" style="padding:4px 0"><div data-mini="' + esc(x.id) + '"></div></div>' + U.legend('mine') + '</div>' : '')
        + '</div>'
        + '<div class="bot"><div class="meta"><span>예약번호 <b>' + esc(x.id) + '</b></span><span>예약자 ' + esc(x.name) + (x.org ? ' · ' + esc(x.org) : '') + '</span><span>신청 ' + esc(x.createdAt) + '</span></div>'
        + (active && today < x.show ? '<button type="button" class="rv-link" data-cancel="' + esc(x.id) + '">예약 취소하기</button>' : '')
        + '</div></article>';
    }).join('');
    html += '<p class="rv-sub" style="margin-top:22px">문의 <a href="tel:01085841753">010-8584-1753</a> · 공연 10~15분 전까지 도착해 주세요.</p>';
    root.innerHTML = html;
    list.forEach(function (x) {
      var host = root.querySelector('[data-mini="' + x.id + '"]');
      if (!host) return;
      var m = U.hall(host, { readonly: true });
      m.update({ me: x.seats });
      requestAnimationFrame(function () { m.scrollTo(x.seats[0]); });
    });
  }

  root.addEventListener('click', function (e) {
    var a = e.target.closest('[data-arrive]'), c = e.target.closest('[data-cancel]'), out = e.target.closest('[data-logout]');
    if (out) { loginView(); return; }
    if (a) {
      U.confirm('도착하셨나요?', '안데르센극장에 도착했을 때 눌러 주세요.\n담당자 화면에 도착으로 표시돼요.', '네, 도착했어요').then(function (yes) {
        if (!yes) return;
        a.disabled = true;
        U.api('rsvArrive', { token: S.token, id: a.dataset.arrive }).then(function (r) {
          if (!r.ok) { a.disabled = false; U.toast(r.message, true); if (r.code === 'auth') loginView(r.message); return; }
          U.toast('도착을 알렸어요. 즐거운 관람 되세요!');
          refresh();
        });
      });
    }
    if (c) {
      U.confirm('예약을 취소할까요?', '취소하면 좌석이 다른 분께 열려요. 되돌릴 수 없어요.', '예약 취소', true).then(function (yes) {
        if (!yes) return;
        U.api('rsvCancel', { token: S.token, id: c.dataset.cancel }).then(function (r) {
          if (!r.ok) { U.toast(r.message, true); return; }
          U.toast('예약을 취소했어요.');
          refresh();
        });
      });
    }
  });

  var t = tokenGet();
  if (t) {
    S.token = t;
    root.innerHTML = '<p class="rv-sub">예약을 불러오는 중이에요...</p>';
    U.api('rsvMine', { token: t }).then(function (r) {
      if (!r.ok) { loginView(r.code === 'auth' ? '' : r.message); return; }
      S.data = r; render(); startPoll();
    });
  } else loginView();
})();
