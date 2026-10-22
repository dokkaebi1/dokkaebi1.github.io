/* 내 예약 확인 · 공연 당일 입장: 이메일 + 비밀번호로 들어와 좌석을 보고 '도착했어요'를 누릅니다 */
(function () {
  'use strict';
  var R = window.RSV, U = window.RSVUI, esc = U.esc;
  var KEY = 'jg-rsv-token';
  var S = { token: null, data: null, poller: null };
  var root = U.$('#my-root');

  function tokenGet() { try { return sessionStorage.getItem(KEY); } catch (e) { return S.token; } }
  function tokenSet(t) { S.token = t; try { if (t) sessionStorage.setItem(KEY, t); else sessionStorage.removeItem(KEY); } catch (e) {} }

  function loginView(msg, email) {
    tokenSet(null); S.data = null;
    root.innerHTML = '<div class="rv-card rv-login">'
      + '<div><span class="rv-eyebrow">좌석 예약</span><h2>내 예약 확인 · 입장</h2><p class="rv-sub" style="margin:6px 0 0">예약할 때 적은 이메일과 비밀번호를 넣어 주세요.</p></div>'
      + '<form novalidate style="display:grid;gap:14px">'
      + '<label class="rv-fld"><span>이메일</span><input name="email" type="email" inputmode="email" autocomplete="email" required></label>'
      + '<label class="rv-fld"><span>비밀번호</span><input name="password" type="password" autocomplete="current-password" required></label>'
      + '<label class="rv-show-pw"><input type="checkbox" data-showpw> 비밀번호 보이기</label>'
      + '<p class="rv-err" role="alert">' + esc(msg || '') + '</p>'
      + '<button class="rv-btn rv-btn-red rv-btn-wide" type="submit">예약 확인하기</button>'
      + '</form>'
      + '<button type="button" class="rv-link" data-forgot>비밀번호를 잊으셨나요? 비밀번호 찾기</button>'
      + '<p class="rv-sub" style="margin:0;font-size:15px">아직 예약하지 않으셨다면 <a href="seats.html">좌석 예약</a>으로 가세요. 문의 <a href="tel:' + R.EVENT.phone.replace(/-/g, '') + '">' + R.EVENT.phone + '</a></p>'
      + '</div>';
    var form = U.$('form', root);
    if (email) form.elements.email.value = email;
    (email ? form.elements.password : form.elements.email).focus();
    U.$('[data-forgot]', root).addEventListener('click', function () { forgotView(form.elements.email.value); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = U.$('button', form);
      btn.disabled = true;
      U.api('rsvLogin', { email: form.elements.email.value, password: form.elements.password.value }).then(function (r) {
        btn.disabled = false;
        if (!r.ok) { U.$('.rv-err', form).textContent = r.message; return; }
        loggedIn(r);
      });
    });
  }
  function loggedIn(r) {
    tokenSet(r.token);
    S.data = r;
    render();
    startPoll();
  }

  /* 비밀번호 찾기: ① 이메일 → 확인 번호 메일 ② 확인 번호 + 새 비밀번호 → 바로 들어감 */
  function forgotView(email) {
    root.innerHTML = '<div class="rv-card rv-login">'
      + '<div><span class="rv-eyebrow">비밀번호 찾기</span><h2>새 비밀번호 정하기</h2><p class="rv-sub" style="margin:6px 0 0">예약에 적힌 이메일로 6자리 확인 번호를 보내 드려요.</p></div>'
      + '<form data-step="1" novalidate style="display:grid;gap:14px">'
      + '<label class="rv-fld" data-by="email"><span>예약할 때 적은 이메일</span><input name="email" type="email" inputmode="email" autocomplete="email"></label>'
      + '<label class="rv-fld" data-by="phone" hidden><span>예약할 때 적은 휴대전화 번호</span><input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="010-1234-5678"></label>'
      + '<p class="rv-err" role="alert"></p>'
      + '<button class="rv-btn rv-btn-red rv-btn-wide" type="submit">확인 번호 받기</button>'
      + '<button type="button" class="rv-link" data-switch>이메일이 기억나지 않으면 · 휴대전화 번호로 찾기</button></form>'
      + '<form data-step="2" novalidate style="display:grid;gap:14px" hidden>'
      + '<p class="waitbox" style="margin:0" data-sent></p>'
      + '<label class="rv-fld"><span>확인 번호 (6자리)</span><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></label>'
      + '<label class="rv-fld"><span>새 비밀번호</span><input name="password" type="password" autocomplete="new-password" maxlength="30" required><small class="help">4자 이상</small></label>'
      + '<label class="rv-fld"><span>새 비밀번호 확인</span><input name="password2" type="password" autocomplete="new-password" maxlength="30" required></label>'
      + '<label class="rv-show-pw"><input type="checkbox" data-showpw> 비밀번호 보이기</label>'
      + '<p class="rv-err" role="alert"></p>'
      + '<button class="rv-btn rv-btn-red rv-btn-wide" type="submit">비밀번호 바꾸고 들어가기</button>'
      + '<button type="button" class="rv-link" data-again>확인 번호 다시 받기</button></form>'
      + '<button type="button" class="rv-link" data-back>← 로그인으로 돌아가기</button>'
      + '</div>';
    var f1 = U.$('form[data-step="1"]', root), f2 = U.$('form[data-step="2"]', root);
    if (email) f1.elements.email.value = email;
    f1.elements.email.focus();
    U.$('[data-back]', root).addEventListener('click', function () { loginView('', f1.elements.email.value); });
    U.$('[data-again]', root).addEventListener('click', function () { f2.hidden = true; f1.hidden = false; f1.elements.email.focus(); });
    var byPhone = false;
    U.$('[data-switch]', root).addEventListener('click', function () {
      byPhone = !byPhone;
      U.$('[data-by="email"]', f1).hidden = byPhone; U.$('[data-by="phone"]', f1).hidden = !byPhone;
      this.textContent = byPhone ? '이메일로 찾기' : '이메일이 기억나지 않으면 · 휴대전화 번호로 찾기';
      U.$('.rv-err', f1).textContent = '';
      (byPhone ? f1.elements.phone : f1.elements.email).focus();
    });
    f1.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = U.$('button', f1); btn.disabled = true;
      U.api('rsvForgot', byPhone ? { phone: f1.elements.phone.value } : { email: f1.elements.email.value }).then(function (r) {
        btn.disabled = false;
        if (!r.ok) { U.fieldErrors(f1, r.errors); U.$('.rv-err', f1).textContent = r.message; return; }
        f1.hidden = true; f2.hidden = false;
        U.$('[data-sent]', f2).textContent = '예약에 적힌 이메일 ' + r.sentTo + '으로 확인 번호를 보냈어요. 메일이 안 보이면 스팸함도 확인해 주세요.'
          + (r.byPhone ? ' 이 주소가 내 이메일이 아니면 예약할 때 이메일을 잘못 적은 거예요. ' + R.EVENT.phone + '로 연락 주시면 고쳐 드려요.' : '');
        f2.elements.code.focus();
      });
    });
    f2.addEventListener('submit', function (e) {
      e.preventDefault();
      if (f2.elements.password.value !== f2.elements.password2.value) { U.fieldErrors(f2, { password2: '새 비밀번호가 서로 달라요' }); return; }
      var btn = U.$('[type=submit]', f2); btn.disabled = true;
      U.api('rsvReset', { email: byPhone ? '' : f1.elements.email.value, phone: byPhone ? f1.elements.phone.value : '', code: f2.elements.code.value, password: f2.elements.password.value }).then(function (r) {
        btn.disabled = false;
        if (!r.ok) { U.fieldErrors(f2, r.errors); U.$('.rv-err', f2).textContent = r.message; return; }
        U.toast('비밀번호를 바꿨어요. 다음부터 새 비밀번호로 들어오세요.');
        loggedIn(r);
      });
    });
  }
  root.addEventListener('change', function (e) {
    if (!e.target.hasAttribute('data-showpw')) return;
    e.target.closest('form').querySelectorAll('input[name^="password"]').forEach(function (i) { i.type = e.target.checked ? 'text' : 'password'; });
  });

  function refresh() {
    if (!S.token) return Promise.resolve();
    return U.api('rsvMine', { token: S.token }).then(function (r) {
      if (!r.ok) { if (r.code === 'auth') loginView('로그인 시간이 지났어요. 다시 넣어 주세요.'); return; }
      // 예약 내용뿐 아니라 날짜·도착 시험 모드가 바뀌어도 다시 그림 (도착 버튼이 바로 눌리게)
      var key = function (d) { return d ? JSON.stringify([d.list, d.today, !!d.arriveTest]) : ''; };
      var before = key(S.data), after = key(r);
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
    if (x.status === R.ST.NO) return '<div class="mutebox">이번에는 예약이 확정되지 않았어요. 다른 좌석이나 회차로 <a href="seats.html">다시 신청</a>할 수 있어요.</div>';
    if (x.status === R.ST.CANCEL) return '<div class="mutebox">취소된 예약이에요.</div>';
    if (x.arrivedAt) return '<div class="arrived"><span class="ic">✓</span><b>도착 확인 완료' + (x.testArrival ? ' (시험)' : '') + '</b><span>' + esc(x.arrivedAt.slice(11)) + ' 도착 · ' + (x.testArrival ? '시험 모드가 끝나면 다시 ‘도착 전’으로 돌아가요' : '입구 안내 직원에게 이 화면을 보여 주세요') + '</span></div>';
    var test = S.data && S.data.arriveTest && today < x.show;
    if (today === x.show || test) return '<button type="button" class="rv-btn rv-btn-ok rv-btn-wide rv-btn-big" data-arrive="' + esc(x.id) + '">공연장에 도착했어요</button>'
      + '<p class="rv-center">' + (test ? '지금은 <b>도착 확인 시험 중</b>이라 공연 전에도 눌러 볼 수 있어요. 담당자 화면에 바로 표시돼요.' : '극장에 도착한 뒤에 눌러 주세요. 담당자 화면에 바로 표시돼요.') + '</p>';
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
    html += '<p class="rv-sub" style="margin-top:22px">문의 <a href="tel:' + R.EVENT.phone.replace(/-/g, '') + '">' + R.EVENT.phone + '</a> · 공연 10~15분 전까지 도착해 주세요.</p>';
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
