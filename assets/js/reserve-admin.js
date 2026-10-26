/* 좌석 예약 관리: 신청 승인 · 좌석 배치도(막기·전화 예약 등록) · 공연 당일 입장(도착) · 설정
   들어오는 법: ① 이 화면에서 아이디·비밀번호 (6시간)
              ② 관리자(구글 로그인) → '좌석 예약 관리' → 관리 열쇠(6시간)가 주소(#k=...)로 넘어옴 */
(function () {
  'use strict';
  var R = window.RSV, U = window.RSVUI, esc = U.esc;
  var KEY = 'dk-rsv-admin';
  var ENTRY = (document.querySelector('meta[name="dokkaebi-rsv-admin"]') || {}).content || '';
  var S = { gen: 0, busy: {}, sel: {}, poller: null, token: null, data: null, tab: 'list', show: 'all', filter: '승인 대기', q: '', pick: [], focus: null, gate: null, seenWait: null, pending: false, map: null, mapShow: null };
  var root = U.$('#ad-root');
  var TITLE = document.title;

  /* ---------- 열쇠 ---------- */
  var m = /[#&]k=([a-f0-9]{32,})/.exec(location.hash);
  if (m) { try { sessionStorage.setItem(KEY, m[1]); } catch (e) {} S.token = m[1]; history.replaceState(null, '', location.pathname); }
  else { try { S.token = sessionStorage.getItem(KEY); } catch (e) {} }

  function locked(msg) {
    S.gen++;   // 이 전에 보낸 요청의 응답은 버림 (예약자 정보가 다시 그려지지 않게)
    try { sessionStorage.removeItem(KEY); } catch (e) {}
    S.token = null; S.data = null; S.busy = {};
    document.title = TITLE;
    root.innerHTML = '<div class="rv-card rv-login" style="margin-top:20px"><span class="rv-eyebrow">관리자</span><h2>좌석 예약 관리</h2>'
      + '<form data-login novalidate style="display:grid;gap:14px">'
      + '<label class="rv-fld"><span>아이디</span><input name="id" autocomplete="username" autocapitalize="off" spellcheck="false" required></label>'
      + '<label class="rv-fld"><span>비밀번호</span><input name="password" type="password" autocomplete="current-password" required></label>'
      + '<p class="rv-err" role="alert">' + esc(msg || '') + '</p>'
      + '<button class="rv-btn rv-btn-red rv-btn-wide" type="submit">들어가기</button></form>'
      + '<button type="button" class="rv-link" data-adm-forgot>비밀번호를 잊으셨나요? 확인 번호 메일 받기</button>'
      + '<form data-adm-reset novalidate style="display:grid;gap:14px" hidden>'
      + '<p class="waitbox" style="margin:0" data-sent></p>'
      + '<label class="rv-fld"><span>확인 번호 (6자리)</span><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></label>'
      + '<label class="rv-fld"><span>새 비밀번호</span><input name="password" type="password" autocomplete="new-password"></label>'
      + '<label class="rv-fld"><span>새 비밀번호 확인</span><input name="password2" type="password" autocomplete="new-password"></label>'
      + '<p class="rv-err" role="alert"></p>'
      + '<button class="rv-btn rv-btn-ink rv-btn-wide" type="submit">비밀번호 바꾸고 들어가기</button></form>'
      + '<p class="rv-sub" style="margin:0;font-size:14px">한 번 들어오면 6시간 동안 쓸 수 있어요. 비밀번호를 5번 틀리면 15분 동안 잠겨요. 다 쓰면 오른쪽 위 ‘로그아웃’을 눌러 주세요.</p>'
      + (ENTRY ? '<p class="rv-sub" style="margin:0;font-size:14px">극단 도깨비 구글 계정이 있으면 <a href="' + esc(ENTRY) + '">구글 로그인으로 들어가기</a></p>' : '')
      + '</div>';
    var f = U.$('form[data-login]', root);
    if (f) f.elements.id.focus();
  }
  function start() {
    root.innerHTML = '<p class="rv-sub">불러오는 중이에요...</p>';
    if (S.poller) S.poller.now(); else S.poller = U.poll(load, 10000);
  }
  /* 관리자 요청: 보낼 때의 로그인(세대·열쇠)이 그대로일 때만 응답을 씀.
     로그아웃했거나 다시 로그인한 뒤 늦게 온 응답(옛 열쇠의 '로그인 필요' 포함)은 버림 */
  function callApi(action, data) { return call(action, data); }
  function call(action, data) {
    var g = S.gen, t = S.token;
    return U.api(action, Object.assign({ token: t }, data || {})).then(function (r) {
      if (g !== S.gen || t !== S.token) throw { ok: false, code: 'stale' };
      // 아이디·비밀번호를 바꾸는 중이면, 옛 열쇠로 보낸 다른 요청의 '로그인 필요'는 무시 (곧 새 열쇠로 바뀜)
      if (r && r.code === 'auth' && S.credChanging && action !== 'rsvAdminCred') throw { ok: false, code: 'stale' };
      if (r && r.code === 'auth') { locked('로그인 시간이 지났어요. 다시 들어와 주세요.'); throw r; }
      return r;
    });
  }

  /* ---------- 불러오기 (10초마다) ---------- */
  function load() {
    if (!S.token) return Promise.resolve();
    return call('rsvAdmin').then(function (r) {
      var live = U.$('#ad-live');
      if (!r.ok) { if (live) { live.classList.add('off'); live.lastChild.textContent = '연결이 잠시 끊겼어요'; } return; }
      // 좌석이 그대로인 변경(메일 기록 등)은 버전이 안 바뀌므로 목록 내용도 비교
      var changed = !S.data || S.data.ver !== r.ver || S.data.today !== r.today || JSON.stringify(S.data.list) !== JSON.stringify(r.list);
      var waits = r.list.filter(function (x) { return x.status === R.ST.WAIT; }).map(function (x) { return x.id; });
      if (S.seenWait) {
        var fresh = waits.filter(function (id) { return S.seenWait.indexOf(id) < 0; });
        if (fresh.length) U.toast('새 예약 신청 ' + fresh.length + '건이 들어왔어요.');
      }
      S.seenWait = waits;
      document.title = (waits.length ? '(' + waits.length + ') ' : '') + TITLE;
      if (!S.data && r.today >= R.EVENT.shows[0].id) {
        var t = R.EVENT.shows.filter(function (s) { return s.id >= r.today; })[0];
        if (t) { S.tab = 'gate'; S.gate = t.id; }
      }
      S.data = r;
      if (!U.$('#ad-live')) frame();
      live = U.$('#ad-live');
      live.classList.remove('off'); live.lastChild.textContent = '실시간 · ' + r.now.slice(11) + ' 기준';
      if (changed) render();
    }).catch(function () {});
  }

  /* ---------- 틀 ---------- */
  function frame() {
    root.innerHTML = '<div class="ad-top"><div><span class="rv-eyebrow">관리자</span><h1 class="rv-h2" style="margin:6px 0 0">좌석 예약 관리</h1>'
      + '<p class="rv-sub" style="margin:4px 0 0">' + esc(R.EVENT.series) + ' 〈' + esc(R.EVENT.title) + '〉 · ' + esc(R.EVENT.venue) + '</p></div>'
      + '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span class="rv-live" id="ad-live"><i></i><span>불러오는 중</span></span>'
      + '<button type="button" class="rv-btn rv-btn-line rv-btn-sm" data-logout>로그아웃</button></div></div>'
      + '<div class="ad-tabs" role="tablist">'
      + [['list', '신청 관리'], ['map', '좌석 배치도'], ['gate', '당일 입장'], ['set', '설정']].map(function (t) {
        return '<button type="button" role="tab" data-tab="' + t[0] + '">' + t[1] + '<b data-cnt="' + t[0] + '"></b></button>';
      }).join('') + '</div><div id="ad-body"></div>';
  }

  /* 손님 자동 배정에 쓸 수 있는 남은 좌석 (일반석 · 휠체어석) */
  function leftNote(show) {
    var x = (S.data.shows || []).filter(function (s) { return s.id === show; })[0];
    return x && x.leftGen != null ? ' · 손님 배정 가능: 일반석 ' + x.leftGen + ' · 휠체어석 ' + x.leftWheel : '';
  }
  /* '보내는 중'으로 5분 넘게 결과가 없는 메일 (막 신청한 것은 아직 보내는 중일 수 있어 5분 기다림) */
  function stuck(x) {
    if (!x.mailPending || !S.data) return false;
    var t = Date.parse(x.mailPending.replace(' ', 'T') + ':00+09:00'), n = Date.parse(S.data.now.replace(' ', 'T') + ':00+09:00');
    return !isNaN(t) && !isNaN(n) && n - t >= 5 * 60000;
  }
  function stats(show) {
    var o = { wait: 0, ok: 0, block: 0, arr: 0, okN: 0, arrN: 0 };
    S.data.list.forEach(function (x) {
      if (show !== 'all' && x.show !== show) return;
      var n = x.seats.length;
      if (x.status === R.ST.WAIT) o.wait += n;
      if (x.status === R.ST.OK) { o.ok += n; o.okN++; if (x.arrivedAt) { o.arr += n; o.arrN++; } }
      if (x.status === R.ST.BLOCK) o.block += n;
    });
    o.left = (show === 'all' ? R.SEATS.length * R.EVENT.shows.length : R.SEATS.length) - o.wait - o.ok - o.block;
    return o;
  }

  function render() {
    if (!S.data) return;
    var a = document.activeElement;
    if (a && root.contains(a) && /^(TEXTAREA|INPUT|SELECT)$/.test(a.tagName) && a.type !== 'checkbox') { S.pending = true; return; }
    S.pending = false;
    root.querySelectorAll('[data-tab]').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === S.tab)); });
    var waits = S.data.list.filter(function (x) { return x.status === R.ST.WAIT; }).length;
    U.$('[data-cnt="list"]').textContent = waits ? waits : '';
    var body = U.$('#ad-body');
    if (S.tab === 'list') body.innerHTML = listView();
    if (S.tab === 'map') mapView(body);
    if (S.tab === 'gate') gateView(body);
    if (S.tab === 'set') body.innerHTML = setView();
    applyBusy();
    applySel();
  }
  /* 처리 중인 단추(예약번호·처리 종류)는 화면을 다시 그려도 잠긴 채로 */
  function applyBusy() {
    root.querySelectorAll('[data-act]').forEach(function (b) {
      var row = b.closest('[data-id]');
      if (row && S.busy[row.dataset.id + ':' + b.dataset.act]) b.disabled = true;
    });
  }
  root.addEventListener('focusout', function () { setTimeout(function () { if (S.pending) render(); }, 50); });

  /* ---------- 회차 고르기 ---------- */
  function showChips(cur, withAll) {
    var items = (withAll ? [{ id: 'all', label: '전체 회차' }] : []).concat(R.EVENT.shows.map(function (s) { return { id: s.id, label: R.dateLabel(s.id) }; }));
    return '<div class="ad-chips">' + items.map(function (s) {
      var st = stats(s.id);
      return '<button type="button" class="ad-chip" data-show="' + s.id + '" aria-pressed="' + (s.id === cur) + '">' + esc(s.label)
        + '<small>확정 ' + st.ok + ' · 대기 ' + st.wait + ' · 남음 ' + st.left + '</small></button>';
    }).join('') + '</div>';
  }

  /* ---------- 예약 카드 ---------- */
  var BADGE = { '승인 대기': 'wait', '확정': 'ok', '거절': 'no', '취소': 'no', '막음': 'block' };
  function card(x) {
    var acts = [];
    if (x.status === R.ST.WAIT) {
      acts.push(['approve', '승인 (확정 메일 보내기)', 'rv-btn-red'], ['reject', '거절', 'rv-btn-line']);
      if (x.email && (/접수 메일[^\n]*✗/.test(x.mailLog || '') || stuck(x))) acts.push(['resend', '접수 메일 다시 보내기', 'rv-btn-line']);
    }
    if (x.status === R.ST.OK) {
      acts.push([x.arrivedAt ? 'unarrive' : 'arrive', x.arrivedAt ? '도착 취소' : '도착 처리', x.arrivedAt ? 'rv-btn-line' : 'rv-btn-ok']);
      if (x.email) acts.push(['resend', '확정 메일 다시 보내기', 'rv-btn-line']);
      acts.push(['cancel', '예약 취소', 'rv-btn-line']);
    }
    if (x.status === R.ST.NO || x.status === R.ST.CANCEL) acts.push(['wait', '승인 대기로 되돌리기', 'rv-btn-line'], ['remove', '목록에서 지우기', 'rv-btn-line']);
    if (x.status === R.ST.BLOCK) acts.push(['remove', '막음 풀기', 'rv-btn-line']);
    if (x.status !== R.ST.BLOCK) acts.push(['edit', '예약자 정보 고치기', 'rv-btn-line']);
    if (x.status !== R.ST.BLOCK && x.email) acts.push(['pw', '비밀번호 새로 정하기', 'rv-btn-line']);
    var dl = [];
    if (x.org) dl.push(['기관·단체', esc(x.org)]);
    if (x.phone) dl.push(['연락처', '<a href="tel:' + esc(x.phone.replace(/[^\d+]/g, '')) + '">' + esc(x.phone) + '</a>']);
    if (x.email) dl.push(['이메일', '<a href="mailto:' + esc(x.email) + '">' + esc(x.email) + '</a>']);
    if (x.note) dl.push(['요청사항', esc(x.note)]);
    dl.push(['신청', esc(x.createdAt) + (x.decidedAt ? ' · 처리 ' + esc(x.decidedAt) : '')]);
    if (x.arrivedAt) dl.push(['도착', '<b style="color:var(--arr)">' + esc(x.arrivedAt) + '</b>' + (x.testArrival ? ' · 시험 도착 (시험 모드가 꺼지면 저절로 지워져요)' : '')]);
    if (stuck(x)) dl.push(['메일 확인 필요', '<b style="color:var(--red,#B21A2D)">‘보내는 중’에서 멈춘 메일이 있어요.</b> 보냈는지 알 수 없어서 저절로 다시 보내지 않아요. 예약자에게 확인하거나 ‘다시 보내기’를 눌러 주세요.']);
    if (x.mailLog) dl.push(['메일', esc(x.mailLog).replace(/\n/g, '<br>')]);
    var flags = '', sim = (S.sim || {})[x.id];
    if (sim) flags += '<span class="ad-flag warn" title="같은 회차에 이름·기관·요청사항이 같은 신청이 있어요. 가짜 신청인지 확인해 주세요.">비슷한 신청 ' + sim + '건</span>';
    var pick = x.status === R.ST.WAIT ? '<label class="ad-sel"><input type="checkbox" data-sel="' + esc(x.id) + '" aria-label="' + esc((x.name || '') + ' ' + x.id) + ' 고르기"></label>' : '';
    return '<article class="ad-card" data-id="' + esc(x.id) + '">'
      + '<div class="ad-card-h">' + pick + '<span class="st-badge ' + (x.arrivedAt && x.status === R.ST.OK ? 'arr' : BADGE[x.status]) + '">' + esc(x.arrivedAt && x.status === R.ST.OK ? '확정 · 도착' : x.status) + '</span>'
      + '<b class="ad-name">' + esc(x.name || '(이름 없음)') + '</b><span class="ad-id">' + esc(x.id) + '</span>' + flags + '</div>'
      + '<div class="ad-seats"><span>' + esc(R.dateLabel(x.show)) + '</span><b>' + esc(x.seats.join(' · ')) + '</b><span>' + x.seats.length + '석</span></div>'
      + '<dl class="ad-dl">' + dl.map(function (d) { return '<div><dt>' + d[0] + '</dt><dd>' + d[1] + '</dd></div>'; }).join('') + '</dl>'
      + '<label class="rv-fld ad-memo"><span>관리자 메모</span><textarea rows="2" data-memo>' + esc(x.memo) + '</textarea></label>'
      + '<div class="ad-acts">' + acts.map(function (a) { return '<button type="button" class="rv-btn rv-btn-sm ' + a[2] + '" data-act="' + a[0] + '">' + a[1] + '</button>'; }).join('') + '</div>'
      + '</article>';
  }
  function byId(id) { return S.data.list.filter(function (x) { return x.id === id; })[0]; }

  /* ---------- 신청 관리 ---------- */
  var FILTERS = [['승인 대기', [R.ST.WAIT]], ['확정', [R.ST.OK]], ['거절·취소', [R.ST.NO, R.ST.CANCEL]], ['막음', [R.ST.BLOCK]], ['전체', null]];
  function listBase() { return S.data.list.filter(function (x) { return S.show === 'all' || x.show === S.show; }); }
  /* 같은 회차의 승인 대기·확정 가운데 이름·기관·요청사항이 같은 신청 수 (가짜 대량 신청을 찾기 쉽게) */
  function buildSim() {
    var key = {}, out = {};
    function norm(v) { return String(v || '').toLowerCase().replace(/\s/g, ''); }
    var live = S.data.list.filter(function (x) { return x.status === R.ST.WAIT || x.status === R.ST.OK; });
    live.forEach(function (x) {
      [['n', norm(x.name), 2], ['o', norm(x.org), 2], ['t', norm(x.note), 4]].forEach(function (k) {
        if (k[1].length < k[2]) return;
        var id = x.show + '|' + k[0] + '|' + k[1];
        (key[id] = key[id] || []).push(x.id);
      });
    });
    Object.keys(key).forEach(function (id) {
      var g = key[id]; if (g.length < 2) return;
      g.forEach(function (rid) { out[rid] = Math.max(out[rid] || 0, g.length - 1); });
    });
    return out;
  }
  function listView() {
    var base = listBase();
    S.sim = buildSim();
    var html = showChips(S.show, true);
    html += '<div class="ad-filter">' + FILTERS.map(function (f) {
      var n = base.filter(function (x) { return !f[1] || f[1].indexOf(x.status) >= 0; }).length;
      return '<button type="button" class="ad-chip sm" data-filter="' + f[0] + '" aria-pressed="' + (S.filter === f[0]) + '">' + f[0] + ' <b>' + n + '</b></button>';
    }).join('') + '<input class="ad-search" type="search" placeholder="이름·연락처·좌석·예약번호 찾기" value="' + esc(S.q) + '" data-search></div>';
    return html + '<div id="ad-results">' + resultsHtml(base) + '</div>';
  }
  function resultsHtml(base) {
    var html = '';
    var f = FILTERS.filter(function (x) { return x[0] === S.filter; })[0][1];
    var q = S.q.trim().toLowerCase().replace(/\s/g, '');
    var list = base.filter(function (x) {
      if (f && f.indexOf(x.status) < 0) return false;
      if (!q) return true;
      return (x.name + x.org + x.phone + x.email + x.id + x.seats.join('')).toLowerCase().replace(/\s/g, '').indexOf(q) >= 0;
    });
    if (S.filter === '승인 대기') list = list.slice().reverse();  // 먼저 신청한 순서대로
    if (list.some(function (x) { return x.status === R.ST.WAIT; })) {
      html += '<div class="ad-bulk"><label class="ad-sel"><input type="checkbox" data-sel-all> <span>보이는 승인 대기 모두 고르기</span></label>'
        + '<button type="button" class="rv-btn rv-btn-line rv-btn-sm" data-bulk-reject disabled>고른 신청 거절</button></div>';
    }
    html += list.length ? '<div class="ad-list">' + list.map(card).join('') + '</div>' : '<p class="mutebox">해당하는 예약이 없어요.</p>';
    return html;
  }
  /* 고른 신청 표시: 다시 그린 뒤에도 고른 상태를 유지. 승인 대기가 아니게 된 신청은 빠짐 */
  function applySel() {
    if (!S.data) return;
    var wait = {}; S.data.list.forEach(function (x) { if (x.status === R.ST.WAIT) wait[x.id] = true; });
    Object.keys(S.sel).forEach(function (id) { if (!wait[id]) delete S.sel[id]; });
    root.querySelectorAll('input[data-sel]').forEach(function (c) { c.checked = !!S.sel[c.dataset.sel]; });
    var n = Object.keys(S.sel).length, b = U.$('[data-bulk-reject]'), all = U.$('input[data-sel-all]');
    if (b) { b.disabled = !n || !!S.bulkBusy; b.textContent = S.bulkBusy ? '거절하는 중...' : n ? '고른 신청 ' + n + '건 거절' : '고른 신청 거절'; }
    if (all) { var boxes = root.querySelectorAll('input[data-sel]'); all.checked = boxes.length > 0 && Array.prototype.every.call(boxes, function (c) { return c.checked; }); }
  }

  /* ---------- 좌석 배치도 ---------- */
  function occOf(show) {
    var occ = {}, info = {}, arr = [], h = (S.data.holds || {})[show] || {};
    for (var k in h) occ[k] = 'h';
    S.data.list.forEach(function (x) {
      if (x.show !== show) return;
      var code = x.status === R.ST.WAIT ? 'w' : x.status === R.ST.OK ? 't' : x.status === R.ST.BLOCK ? 'b' : '';
      if (!code) return;
      x.seats.forEach(function (s) { occ[s] = code; info[s] = x.id; if (code === 't' && x.arrivedAt) arr.push(s); });
    });
    return { occ: occ, info: info, arr: arr };
  }
  function mapView(body) {
    if (S.show === 'all') S.show = R.EVENT.shows[0].id;
    var o = occOf(S.show);
    S.pick = S.pick.filter(function (s) { return !o.occ[s]; });
    var focus = S.focus && byId(S.focus);
    if (focus && focus.show !== S.show) focus = null;
    var fset = {}; if (focus) focus.seats.forEach(function (s) { fset[s] = true; });
    var st = stats(S.show);
    body.innerHTML = showChips(S.show, false)
      + '<div class="ad-split"><div class="rv-board"><div class="rv-boardhead">' + U.legend('admin')
      + '<span class="rv-sub" style="margin:0;font-size:14px">확정 ' + st.ok + '석 · 대기 ' + st.wait + '석 · 막음 ' + st.block + '석 · <b>남음 ' + st.left + '석</b>' + leftNote(S.show) + '</span></div>'
      + '<div class="rv-scroll"><div id="ad-hall"></div></div><p class="rv-hint">좌우로 밀어서 보세요</p></div>'
      + '<aside class="ad-side" id="ad-side"></aside></div>';
    S.map = U.hall(U.$('#ad-hall'), { admin: true, onPick: function (id) {
      var cur = occOf(S.show);
      if (cur.info[id]) { S.focus = cur.info[id]; S.pick = []; }
      else { S.focus = null; var i = S.pick.indexOf(id); if (i >= 0) S.pick.splice(i, 1); else S.pick.push(id); S.pick.sort(R.seatSort); }
      render();
    } });
    S.map.update({ occ: o.occ, sel: S.pick, arr: o.arr, focus: fset });
    var side = U.$('#ad-side');
    if (focus) side.innerHTML = '<p class="rv-sub" style="margin:0 0 8px;font-size:14px">누른 좌석의 예약</p>' + card(focus) + '<button type="button" class="rv-link" data-unfocus>닫기</button>';
    else if (S.pick.length) side.innerHTML = pickForm();
    else side.innerHTML = '<div class="mutebox">예약된 좌석을 누르면 예약 내용을 볼 수 있어요.<br><br>빈 좌석을 누르면 <b>좌석 막기(관계자석)</b>나 <b>전화 예약 등록</b>을 할 수 있어요.</div>';
  }
  function pickForm() {
    return '<div class="rv-card" style="padding:18px"><div><b>고른 좌석 ' + S.pick.length + '석</b><p style="margin:4px 0 0;font-weight:800;color:var(--red-d)">' + esc(S.pick.join(' · ')) + '</p></div>'
      + '<form data-block style="display:grid;gap:10px"><label class="rv-fld"><span>좌석 막기 (관계자·초대석 등)</span><input name="name" placeholder="관계자석" maxlength="30"></label>'
      + '<button class="rv-btn rv-btn-ink rv-btn-sm" type="submit">이 좌석 막기</button></form>'
      + '<hr style="border:0;border-top:1px solid var(--line);margin:4px 0">'
      + '<form data-book style="display:grid;gap:10px" novalidate><b>전화 예약 바로 등록 (확정)</b>'
      + '<label class="rv-fld"><span>예약자 성함 <span class="req">*</span></span><input name="name" maxlength="30"></label>'
      + '<label class="rv-fld"><span>연락처</span><input name="phone" type="tel" maxlength="20"></label>'
      + '<label class="rv-fld"><span>기관·단체</span><input name="org" maxlength="60"></label>'
      + '<label class="rv-fld"><span>이메일 <small class="help">적으면 확정 메일을 보내요</small></span><input name="email" type="email" maxlength="120"></label>'
      + '<label class="rv-fld"><span>비밀번호 <small class="help">적으면 예약자가 내 예약 확인·도착을 쓸 수 있어요</small></span><input name="password" maxlength="30"></label>'
      + '<p class="rv-err" role="alert"></p>'
      + '<button class="rv-btn rv-btn-red rv-btn-sm" type="submit">확정 예약으로 등록</button></form>'
      + '<button type="button" class="rv-link" data-unpick>고른 좌석 비우기</button></div>';
  }

  /* ---------- 당일 입장 ---------- */
  function gateView(body) {
    if (!S.gate) S.gate = R.EVENT.shows[0].id;
    var show = S.gate, o = occOf(show), st = stats(show);
    var list = S.data.list.filter(function (x) { return x.show === show && x.status === R.ST.OK; })
      .sort(function (a, b) { return (a.arrivedAt ? 1 : 0) - (b.arrivedAt ? 1 : 0) || R.seatSort(a.seats[0], b.seats[0]); });
    var waits = S.data.list.filter(function (x) { return x.show === show && x.status === R.ST.WAIT; });
    var pct = st.okN ? Math.round(st.arrN / st.okN * 100) : 0;
    body.innerHTML = '<div class="ad-chips">' + R.EVENT.shows.map(function (s) {
        return '<button type="button" class="ad-chip" data-gate="' + s.id + '" aria-pressed="' + (s.id === show) + '">' + esc(R.dateLabel(s.id)) + (s.id === S.data.today ? ' <b>오늘</b>' : '') + '</button>';
      }).join('') + '</div>'
      + '<div class="ad-gate-stats"><div><small>도착</small><b>' + st.arrN + '<span> / ' + st.okN + '건</span></b></div><div><small>도착 좌석</small><b>' + st.arr + '<span> / ' + st.ok + '석</span></b></div>'
      + '<div><small>아직 안 옴</small><b>' + (st.okN - st.arrN) + '<span>건</span></b></div><div class="bar"><i style="width:' + pct + '%"></i></div></div>'
      + (S.data.settings.arriveTest
        ? '<div class="waitbox ad-testbar"><span>도착 확인 시험 모드 켜짐 (' + esc(S.data.settings.arriveTestUntil) + '까지) · 공연 전에도 손님이 ‘도착했어요’를 누를 수 있어요. 시험 모드를 끄거나 시간이 지나면 시험 도착은 모두 ‘아직 안 옴’으로 되돌아가요.</span><button type="button" class="rv-btn rv-btn-line rv-btn-sm" data-arrive-test="off">시험 모드 끄기</button></div>'
        : '<div class="mutebox ad-testbar"><span>공연 전에 ‘공연장에 도착했어요’를 미리 시험해 보려면</span><button type="button" class="rv-btn rv-btn-ink rv-btn-sm" data-arrive-test="on">도착 시험 모드 켜기 (2시간)</button></div>')
      + (waits.length ? '<p class="waitbox">아직 승인 대기인 예약이 ' + waits.length + '건 있어요. <button type="button" class="rv-link" data-goto-wait>신청 관리에서 처리하기</button></p>' : '')
      + '<div class="ad-split gate"><div class="ad-gate-list">' + (list.length ? list.map(function (x) {
          return '<div class="ad-row' + (x.arrivedAt ? ' done' : '') + '" data-id="' + esc(x.id) + '"><div><b>' + esc(x.name) + '</b>' + (x.org ? ' <span>' + esc(x.org) + '</span>' : '')
            + '<div class="sts">' + esc(x.seats.join(' · ')) + ' (' + x.seats.length + '석)' + (x.phone ? ' · <a href="tel:' + esc(x.phone.replace(/[^\d+]/g, '')) + '">' + esc(x.phone) + '</a>' : '') + '</div></div>'
            + (x.arrivedAt ? '<span class="t">✓ ' + esc(x.arrivedAt.slice(11)) + (x.testArrival ? ' (시험)' : '') + '</span><button type="button" class="rv-link" data-act="unarrive">취소</button>'
              : '<button type="button" class="rv-btn rv-btn-ok rv-btn-sm" data-act="arrive">도착 처리</button>') + '</div>';
        }).join('') : '<p class="mutebox">이 회차의 확정 예약이 없어요.</p>') + '</div>'
      + '<div class="rv-board"><div class="rv-boardhead"><ul class="rv-legend"><li><span class="sw arr"></span>도착</li><li><span class="sw t"></span>아직 안 옴</li><li><span class="sw w"></span>승인 대기</li><li><span class="sw b"></span>막음</li></ul></div>'
      + '<div class="rv-scroll"><div id="ad-gate-hall"></div></div></div></div>';
    var g = U.hall(U.$('#ad-gate-hall'), { admin: true, onPick: function (id) {
      var rid = occOf(show).info[id]; if (!rid) return;
      var row = root.querySelector('.ad-row[data-id="' + rid + '"]');
      if (row) { row.scrollIntoView({ block: 'center', behavior: 'smooth' }); row.classList.add('hl'); setTimeout(function () { row.classList.remove('hl'); }, 1500); }
    } });
    g.update({ occ: o.occ, arr: o.arr });
  }

  /* ---------- 설정 ---------- */
  function setView() {
    var d = S.data, s = d.settings;
    return '<div class="rv-card" style="max-width:640px"><form data-settings style="display:grid;gap:14px">'
      + '<label class="rv-consent" style="font-size:16px;color:var(--ink);font-weight:700;margin:0"><input type="checkbox" name="open"' + (s.open ? ' checked' : '') + '> 홈페이지에서 온라인 예약 받기</label>'
      + '<label class="rv-fld" style="max-width:260px"><span>한 번에 예약할 수 있는 최대 인원</span><input name="max" type="number" min="1" max="242" value="' + s.max + '"></label>'
      + '<label class="rv-fld" style="max-width:300px"><span>예약 오픈 일시</span><input name="openAt" type="datetime-local" value="' + esc(String(s.openAt || '').replace(' ', 'T')) + '"><small class="help">' + (s.notYet ? '지금은 오픈 전이에요 (' + esc(s.openAtLabel) + ' 오픈)' : '지금 예약을 받는 중이에요') + '. 바꾸면 손님 화면의 남은 시간이 바로 바뀌지만, 공연 안내·포스터·팩스 문구는 그대로이니 제작자에게 함께 알려 주세요.</small></label>'
      + '<button class="rv-btn rv-btn-red rv-btn-sm" type="submit" style="justify-self:start">설정 저장</button></form></div>'
      + '<div class="rv-card" style="max-width:640px;margin-top:16px;gap:10px"><b>도착 확인 시험 모드</b>'
      + '<p class="rv-sub" style="margin:0;font-size:15px">켜면 2시간 동안 공연 날이 아니어도 손님 화면의 ‘공연장에 도착했어요’를 눌러 볼 수 있어요. 2시간 뒤 저절로 꺼져요. 확정된 예약에서만 눌러져요.</p>'
      + (s.arriveTest ? '<p class="waitbox" style="margin:0">지금 켜져 있어요 · ' + esc(s.arriveTestUntil) + '에 꺼져요. 끄거나 시간이 지나면 시험으로 누른 도착은 모두 ‘아직 안 옴’으로 되돌아가요.</p>'
        + '<button type="button" class="rv-btn rv-btn-line rv-btn-sm" style="justify-self:start" data-arrive-test="off">시험 모드 끄기</button>'
        : '<button type="button" class="rv-btn rv-btn-ink rv-btn-sm" style="justify-self:start" data-arrive-test="on">2시간 동안 켜기</button>')
      + '</div>'
      + '<div class="rv-card" style="max-width:640px;margin-top:16px"><form data-cred novalidate style="display:grid;gap:14px">'
      + '<b>관리 화면 아이디·비밀번호 바꾸기</b>'
      + '<label class="rv-fld" style="max-width:320px"><span>아이디</span><input name="id" value="' + esc(d.adminId || '') + '" autocomplete="username" autocapitalize="off" spellcheck="false"></label>'
      + '<div class="rv-two"><label class="rv-fld"><span>새 비밀번호</span><input name="password" type="password" autocomplete="new-password"></label>'
      + '<label class="rv-fld"><span>새 비밀번호 확인</span><input name="password2" type="password" autocomplete="new-password"></label></div>'
      + '<p class="rv-sub" style="margin:0;font-size:14px">비밀번호는 8자 이상이어야 해요 (숫자만이 아닌 것을 권해요). 바꾸면 다른 곳에 로그인돼 있던 화면은 모두 다시 로그인해야 해요.</p>'
      + '<p class="rv-err" role="alert"></p>'
      + '<button class="rv-btn rv-btn-ink rv-btn-sm" type="submit" style="justify-self:start">아이디·비밀번호 저장</button></form></div>'
      + '<div class="rv-card" style="max-width:640px;margin-top:16px;gap:10px;border-color:#E9B7A9"><b>예약 전체 초기화 (시험 정리용)</b>'
      + '<p class="rv-sub" style="margin:0;font-size:15px">지금 있는 예약을 구글 시트의 ‘좌석예약 보관’ 탭으로 옮기고 좌석을 비워요. 지워지지 않고 보관 탭에 남아요(비밀번호는 옮기지 않아요). 막아 둔 좌석(예약 불가·관계자석)은 그대로 둬요. 손님 예약을 받기 시작한 뒤에는 누르지 마세요.</p>'
      + '<button type="button" class="rv-btn rv-btn-line rv-btn-sm" style="justify-self:start" data-reset-all>예약 전체 초기화</button></div>'
      + '<dl class="ad-dl ad-info">'
      + '<div><dt>새 신청 알림 메일</dt><dd>' + esc(d.notifyEmail || '(없음)') + ' <small>바꾸려면 기존 관리자 페이지 › 설정</small></dd></div>'
      + '<div><dt>오늘 남은 메일 발송</dt><dd>' + (d.mailQuota == null ? '확인 불가' : d.mailQuota + '통')
        + (d.mailVia && d.mailVia.name === 'Brevo'
          ? ' <small>Brevo 무료 하루 ' + d.mailVia.limit + '통 · 보내는 주소 ' + esc(d.mailVia.from) + '. 받는 사람 1명이 1통이에요. Brevo가 안 되면 구글(하루 100통)로 보내요.</small>'
          : ' <small>구글 무료 계정은 하루 100통까지 보낼 수 있어요</small>') + '</dd></div>'
      + '<div><dt>예약 자료</dt><dd>' + (d.sheetUrl ? '<a href="' + esc(d.sheetUrl) + '" target="_blank" rel="noopener">구글 시트 ‘좌석예약’ 탭 열기</a>' : '-') + '</dd></div>'
      + '<div><dt>손님용 주소</dt><dd><a href="./" target="_blank">공연 안내</a> · <a href="seats.html" target="_blank">좌석 예약</a> · <a href="my.html" target="_blank">내 예약 확인 · 입장</a></dd></div>'
      + '<div><dt>문자 알림</dt><dd>문자 발송은 유료라 연결하지 않았어요. 확정 안내는 이메일로 갑니다.</dd></div>'
      + '</dl>';
  }

  /* ---------- 처리 ---------- */
  /* 처리 결과: 이 요청이 잠근 단추만 다시 켬 (다른 처리 중인 단추는 그대로 잠김) */
  function afterAll(r, okMsg, btn) {
    if (btn) btn.disabled = false;
    if (!r.ok) { U.toast(r.message, true); if (r.item) load(); return; }
    var bad = r.mailed === false;
    U.toast(bad ? '처리는 저장했지만 메일은 보내지 못했어요. (메일 기록 확인 · 다시 보내기)' : okMsg, bad);
    load();
  }
  function promptBox(title, label, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var d = U.el('dialog', 'rv-dlg');
      d.setAttribute('aria-label', title);
      d.innerHTML = '<form class="in" novalidate><header><h2>' + esc(title) + '</h2></header><div class="body">'
        + (opts.text ? '<p style="margin:0">' + esc(opts.text) + '</p>' : '')
        + '<label class="rv-fld"><span>' + esc(label) + '</span><input name="v" maxlength="300"' + (opts.type ? ' type="' + opts.type + '"' : '') + '></label>'
        + (opts.check ? '<label class="rv-consent"><input type="checkbox" name="c"' + (opts.checkOff ? '' : ' checked') + '> <span>' + esc(opts.check) + '</span></label>' : '')
        + '</div><footer><button type="button" class="rv-btn rv-btn-line" data-no>닫기</button><button type="submit" class="rv-btn rv-btn-red">' + esc(opts.ok || '확인') + '</button></footer></form>';
      document.body.appendChild(d);
      var f = U.$('form', d);
      function done(v) { d.close(); d.remove(); resolve(v); }
      U.$('[data-no]', d).onclick = function () { done(null); };
      d.addEventListener('cancel', function (e) { e.preventDefault(); done(null); });
      f.onsubmit = function (e) { e.preventDefault(); done({ value: f.elements.v.value, check: f.elements.c ? f.elements.c.checked : false }); };
      d.showModal();
      f.elements.v.focus();
    });
  }
  function editBox(x, keep) {
    return new Promise(function (resolve) {
      var d = U.el('dialog', 'rv-dlg');
      d.setAttribute('aria-label', '예약자 정보 고치기');
      d.innerHTML = '<form class="in" novalidate><header><h2>예약자 정보 고치기</h2></header><div class="body">'
        + '<p style="margin:0">' + esc(x.id) + ' · ' + esc(R.dateLabel(x.show)) + ' · ' + esc(x.seats.join(', ')) + '</p>'
        + '<label class="rv-fld"><span>예약자 성함</span><input name="name" maxlength="30" value="' + esc(x.name) + '"></label>'
        + '<label class="rv-fld"><span>기관·단체</span><input name="org" maxlength="60" value="' + esc(x.org) + '"></label>'
        + '<label class="rv-fld"><span>휴대전화</span><input name="phone" type="tel" maxlength="20" value="' + esc(x.phone) + '"></label>'
        + '<label class="rv-fld"><span>이메일 <small class="help">확정 메일·내 예약 확인·비밀번호 찾기에 쓰여요</small></span><input name="email" type="email" maxlength="120" value="' + esc(x.email) + '"></label>'
        + '</div><footer><button type="button" class="rv-btn rv-btn-line" data-no>닫기</button><button type="submit" class="rv-btn rv-btn-red">저장</button></footer></form>';
      document.body.appendChild(d);
      var f = U.$('form', d);
      function done(v) { d.close(); d.remove(); resolve(v); }
      U.$('[data-no]', d).onclick = function () { done(null); };
      d.addEventListener('cancel', function (e) { e.preventDefault(); done(null); });
      f.onsubmit = function (e) { e.preventDefault(); var el = f.elements; done({ name: el.name.value, org: el.org.value, phone: el.phone.value, email: el.email.value.trim() }); };
      if (keep) ['name', 'org', 'phone', 'email'].forEach(function (k) { f.elements[k].value = keep[k]; });
      if (keep && keep.error) { var e0 = U.el('p', 'rv-err', esc(keep.error)); e0.setAttribute('role', 'alert'); U.$('.body', d).appendChild(e0); }
      d.showModal();
    });
  }
  function act(name, id, btn) {
    var x = byId(id); if (!x) return;
    var bk = id + ':' + name;
    if (S.busy[bk]) return;
    var lock = function () { S.busy[bk] = true; if (btn) btn.disabled = true; };
    var unlockNow = function () { root.querySelectorAll('[data-id="' + id + '"] [data-act="' + name + '"]').forEach(function (b) { b.disabled = false; }); };   // 다시 그려진 단추까지
    var after = function (r, msg) { delete S.busy[bk]; unlockNow(); afterAll(r, msg, btn); };
    var call = function (a, d) {   // 이 처리의 요청: 응답이 버려지거나 실패해도 처리 중 표시·단추를 정리
      return callApi(a, d).catch(function (e) { delete S.busy[bk]; if (btn) btn.disabled = false; unlockNow(); throw e; });
    };
    if (name === 'approve') { lock(); call('rsvAdminDecide', { id: id, decision: 'approve' }).then(function (r) { after(r, x.email ? '확정하고 확정 메일을 보냈어요.' : '확정했어요.'); }); }
    if (name === 'wait') { lock(); call('rsvAdminDecide', { id: id, decision: 'wait' }).then(function (r) { after(r, '승인 대기로 되돌렸어요.'); }); }
    if (name === 'reject') promptBox('예약 거절', '거절 이유 (예약자에게 메일로 안내돼요, 비워도 돼요)', { check: '예약자에게 안내 메일 보내기', ok: '거절하기' }).then(function (v) {
      if (!v) return; lock();
      call('rsvAdminDecide', { id: id, decision: 'reject', reason: v.value, notify: v.check }).then(function (r) { after(r, '거절했어요. 좌석이 다시 열렸어요.'); });
    });
    if (name === 'cancel') U.confirm('확정 예약을 취소할까요?', x.name + ' · ' + x.seats.join(', ') + '\n좌석이 다시 열려요. 예약자에게는 메일이 가지 않으니 따로 연락해 주세요.', '예약 취소', true).then(function (y) {
      if (!y) return; lock(); call('rsvAdminDecide', { id: id, decision: 'cancel' }).then(function (r) { after(r, '예약을 취소했어요.'); });
    });
    if (name === 'resend') { lock(); call('rsvAdminResend', { id: id }).then(function (r) { after(r, x.status === R.ST.WAIT ? '신청 접수 메일을 다시 보냈어요.' : '확정 메일을 다시 보냈어요.'); }); }
    if (name === 'arrive' || name === 'unarrive') { lock(); call('rsvAdminArrive', { id: id, arrived: name === 'arrive' }).then(function (r) { after(r, name === 'arrive' ? x.name + '님 도착 처리했어요.' : '도착을 취소했어요.'); }); }
    if (name === 'remove') U.confirm(x.status === R.ST.BLOCK ? '막음을 풀까요?' : '목록에서 지울까요?', x.seats.join(', ') + (x.status === R.ST.BLOCK ? '\n좌석이 다시 예약 가능해져요.' : '\n시트에서도 지워지고 되돌릴 수 없어요.'), x.status === R.ST.BLOCK ? '막음 풀기' : '지우기', true).then(function (y) {
      if (!y) return; lock(); call('rsvAdminRemove', { id: id }).then(function (r) { if (S.focus === id) S.focus = null; after(r, x.status === R.ST.BLOCK ? '막음을 풀었어요.' : '지웠어요.'); });
    });
    if (name === 'edit') (function open(keep) { editBox(x, keep).then(function (v) {
      if (!v) return;
      lock();
      call('rsvAdminEdit', Object.assign({ id: id }, v)).then(function (r) {
        if (!r.ok && r.code !== 'missing') {   // 실패하면 적은 내용을 잃지 않게 다시 열어 줌
          delete S.busy[bk]; if (btn) btn.disabled = false;
          open(Object.assign({}, v, { error: r.code === 'invalid' ? r.message + ' ' + Object.keys(r.errors || {}).map(function (k) { return r.errors[k]; }).join(', ') : r.message }));
          return;
        }
        after(r, '예약자 정보를 고쳤어요.' + (v.email !== x.email ? ' 바뀐 이메일로 내 예약 확인·비밀번호 찾기를 할 수 있어요.' : ''));
      }).catch(function () {});
    }); })();
    if (name === 'pw') promptBox('비밀번호 새로 정하기', '새 비밀번호 (4자 이상)', { text: x.name + ' (' + x.email + ')님 예약의 비밀번호를 바꿔요. 예약자가 로그인해 있던 화면은 다시 로그인해야 해요. 바꾼 비밀번호는 예약자에게 직접 알려 주세요.', ok: '바꾸기' }).then(function (v) {
      if (!v) return; lock(); call('rsvAdminPassword', { id: id, password: v.value }).then(function (r) { after(r, '비밀번호를 바꿨어요.'); });
    });
  }

  root.addEventListener('click', function (e) {
    var t = e.target.closest('button, a'); if (!t) return;
    if (t.hasAttribute('data-adm-forgot')) {
      U.confirm('비밀번호 찾기', '담당자 알림 메일로 6자리 확인 번호를 보낼까요?\n확인 번호와 새 비밀번호를 넣으면 다시 들어올 수 있어요.', '확인 번호 메일 보내기').then(function (yes) {
      if (!yes) return;
      t.disabled = true;
      U.api('rsvAdminForgot', {}).then(function (r) {
        t.disabled = false;
        var f = U.$('form[data-adm-reset]', root), login = U.$('form[data-login]', root);
        if (!r.ok) { U.$('.rv-err', login).textContent = r.message; return; }
        login.hidden = true; t.hidden = true; f.hidden = false;
        U.$('[data-sent]', f).textContent = '담당자 메일(' + r.sentTo + ')로 6자리 확인 번호를 보냈어요. 15분 안에 넣어 주세요.';
        f.elements.code.focus();
      });
      });
      return;
    }
    if (t.hasAttribute('data-logout')) {
      t.disabled = true;
      U.api('rsvAdminLogout', { token: S.token }).then(function () { locked('로그아웃했어요.'); });
      return;
    }
    if (t.hasAttribute('data-reset-all')) {
      var nb = S.data.list.filter(function (x) { return x.status !== R.ST.BLOCK; }).length, nk = S.data.list.length - nb;
      promptBox('예약 전체 초기화', '확인을 위해 ‘초기화’라고 적어 주세요', { text: '예약 ' + nb + '건을 ‘좌석예약 보관’ 탭으로 옮기고 좌석을 비워요. 막아 둔 좌석 ' + nk + '건은 그대로 둬요. 손님에게 메일은 가지 않아요.', check: '막아 둔 좌석(예약 불가·관계자석)도 함께 풀기', checkOff: true, ok: '초기화하기' }).then(function (v) {
        if (!v) return;
        if (v.value.trim() !== '초기화') { U.toast('‘초기화’라고 적어야 진행돼요.', true); return; }
        t.disabled = true;
        call('rsvAdminResetAll', { confirm: '초기화', blocks: !!v.check }).then(function (r) {
          S.focus = null; S.pick = [];
          var left = (r.shows || []).map(function (s) { return R.dateLabel(s.id).replace(/ \(.\)/, '') + ' ' + s.leftGen + '석'; }).join(' · ');
          afterAll(r, '예약 ' + (r.moved || 0) + '건을 보관 탭으로 옮겼어요' + (r.kept ? ' (막은 좌석 ' + r.kept + '건은 그대로)' : '') + '. 남은 일반석: ' + left, t);
        });
      });
      return;
    }
    if (t.dataset.arriveTest) {
      t.disabled = true;
      call('rsvAdminSettings', { arriveTest: t.dataset.arriveTest === 'on' }).then(function (r) {
        afterAll(r, r.settings && r.settings.arriveTest ? '도착 확인 시험 모드를 켰어요 (' + r.settings.arriveTestUntil + '까지).'
          : '도착 확인 시험 모드를 껐어요.' + (r.cleared ? ' 시험 도착 ' + r.cleared + '건을 ‘아직 안 옴’으로 되돌렸어요.' : ''), t);
      });
      return;
    }
    if (t.hasAttribute('data-bulk-reject')) {
      var ids = Object.keys(S.sel);
      if (!ids.length || S.bulkBusy) return;
      promptBox('고른 신청 ' + ids.length + '건 거절', '거절 이유 (비워도 돼요 · 관리자 메모에 남아요)', { text: '승인 대기 신청 ' + ids.length + '건을 한꺼번에 거절하고 좌석을 다시 열어요. 가짜 신청이면 안내 메일은 보내지 마세요.', check: '예약자에게 거절 안내 메일 보내기', checkOff: true, ok: ids.length + '건 거절하기' }).then(function (v) {
        if (!v || S.bulkBusy) return;
        S.bulkBusy = true; t.disabled = true;
        var done = function () { S.bulkBusy = false; var b = U.$('[data-bulk-reject]'); if (b) b.disabled = !Object.keys(S.sel).length; };
        call('rsvAdminDecideMany', { ids: ids, decision: 'reject', reason: v.value, notify: !!v.check }).then(function (r) {
          done();
          if (r.ok) S.sel = {};
          afterAll(r, r.ok ? r.done + '건을 거절했어요. 좌석이 다시 열렸어요.' + (r.skipped ? ' (그 사이 처리된 ' + r.skipped + '건은 건너뜀)' : '') + (r.mailFailed ? ' 안내 메일 ' + r.mailFailed + '건은 보내지 못했어요.' : '') + (r.mailSkipped ? ' 그 사이 다시 승인된 ' + r.mailSkipped + '건에는 안내 메일을 보내지 않았어요.' : '') + (r.mailUnknown ? ' 안내 메일 ' + r.mailUnknown + '건은 확인하지 못해 아직 보내지 않았어요. 같은 신청을 골라 한 번 더 하면 이어서 보내요.' : '') : '', t);
        }).catch(function () { done(); t.disabled = false; });
      });
      return;
    }
    if (t.dataset.tab) { S.tab = t.dataset.tab; render(); return; }
    if (t.dataset.show) { S.show = t.dataset.show; S.focus = null; S.pick = []; render(); return; }
    if (t.dataset.gate) { S.gate = t.dataset.gate; render(); return; }
    if (t.dataset.filter) { S.filter = t.dataset.filter; render(); return; }
    if (t.hasAttribute('data-unfocus')) { S.focus = null; render(); return; }
    if (t.hasAttribute('data-unpick')) { S.pick = []; render(); return; }
    if (t.hasAttribute('data-goto-wait')) { S.tab = 'list'; S.filter = '승인 대기'; S.show = S.gate; render(); return; }
    if (t.dataset.act) act(t.dataset.act, t.closest('[data-id]').dataset.id, t);
  });
  /* 검색: 검색 칸은 그대로 두고 아래 결과만 다시 그림 (한글을 조합하는 중에는 기다렸다가 조합이 끝나면) */
  function searchNow(inp) {
    S.q = inp.value;
    var box = U.$('#ad-results');
    if (!box) return;
    box.innerHTML = resultsHtml(listBase());
    applyBusy();   // 검색으로 다시 그려도 처리 중인 단추는 잠긴 채로
    applySel();
  }
  root.addEventListener('input', function (e) {
    if (!e.target.hasAttribute('data-search') || e.isComposing) return;
    searchNow(e.target);
  });
  root.addEventListener('compositionend', function (e) { if (e.target.hasAttribute && e.target.hasAttribute('data-search')) searchNow(e.target); });
  root.addEventListener('change', function (e) {
    if (e.target.hasAttribute('data-sel')) { if (e.target.checked) S.sel[e.target.dataset.sel] = true; else delete S.sel[e.target.dataset.sel]; applySel(); return; }
    if (e.target.hasAttribute('data-sel-all')) {
      var on = e.target.checked;
      root.querySelectorAll('#ad-results input[data-sel]').forEach(function (c) { if (on) S.sel[c.dataset.sel] = true; else delete S.sel[c.dataset.sel]; });
      applySel(); return;
    }
    if (e.target.hasAttribute('data-memo')) {
      var id = e.target.closest('[data-id]').dataset.id;
      call('rsvAdminMemo', { id: id, memo: e.target.value }).then(function (r) { if (r.ok) U.toast('메모를 저장했어요.'); else U.toast(r.message, true); load(); });
    }
  });
  root.addEventListener('submit', function (e) {
    var f = e.target; e.preventDefault();
    var btn = U.$('[type=submit]', f);
    if (f.hasAttribute('data-login')) {
      btn.disabled = true;
      U.api('rsvAdminLogin', { id: f.elements.id.value, password: f.elements.password.value }).then(function (r) {
        btn.disabled = false;
        if (!r.ok) { U.$('.rv-err', f).textContent = r.message; f.elements.password.select(); return; }
        S.gen++; S.token = r.token;
        try { sessionStorage.setItem(KEY, r.token); } catch (x) {}
        start();
      });
      return;
    }
    if (f.hasAttribute('data-adm-reset')) {
      if (f.elements.password.value !== f.elements.password2.value) { U.fieldErrors(f, { password2: '새 비밀번호가 서로 달라요' }); return; }
      btn.disabled = true;
      U.api('rsvAdminReset', { code: f.elements.code.value, password: f.elements.password.value }).then(function (r) {
        btn.disabled = false;
        if (!r.ok) { U.fieldErrors(f, r.errors); U.$('.rv-err', f).textContent = r.message; return; }
        S.token = r.token;
        try { sessionStorage.setItem(KEY, r.token); } catch (x) {}
        U.toast('비밀번호를 바꿨어요. 아이디는 ' + r.id + ' 그대로예요.');
        start();
      });
      return;
    }
    if (f.hasAttribute('data-cred')) {
      if (f.elements.password.value !== f.elements.password2.value) { U.fieldErrors(f, { password2: '새 비밀번호가 서로 달라요' }); return; }
      btn.disabled = true;
      S.credChanging = true;
      call('rsvAdminCred', { id: f.elements.id.value, password: f.elements.password.value }).then(function (r) {
        S.credChanging = false;
        btn.disabled = false;
        if (r.code === 'invalid') { U.fieldErrors(f, r.errors); return; }
        if (!r.ok) { U.toast(r.message, true); return; }
        U.fieldErrors(f, {}); f.elements.password.value = ''; f.elements.password2.value = '';
        if (r.token) { S.token = r.token; try { sessionStorage.setItem(KEY, r.token); } catch (x) {} }   // 이 화면은 새 열쇠로 계속
        U.toast('아이디·비밀번호를 바꿨어요. 다른 곳에 로그인돼 있던 화면은 다시 로그인해야 해요.');
      }).catch(function () { S.credChanging = false; btn.disabled = false; });
      return;
    }
    if (f.hasAttribute('data-settings')) {
      btn.disabled = true;
      call('rsvAdminSettings', { open: f.elements.open.checked, max: f.elements.max.value, openAt: f.elements.openAt.value }).then(function (r) { afterAll(r, '설정을 저장했어요.', btn); });
    }
    if (f.hasAttribute('data-block') || f.hasAttribute('data-book')) {
      var block = f.hasAttribute('data-block'), el = f.elements;
      var data = { show: S.show, seats: S.pick, kind: block ? 'block' : 'book', name: el.name.value };
      if (!block) { data.phone = el.phone.value; data.org = el.org.value; data.email = el.email.value; data.password = el.password.value; }
      btn.disabled = true;
      call('rsvAdminBook', data).then(function (r) {
        if (r.code === 'invalid') { btn.disabled = false; U.fieldErrors(f, r.errors); U.$('.rv-err', f) && (U.$('.rv-err', f).textContent = r.message); return; }
        if (r.ok) { S.pick = []; S.focus = r.item.id; }
        afterAll(r, block ? '좌석을 막았어요.' : '확정 예약으로 등록했어요.' + (data.email ? ' 확정 메일을 보냈어요.' : ''), btn);
      });
    }
  });

  if (!S.token) locked();
  else start();
})();
