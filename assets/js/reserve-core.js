/* 극단 도깨비 · 좌석 예약 규칙
   홈페이지(예약 · 내 예약 · 예약 관리 화면)와 구글 Apps Script 서버(apps_script/ReserveCore.js)가 똑같은 이 코드를 씁니다.
   - 고친 뒤에는 build_reserve.py 를 실행해 서버 쪽 사본도 맞춥니다.
   - 공연 회차와 좌석 배치는 아래 EVENT · 좌석 배치 부분만 고치면 됩니다.
   - 예약 내용은 접수 구글 시트의 '좌석예약' 탭에 쌓입니다. 비밀번호는 암호화해서 저장합니다. */
var RSV = (function () {
  'use strict';

  /* ---------- 공연 ---------- */
  var EVENT = {
    title: '배탈난 호랑이',
    series: '2026 기장군 아동무대공연',
    genre: '아동극 · 생활습관 교육극',
    venue: '안데르센극장',
    address: '부산광역시 기장군 장안읍 장안로 211',
    org: '극단 도깨비',                // 주관
    host: '기장군',                    // 주최
    phones: ['010-5115-5406', '010-3837-8479'],   // 안내문의 문의 번호 순서
    phone: '010-5115-5406, 010-3837-8479',
    email: 'gumbong777@hanmail.net',   // 예약 문의 메일 (안내문의 접수 메일)
    sysPhone: '010-8584-1753',          // 예약 시스템(홈페이지 오류·로그인) 문의
    audience: '4세 이상 · 무료 관람',
    shows: [
      { id: '2026-11-24', time: '10:30' },
      { id: '2026-11-25', time: '10:30' },
      { id: '2026-11-26', time: '10:30' }
    ]
  };

  /* ---------- 좌석 배치 (안데르센극장 · 일반석 239 + 휠체어석 3) ----------
     A~G 1층, H~N 2층. A열은 4번이 없고 1~3번이 휠체어석, N열은 1~4 · 14~17번, 양옆 O·P열은 1~7번 */
  var ROWS = 'ABCDEFGHIJKLMN'.split('');
  var SIDES = { O: 7, P: 7 };
  var WHEEL = ['A1', 'A2', 'A3'];
  function rowNums(r) {
    var out = [], i;
    if (SIDES[r]) { for (i = 1; i <= SIDES[r]; i++) out.push(i); return out; }
    for (i = 1; i <= 17; i++) {
      if (r === 'A' && i === 4) continue;
      if (r === 'N' && i > 4 && i < 14) continue;
      out.push(i);
    }
    return out;
  }
  var ORDER = ROWS.concat(['O', 'P']);
  var SEATS = [], SEAT_SET = {};
  ORDER.forEach(function (r) { rowNums(r).forEach(function (n) { SEATS.push(r + n); SEAT_SET[r + n] = true; }); });
  function floorOf(seat) { return 'ABCDEFG'.indexOf(seat.charAt(0)) >= 0 ? '1층' : '2층'; }
  /* 'A5' → 'A열 5번', 'O3' → 'O열 3번 (왼쪽 벽)' */
  function seatName(seat) {
    var r = seat.charAt(0), n = seat.slice(1);
    return r + '열 ' + n + '번' + (r === 'O' ? ' (왼쪽 벽쪽)' : r === 'P' ? ' (오른쪽 벽쪽)' : '');
  }
  /* 극장 안에서 찾아가는 말: 'A5' → '1층 · 무대에서 1번째 줄 · 왼쪽에서 5번째' */
  function seatWhere(seat) {
    var r = seat.charAt(0), n = +seat.slice(1);
    if (SIDES[r]) return '2층 ' + (r === 'O' ? '왼쪽' : '오른쪽') + ' 벽쪽 세로 줄 · 앞에서 ' + n + '번째';
    var i = ROWS.indexOf(r), f = i < 7 ? '1층' : '2층', line = i < 7 ? i + 1 : i - 6;
    return f + ' · ' + (i < 7 ? '무대에서 ' : '2층 앞에서 ') + line + '번째 줄 · 왼쪽부터 ' + n + '번 자리' + (WHEEL.indexOf(seat) >= 0 ? ' · 휠체어석' : '');
  }
  function seatSort(a, b) {
    var ra = ORDER.indexOf(a.charAt(0)), rb = ORDER.indexOf(b.charAt(0));
    return ra !== rb ? ra - rb : (+a.slice(1)) - (+b.slice(1));
  }

  /* ---------- 단체 자동 선택 ----------
     누른 좌석이 있는 줄에서 붙어 있는 빈 좌석을 먼저 고르고, 모자라면 같은 층의 가까운 줄(뒤 → 앞 차례)에서
     같은 세로 위치에 가깝게 붙은 좌석을 더 고름. 층(1층 A~G / 2층 H~N)·통로(A4, N5~13 자리)·
     다른 예약 좌석을 넘어가지 않음. O·P 세로 줄은 그 줄 안에서만, 휠체어석은 휠체어석끼리만.
     free(id): 고를 수 있는 빈 좌석인지 (이미 고른 좌석·예약된 좌석이면 false) */
  function autoPick(start, count, free) {
    var r0 = start.charAt(0), n0 = +start.slice(1), wheel = WHEEL.indexOf(start) >= 0;
    function usable(r, n) {
      var id = r + n;
      return !!SEAT_SET[id] && (id === start || free(id)) && (WHEEL.indexOf(id) >= 0) === wheel;
    }
    function runsIn(r) {   // 그 줄에서 붙어 있는 빈 좌석 묶음들 (번호가 끊기거나 차 있으면 나뉨)
      var runs = [], cur = [];
      rowNums(r).forEach(function (n) {
        if (usable(r, n) && cur.length && n === cur[cur.length - 1] + 1) cur.push(n);
        else { if (cur.length) runs.push(cur); cur = usable(r, n) ? [n] : []; }
      });
      if (cur.length) runs.push(cur);
      return runs;
    }
    function best(run, k, c, must) {   // run 에서 k석, 가운데가 c 에 가장 가깝게 (must 가 있으면 꼭 포함)
      k = Math.min(k, run.length);
      var bs = -1, bd = Infinity;
      for (var s = 0; s + k <= run.length; s++) {
        if (must != null && (run[s] > must || run[s + k - 1] < must)) continue;
        var d = Math.abs((run[s] + run[s + k - 1]) / 2 - c);
        if (d < bd - 1e-9) { bd = d; bs = s; }
      }
      return bs < 0 ? [] : run.slice(bs, bs + k);
    }
    var first = runsIn(r0).filter(function (run) { return run.indexOf(n0) >= 0; })[0];
    if (!first) return [];
    var w = best(first, count, n0, n0), out = w.map(function (n) { return r0 + n; });
    if (out.length >= count || SIDES[r0] || wheel) return out;
    var c = (w[0] + w[w.length - 1]) / 2, i0 = ROWS.indexOf(r0), floor = ROWS.filter(function (r, i) { return (i < 7) === (i0 < 7); });
    var j0 = floor.indexOf(r0), order = [];
    for (var d = 1; d < floor.length; d++) { if (floor[j0 + d]) order.push(floor[j0 + d]); if (floor[j0 - d]) order.push(floor[j0 - d]); }
    order.forEach(function (r) {
      var need = count - out.length;
      if (need <= 0) return;
      function gap(run) { return c < run[0] ? run[0] - c : c > run[run.length - 1] ? c - run[run.length - 1] : 0; }
      var runs = runsIn(r).sort(function (a, b) {
        var fa = a.length >= need, fb = b.length >= need;
        return fa !== fb ? (fa ? -1 : 1) : (gap(a) - gap(b)) || (b.length - a.length);
      });
      if (runs.length) best(runs[0], need, c).forEach(function (n) { out.push(r + n); });
    });
    return out;
  }
  /* ---------- 신청 순서대로 자동 배정 (2026-10-25 바꿈: 손님이 좌석을 고르지 않음) ----------
     줄마다 왼쪽 구역(1~9번)과 오른쪽 구역(10~17번)으로 나누고, 예약이 들어온 순서대로 구역을 번갈아
     (첫 예약 왼쪽 → 다음 예약 오른쪽 → 그다음 왼쪽 …) 그 구역의 앞줄부터 빈 좌석을 차례로 채움.
     예) 12명 → A5~A9, B1~B7 / 다음 16명 → A10~A17, B10~B17 / 다음 10명 → B8~B9, C1~C8
     일행 붙여 앉히기 (2026-10-26): 9명 이하이면 한 줄에 나란히 비어 있는 가장 앞줄 자리를 차례 구역에서 먼저, 없으면 반대 구역에서 찾음
       (오른쪽 구역은 한 줄이 8석이라 9명은 왼쪽 구역 줄로). 어느 구역에도 그런 줄이 없을 때만 앞줄부터 차례로.
     휠체어석 A1~A3 은 '휠체어 이용 인원'을 적은 만큼만 배정하고 나머지는 비워 둠. O·P 세로 줄도 배정하지 않음.
     휠체어 동행인 (2026-10-26): 차례와 상관없이 휠체어석 가까운 1층 왼쪽 구역 → 1층 오른쪽 구역 → 나머지 차례로.
       동행인이 2층으로 가면 apart 표시 (관리 화면에서 확인).
     차례 구역에 자리가 모자라면 다른 구역에 다 들어가면 그쪽으로, 아니면 남은 자리를 채우고 다른 구역으로 이어서.
     (2층은 1층과 떨어진 구조가 아니라서 구역을 끝까지 채운 뒤 2층으로 이어지는 지금 순서를 그대로 둠 · 2026-10-26 결정) */
  var BLOCK = { L: [], R: [] };
  ROWS.forEach(function (r) { rowNums(r).forEach(function (n) { if (WHEEL.indexOf(r + n) < 0) BLOCK[n <= 9 ? 'L' : 'R'].push(r + n); }); });
  function onFloor1(s) { return 'ABCDEFG'.indexOf(s.charAt(0)) >= 0; }
  /* 빈 좌석 목록(앞줄부터)에서 한 줄에 need 석이 나란히 비어 있는 가장 앞줄 자리 (없으면 null) */
  function rowRun(list, need) {
    var run = [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i], prev = run[run.length - 1];
      if (prev && prev.charAt(0) === s.charAt(0) && +s.slice(1) === +prev.slice(1) + 1) run.push(s); else run = [s];
      if (run.length >= need) return run.slice(run.length - need);
    }
    return null;
  }
  function takeFrom(list, need) { return (need <= 9 && rowRun(list, need)) || list.slice(0, need); }
  function assignSeats(occ, count, wheel, side) {
    var freeW = WHEEL.filter(function (s) { return !occ[s]; });
    if (wheel > freeW.length) return { err: 'wheel', left: freeW.length };
    var need = count - wheel;
    function free(b, f1) { return BLOCK[b].filter(function (s) { return !occ[s] && (f1 == null || onFloor1(s) === f1); }); }
    var all = free('L').length + free('R').length;
    if (need > all) return { err: 'full', left: all };
    var picked = [];
    if (wheel) {
      var L1 = free('L', true), R1 = free('R', true), F1 = L1.concat(R1);
      if (need <= L1.length) picked = takeFrom(L1, need);
      else if (need <= R1.length) picked = takeFrom(R1, need);
      else if (need <= F1.length) picked = F1.slice(0, need);
      else picked = F1.concat(free('L', false), free('R', false)).slice(0, need);
    } else {
      var first = free(side === 'R' ? 'R' : 'L'), other = free(side === 'R' ? 'L' : 'R');
      var row = need <= 9 ? rowRun(first, need) || rowRun(other, need) : null;   // 9명 이하: 차례 구역 → 반대 구역에서 한 줄
      if (row) picked = row;
      else {
        if (need > first.length && need <= other.length) { var t = first; first = other; other = t; }
        picked = need <= first.length ? first.slice(0, need) : first.concat(other.slice(0, need - first.length));
      }
    }
    var out = { seats: freeW.slice(0, wheel).concat(picked) };
    if (wheel && picked.some(function (s) { return !onFloor1(s); })) out.apart = true;
    return out;
  }
  function sideKey(showId) { return 'RSV_SIDE_' + showId.replace(/-/g, ''); }

  /* 고른 좌석을 붙어 있는 묶음으로 나눔 → ['E5–E17', 'F8–F10'] (한 묶음이면 길이 1) */
  function seatGroups(seats) {
    var s = (seats || []).slice().sort(seatSort), out = [], cur = null;
    s.forEach(function (id) {
      var r = id.charAt(0), n = +id.slice(1);
      if (cur && cur.r === r && n === cur.to + 1 && (WHEEL.indexOf(id) >= 0) === (WHEEL.indexOf(r + cur.to) >= 0)) cur.to = n;
      else { cur = { r: r, from: n, to: n }; out.push(cur); }
    });
    return out.map(function (g) { return g.from === g.to ? g.r + g.from : g.r + g.from + '–' + g.r + g.to; });
  }

  /* ---------- 상태 ---------- */
  var ST = { WAIT: '승인 대기', OK: '확정', NO: '거절', CANCEL: '취소', BLOCK: '막음' };
  var STATUSES = [ST.WAIT, ST.OK, ST.NO, ST.CANCEL, ST.BLOCK];
  var ACTIVE = {}; ACTIVE[ST.WAIT] = 'w'; ACTIVE[ST.OK] = 't'; ACTIVE[ST.BLOCK] = 'b';
  var SCHEMA = { sheet: '좌석예약', cols: [['id', '예약번호'], ['createdAt', '신청일시'], ['show', '공연일'], ['seats', '좌석'], ['count', '좌석 수'], ['status', '상태'],
    ['name', '예약자'], ['org', '기관·단체'], ['phone', '연락처'], ['email', '이메일'], ['note', '요청사항'], ['memo', '관리자 메모'],
    ['arrivedAt', '도착 시각'], ['decidedAt', '처리 일시'], ['mailLog', '메일 기록'], ['pw', '비밀번호(암호화 · 고치지 마세요)'],
    ['req', '요청번호(고치지 마세요)']] };   // 요청번호: 같은 신청을 다시 보내도 한 번만 접수되게 (맨 끝 열에 추가 · 2026-10-26)
  var DEFAULT_MAX = 100;                 // 한 번에 예약할 수 있는 인원(좌석) 수. 관리 화면 › 설정에서 바꿈 (RSV_MAX2)
  var DEFAULT_OPEN_AT = '2026-11-04 10:00';   // 예약 오픈 일시. 관리 화면 › 설정에서 바꿈 (RSV_OPEN_AT)
  var API_V = 2;        // 예약 화면과 서버의 약속 번호. 예전(좌석 직접 고르기) 화면이 보낸 신청은 새로고침하라고 돌려보냄

  /* ---------- 작은 도구 ---------- */
  var WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  function str(v) { return v == null ? '' : String(v); }
  function clean(v, max) {
    var s = str(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n').trim();
    return max ? s.slice(0, max) : s;
  }
  function fail(code, message, extra) { var o = { ok: false, code: code, message: message }; if (extra) for (var k in extra) o[k] = extra[k]; return o; }
  function findShow(id) { for (var i = 0; i < EVENT.shows.length; i++) if (EVENT.shows[i].id === id) return EVENT.shows[i]; return null; }
  function weekday(d) { var p = d.split('-'); return WEEK[new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay()]; }
  function dateLabel(d) { var p = d.split('-'); return (+p[1]) + '월 ' + (+p[2]) + '일 (' + weekday(d) + ')'; }
  function timeLabel(t) { var p = t.split(':'), h = +p[0]; return (h < 12 ? '오전 ' : '오후 ') + (h > 12 ? h - 12 : h) + ':' + p[1]; }
  function showLabel(id) { var s = findShow(id); return s ? dateLabel(s.id) + ' ' + timeLabel(s.time) : id; }
  function seatList(v) {
    var arr = Array.isArray(v) ? v : str(v).split(/[,\s]+/);
    var seen = {}, out = [];
    arr.forEach(function (x) { x = str(x).trim().toUpperCase(); if (x && !seen[x]) { seen[x] = true; out.push(x); } });
    return out.sort(seatSort);
  }
  function emailOk(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }
  function normEmail(s) { return clean(s, 120).toLowerCase(); }

  /* ---------- 저장 형식 ---------- */
  function toRec(r) {
    var st = STATUSES.indexOf(str(r.status).trim()) >= 0 ? str(r.status).trim() : ST.WAIT;
    return { id: str(r.id).trim(), createdAt: str(r.createdAt), show: str(r.show).trim(), seats: seatList(r.seats), status: st,
      name: str(r.name), org: str(r.org), phone: str(r.phone), email: normEmail(r.email), note: str(r.note), memo: str(r.memo),
      arrivedAt: str(r.arrivedAt), decidedAt: str(r.decidedAt), mailLog: str(r.mailLog), pw: str(r.pw), req: str(r.req) };
  }
  function fromRec(x) {
    var o = {};
    SCHEMA.cols.forEach(function (c) { o[c[0]] = str(x[c[0]]); });
    o.seats = x.seats.join(', ');
    o.count = String(x.seats.length);
    return o;
  }
  /* 저장은 바뀐 예약 줄만 고칩니다 (전체를 지우고 다시 쓰지 않음 → 쓰다가 실패해도 다른 예약은 그대로) */
  function readAll(env) { return env.store.read('rsv').map(toRec).filter(function (x) { return x.id; }); }
  function addRec(env, x) { env.store.append('rsv', fromRec(x)); bump(env); }
  /* quiet: 좌석·상태가 그대로인 저장(메일 기록 등)은 좌석 현황 캐시를 버리지 않음 (오픈 때 서버 부담을 줄이려고) */
  function saveRecs(env, list, quiet) {
    if (!list.length) return;
    if (list.length > 1 && env.store.updateMany) env.store.updateMany('rsv', list.map(fromRec));
    else list.forEach(function (x) { env.store.update('rsv', fromRec(x)); });
    if (!quiet) bump(env);
  }
  function removeRecs(env, ids) { if (ids.length) { env.store.remove('rsv', ids); bump(env); } }
  /* 좌석 현황 캐시 이름(버전)을 바꿈. 이것이 실패해도 저장한 예약은 그대로이고 캐시는 2분 뒤 저절로 새로 읽음 */
  function bump(env) {
    try { env.props.set('RSV_VER', String((+env.props.get('RSV_VER') || 0) + 1)); }
    catch (e) { if (typeof console !== 'undefined') console.error('RSV_VER 저장 실패: ' + (e && e.message)); }
    dropCfg(env);
  }
  /* 좌석 현황 조회(손님 화면이 몇 초마다 부름)는 설정값을 캐시(15초)에서 읽음 → 구글 '설정 읽기' 하루 한도(일반 계정 5만 회)를 아낌.
     예약·설정이 바뀌면(bump) 캐시를 지우므로 늦어도 15초 안에 새 값을 봄 */
  var CFG_KEYS = ['RSV_VER', 'RSV_MAX2', 'RSV_ARRIVE_TEST', 'RSV_OPEN_AT', 'RSV_OPEN'];
  function dropCfg(env) { try { env.cache.remove('rsv:cfg'); } catch (e) {} }
  function pollEnv(env) {
    var o = null;
    try { o = JSON.parse(env.cache.get('rsv:cfg') || 'null'); } catch (e) { o = null; }
    if (!o) {
      o = {}; CFG_KEYS.forEach(function (k) { o[k] = env.props.get(k); });
      try { env.cache.put('rsv:cfg', JSON.stringify(o), 15); } catch (e) {}
    }
    var p = env.props, e2 = {};
    for (var k in env) e2[k] = env[k];
    e2.props = { get: function (k) { return o.hasOwnProperty(k) ? o[k] : p.get(k); }, set: p.set, setMany: p.setMany };
    return e2;
  }
  /* 손님에게 보여 줄 내용 (비밀번호·관리자 메모 제외) */
  function mine(x) {
    return { id: x.id, show: x.show, showLabel: showLabel(x.show), seats: x.seats, status: x.status, name: x.name, org: x.org, phone: x.phone,
      email: x.email, note: x.note, arrivedAt: x.arrivedAt, testArrival: isTestArrival(x), createdAt: x.createdAt };
  }
  function adminView(x) { var o = mine(x); o.memo = x.memo; o.decidedAt = x.decidedAt; o.mailLog = x.mailLog; o.hasPw = !!x.pw; o.mailPending = anyPending(x); return o; }

  /* ---------- 설정 (스크립트 속성) ---------- */
  function settings(env) {
    var max = parseInt(env.props.get('RSV_MAX2'), 10);
    var testUntil = +(env.props.get('RSV_ARRIVE_TEST') || 0), test = testUntil > nowMs(env);
    var openAt = env.props.get('RSV_OPEN_AT') || DEFAULT_OPEN_AT;
    return { open: env.props.get('RSV_OPEN') !== '0', max: isNaN(max) ? DEFAULT_MAX : Math.max(1, Math.min(242, max)),
      openAt: openAt, openAtLabel: openLabel(openAt), notYet: env.now() < openAt,
      arriveTest: test, arriveTestUntil: test ? new Date(testUntil + 9 * 3600e3).toISOString().slice(11, 16) : '' };
  }
  /* '2026-11-04 10:00' → '11월 4일 (수) 오전 10:00' */
  function openLabel(at) { return dateLabel(at.slice(0, 10)) + ' ' + timeLabel(at.slice(11, 16)); }
  function notYetMsg(cfg) { return '좌석 예약은 ' + cfg.openAtLabel + '에 열려요. 그때 다시 와 주세요.'; }
  /* 도착 확인 시험 모드: 관리자가 켜면 2시간 동안 공연 전에도 '도착했어요'를 눌러 볼 수 있음 (저절로 꺼짐) */
  var ARRIVE_TEST_MS = 2 * 3600 * 1000;
  function canArrive(env, x) { return env.today() === x.show || (settings(env).arriveTest && env.today() < x.show); }
  /* 진짜 도착은 공연 당일에만 생기므로, 공연일이 아닌 날짜에 찍힌 도착은 '시험 도착'.
     시험 모드가 꺼져 있으면(끄기 · 2시간 지남) 시험 도착을 모두 '입장 안 함'으로 되돌립니다 */
  function isTestArrival(x) { return !!x.arrivedAt && x.arrivedAt.slice(0, 10) !== x.show; }
  function clearTestArrivals(env) {
    var n = 0;
    env.lock(function () {
      var hit = readAll(env).filter(isTestArrival);
      hit.forEach(function (x) { x.arrivedAt = ''; });
      saveRecs(env, hit);
      n = hit.length;
    });
    return n;
  }
  /* 읽은 예약에 시험 도착이 남아 있는데 시험 모드가 꺼져 있으면 되돌리고 다시 읽음 */
  function sweptRecs(env) {
    var recs = readAll(env);
    if (!settings(env).arriveTest && recs.some(isTestArrival)) { clearTestArrivals(env); recs = readAll(env); }
    return recs;
  }
  function siteUrl(env) { return str(env.siteUrl || 'https://doggaebee.kr').replace(/\/+$/, ''); }
  function notifyTo(env) { try { return env.notifyEmail ? str(env.notifyEmail()) : ''; } catch (e) { return ''; } }
  function adminLink(env) { return siteUrl(env) + '/reserve/admin.html'; }   // 홈페이지 예약 관리 (아이디·비밀번호)
  function contactLines() { return ['공연 문의: ' + EVENT.phone + ' · 예약 문의 메일: ' + EVENT.email, '예약 시스템(홈페이지) 문의: ' + EVENT.sysPhone]; }

  /* ---------- 좌석 현황 ---------- */
  function occupancy(recs) {
    var map = {};
    EVENT.shows.forEach(function (s) { map[s.id] = {}; });
    recs.forEach(function (x) {
      var code = ACTIVE[x.status];
      if (!code || !map[x.show]) return;
      x.seats.forEach(function (seat) { map[x.show][seat] = code; });
    });
    return map;
  }
  /* 남은 좌석은 자동 배정할 수 있는 좌석만 셈: 일반석(1~9번 · 10~17번 구역) / 휠체어석(A1~A3) 따로 */
  function freeCount(o) {
    var gen = 0, wh = 0;
    BLOCK.L.concat(BLOCK.R).forEach(function (x) { if (!o[x]) gen++; });
    WHEEL.forEach(function (x) { if (!o[x]) wh++; });
    return { gen: gen, wh: wh };
  }
  function showState(s, env, cfg, occ) {
    var f = freeCount(occ[s.id] || {});
    var closed = env.now() >= s.id + ' ' + s.time;
    return { id: s.id, date: s.id, time: s.time, label: showLabel(s.id), total: SEATS.length, left: f.gen + f.wh, leftGen: f.gen, leftWheel: f.wh,
      closed: closed, open: cfg.open && !closed };
  }
  function nowMs(env) { return env.ms ? env.ms() : new Date().getTime(); }

  function publicState(env) {
    var ver = env.props.get('RSV_VER') || '0', key = 'rsv:pub:' + ver;
    var hit = env.cache.get(key);
    if (hit) {   // 캐시에 담긴 동안 공연 시각이 지나도 마감으로 보이게 다시 계산
      var o = JSON.parse(hit), now = env.now();
      o.now = now;
      o.shows.forEach(function (s) { s.closed = now >= s.id + ' ' + s.time; s.open = o.open && !s.closed; });
      return o;
    }
    var cfg = settings(env), occ = occupancy(readAll(env));
    var out = {
      ok: true, ver: ver, open: cfg.open, max: cfg.max, now: env.now(),
      shows: EVENT.shows.map(function (s) { return showState(s, env, cfg, occ); }),
      seats: occ
    };
    try { env.cache.put(key, JSON.stringify(out), 120); } catch (e) {}
    return out;
  }

  /* ---------- 메일 ---------- */
  function esc(s) { return str(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function send(env, to, subject, lines, opts) {
    if (!env.mail || !to) return '보낼 곳 없음';
    try {
      var text = lines.join('\n');
      var html = '<div style="font-family:-apple-system,\'Apple SD Gothic Neo\',\'Malgun Gothic\',sans-serif;font-size:15px;line-height:1.7;color:#22302b;max-width:560px">'
        // 누를 수 있는 링크는 홈페이지 주소로 시작하는 줄만 (손님이 이름 칸 등에 적은 주소는 링크로 만들지 않음)
        + lines.map(function (l) { return l === '' ? '<br>' : l.indexOf(siteUrl(env) + '/') === 0 && !/\s/.test(l) ? '<p style="margin:0"><a href="' + esc(l) + '">' + esc(l) + '</a></p>' : '<p style="margin:0">' + esc(l) + '</p>'; }).join('')
        + '</div>';
      env.mail(to, subject, text, Object.assign({ htmlBody: html, name: EVENT.org }, opts || {}));
      return '';
    } catch (e) {
      return '메일 실패: ' + str(e && e.message).slice(0, 80);
    }
  }
  function ticketLines(x) {
    return [
      '공연: ' + EVENT.series + ' 〈' + EVENT.title + '〉',
      '주최: ' + EVENT.host + ' · 주관: ' + EVENT.org,
      '일시: ' + showLabel(x.show),
      '장소: ' + EVENT.venue + ' (' + EVENT.address + ')',
      '좌석: ' + x.seats.map(seatName).join(', ') + ' (' + x.seats.length + '석)',
      '예약번호: ' + x.id,
      '예약자: ' + x.name + (x.org ? ' · ' + x.org : '')
    ];
  }
  function mailAdmin(env, subject, x, head) {
    var to = notifyTo(env);
    var lines = (head ? [head, ''] : []).concat(ticketLines(x), ['연락처: ' + x.phone, '이메일: ' + x.email]);
    if (x.note) lines.push('요청사항: ' + x.note);
    lines.push('', '홈페이지 예약 관리에서 확인하고 승인해 주세요. (아이디·비밀번호로 로그인)', adminLink(env));
    return send(env, to, subject, lines, x.email ? { replyTo: x.email } : null);
  }
  /* 메일 제목용 좌석: 짧으면 'E5–E17, F8' 처럼 묶어서, 길면 '45석' (메일 제목 250자 한도 — 단체 예약도 메일이 나가게) */
  function seatSummary(seats) { var g = seatGroups(seats).join(', '); return g.length <= 40 ? g : seats.length + '석'; }
  function mailConfirm(env, x) {
    return send(env, x.email, '[' + EVENT.org + '] 좌석 예약이 확정되었습니다 · ' + showLabel(x.show) + ' · ' + seatSummary(x.seats), [
      x.name + '님, 좌석 예약이 확정되었습니다.', ''
    ].concat(ticketLines(x), [
      '',
      '공연 당일 극장에 도착하시면 아래 ‘내 예약 확인’ 화면에서 예약할 때 쓴 이메일과 비밀번호로 들어와',
      '‘공연장에 도착했어요’ 버튼을 눌러 주세요. 좌석 위치도 그 화면에서 볼 수 있습니다.',
      siteUrl(env) + '/reserve/my.html',
      '',
      '좌석 찾아가기:'
    ], x.seats.map(function (s) { return '· ' + seatName(s) + ' — ' + seatWhere(s); }), [
      '',
      '공연 10분 전까지 입장을 마쳐 주세요. 공연 중 사진·동영상 촬영은 안 돼요.',
      ''
    ], contactLines()));
  }
  /* 신청 바로 뒤 손님에게: 신청을 받았고 승인 대기라는 안내 */
  function mailReceived(env, x) {
    return send(env, x.email, '[' + EVENT.org + '] 좌석 예약 신청을 받았습니다 (승인 대기) · ' + showLabel(x.show) + ' · ' + x.seats.length + '석', [
      x.name + '님, 좌석 예약 신청을 받았습니다. 아직 확정 전(승인 대기)입니다.', ''
    ].concat(ticketLines(x), [
      '',
      '담당자가 확인한 뒤 이 메일 주소로 예약 확정 메일을 다시 보내 드립니다. 확정 전까지 좌석은 ‘승인 대기’로 잡혀 있습니다.',
      '신청 상태는 아래 ‘내 예약 확인’에서 예약할 때 쓴 이메일과 비밀번호로 언제든 볼 수 있습니다.',
      siteUrl(env) + '/reserve/my.html',
      ''
    ], contactLines()));
  }
  function mailReject(env, x, reason) {
    return send(env, x.email, '[' + EVENT.org + '] 좌석 예약 안내 · ' + showLabel(x.show), [
      x.name + '님, 신청하신 좌석 예약을 이번에는 확정하지 못했습니다.', ''
    ].concat(ticketLines(x), reason ? ['', '안내: ' + reason] : [], [
      '', '다른 좌석이나 회차로 다시 신청하실 수 있습니다.', siteUrl(env) + '/reserve/seats.html', ''
    ], contactLines()));
  }
  /* 메일 기록에 한 줄 더함. 길어지면 오래된 줄부터 덜어 내고 최근 기록을 남김 */
  function logMail(x, what, err) {
    var log = clean((x.mailLog ? x.mailLog + '\n' : '') + what + (err === false ? '' : err ? ' ✗ ' + err : ' ✓'));
    while (log.length > 1500 && log.indexOf('\n') >= 0) log = log.slice(log.indexOf('\n') + 1);
    x.mailLog = log.slice(-1500);
  }
  /* 발송 작업: 상태를 저장할 때 '시각 무엇 보내는 중' 줄을 같은 줄에 함께 저장하고, 보낸 뒤 결과 줄(✓/✗/안 보냄)을 붙임.
     결과 없이 '보내는 중'만 남아 있으면 보냈는지 알 수 없는 상태 → 자동으로 다시 보내지 않고 관리 화면에 '메일 확인 필요'로 보여 줌 */
  function jobStart(env, x, label) { logMail(x, env.now() + ' ' + label + ' 보내는 중', false); }
  function jobPending(x, label) {
    var pend = false;
    str(x.mailLog).split('\n').forEach(function (l) { if (l.indexOf(label) >= 0) pend = /보내는 중$/.test(l); });
    return pend;
  }
  /* 결과 없이 '보내는 중'으로 남은 작업이 있으면 그 시각('yyyy-MM-dd HH:mm'), 없으면 '' */
  function anyPending(x) {
    var by = {};   // 종류별 마지막 줄이 '보내는 중'이면 그 시각
    str(x.mailLog).split('\n').forEach(function (l) {
      ['담당자 알림', '접수 메일', '확정 메일', '거절 안내 메일'].forEach(function (lb) {
        if (l.indexOf(lb) >= 0) by[lb] = /(보내는 중|맡음 \w+)$/.test(l) ? l.slice(0, 16) : '';   // 맡은 뒤 결과가 없는 것도 확인 필요
      });
    });
    var at = '';
    for (var k in by) if (by[k] && (!at || by[k] < at)) at = by[k];
    return at;
  }
  /* 접수 메일을 보냈는지 (기록 기준): true 보냄 / false 실패 / null 모름 */
  function receiptMailed(x) { return /접수 메일[^\n]*✓/.test(x.mailLog) ? true : /접수 메일[^\n]*✗/.test(x.mailLog) ? false : null; }

  /* ---------- 손님: 예약 신청 ----------
     순서: 입력 확인 → (잠금 안) 같은 요청번호 확인 · 접수 시각 재확인 · 중복 확인 · 좌석 배정 · 예약 줄 저장 → (잠금 밖) 메일 → 메일 기록
     예약 줄이 저장된 뒤에는 메일·기록이 실패해도 예약은 그대로 남고 성공으로 답함 (메일은 관리 화면에서 다시 보내기).
     요청번호(reqId)는 예약 줄에 '요청번호:신청 내용 지문'으로 저장 → 응답을 못 받고 다시 보내도 같은 결과,
     같은 요청번호로 내용(회차·인원·휠체어·연락처)이 바뀐 신청이 오면 거절 */
  function bookResult(x, again) {
    var o = { ok: true, id: x.id, show: x.show, showLabel: showLabel(x.show), seats: x.seats, status: x.status };
    var m = receiptMailed(x);
    if (m !== null) o.mailed = m;
    if (again) o.again = true;
    return o;
  }
  function openCheck(env, show) {
    var cfg = settings(env);
    if (cfg.notYet) return fail('notyet', notYetMsg(cfg));
    if (!cfg.open) return fail('closed', '지금은 예약을 받지 않아요. 궁금한 점은 ' + EVENT.phone + '로 문의해 주세요.');
    if (env.now() >= show.id + ' ' + show.time) return fail('closed', '이 회차는 예약이 끝났어요.');
    return null;
  }
  function book(req, env) {
    if (req.website || req.dk_check) return { ok: true, id: 'R0000', seats: [] };   // 자동 입력 방지용 숨은 칸 (website 는 예전 화면 이름)
    var reqId = str(req.reqId).replace(/[^\w-]/g, '').slice(0, 60);
    if (+req.v !== API_V || reqId.length < 16) return fail('old', '예약 화면이 새로 바뀌었어요. 화면을 새로고침(⟳)한 뒤 다시 신청해 주세요.');
    if (!(+req.elapsed > 3000)) return fail('slow', '잠시 후 다시 눌러 주세요.');
    var cfg = settings(env), show = findShow(str(req.show));
    if (!show) return fail('show', '공연 회차를 골라 주세요.');
    // 좌석은 서버가 신청 순서대로 배정 (count = 인원, wheel = 그중 휠체어 이용 인원)
    var count = Math.floor(+req.count), wheel = Math.floor(+req.wheel || 0);
    if (!(count >= 1) || count > SEATS.length) return fail('seats', '인원을 정해 주세요.');   // 최대 인원은 잠금 안에서 (이미 접수된 같은 요청은 최대 인원이 바뀌어도 그대로 확인되게)
    if (!(wheel >= 0) || wheel > WHEEL.length || wheel > count) return fail('wheel', '휠체어 이용 인원을 확인해 주세요 (최대 ' + WHEEL.length + '명, 전체 인원 안에서).');

    var errors = {};
    var name = clean(req.name, 30), org = clean(req.org, 60), phone = clean(req.phone, 20), email = normEmail(req.email);
    var pw = str(req.password), note = clean(req.note, 300);
    var digits = phone.replace(/\D/g, '');
    if (!name) errors.name = '예약자 성함을 적어 주세요';
    if (!phone) errors.phone = '연락처를 적어 주세요';
    else if (!/^[\d\s()+-]+$/.test(phone) || digits.length < 9 || digits.length > 12) errors.phone = '전화번호를 확인해 주세요 (예: 010-1234-5678)';
    if (!email) errors.email = '확정 메일을 받을 이메일을 적어 주세요';
    else if (!emailOk(email)) errors.email = '이메일 주소를 확인해 주세요';
    if (pw.length < 4 || pw.length > 30) errors.password = '비밀번호는 4~30자로 정해 주세요';
    if (req.consent !== true) errors.consent = '개인정보 수집·이용에 동의해 주세요';   // 문자열 "false" 등은 동의로 보지 않음
    if (Object.keys(errors).length) return fail('invalid', '입력한 내용을 확인해 주세요.', { errors: errors });
    if (!env.sha256) return fail('server', '서버 설정이 끝나지 않았어요.');
    // 신청 내용 지문: 회차·인원·휠체어·연락처뿐 아니라 이름·기관·요청사항·비밀번호까지 (하나라도 바뀌면 같은 요청번호로 받지 않음)
    var tag = reqId + ':' + env.sha256(JSON.stringify([show.id, count, wheel, digits, email, name, org, note, pw])).slice(0, 16);   // 칸 경계가 분명하게 (JSON)
    var oldTag = reqId + ':' + env.sha256([show.id, count, wheel, digits, email, name, org, note, pw].join('|')).slice(0, 16);   // 10/26 오전까지의 지문 (같은 내용 재전송 인정)

    var out = null, rec = null, rl = 'rsvn:' + digits;
    try { env.lock(function () {
      var recs = readAll(env);
      var same = recs.filter(function (x) { return x.req && x.req.split(':')[0] === reqId; })[0];
      if (same) {
        if (same.req !== tag && same.req !== oldTag) { out = fail('reqchanged', '이 화면에서 먼저 보낸 신청(예약번호 ' + same.id + ')과 내용이 달라요. 먼저 ‘내 예약 확인’에서 앞의 신청을 확인한 뒤, 화면을 새로고침하고 다시 신청해 주세요.'); return; }
        out = bookResult(same, true);   // 메일은 다시 보내지 않음: 앞 요청이 '보내는 중'을 남겼으면 그 결과를 따름 (모르면 관리 화면에 '메일 확인 필요')
        return;
      }
      var c2 = settings(env);
      var closed = openCheck(env, show);   // 잠금을 기다리는 사이 마감·중단됐는지 저장 직전에 다시 확인
      if (closed) { out = closed; return; }
      if (count > c2.max) { out = fail('seats', '한 번에 ' + c2.max + '명(좌석)까지 예약할 수 있어요.'); return; }   // 그 사이 최대 인원이 바뀐 경우
      var dup = recs.filter(function (x) {
        return x.show === show.id && (x.status === ST.WAIT || x.status === ST.OK) && (x.email === email || x.phone.replace(/\D/g, '') === digits);
      })[0];
      if (dup) { out = fail('dup', '이 회차에 같은 휴대전화 번호나 같은 이메일로 신청한 예약이 이미 있어요. ‘내 예약 확인’에서 확인해 주세요. 인원을 더하거나 바꾸려면 ' + EVENT.phone + '로 연락 주세요.'); return; }
      if (+(env.cache.get(rl) || 0) >= 5) { out = fail('many', '같은 번호로 신청이 너무 많아요. 잠시 뒤 다시 해 주세요.'); return; }
      var side = env.props.get(sideKey(show.id)) === 'R' ? 'R' : 'L';
      var got = assignSeats(occupancy(recs)[show.id], count, wheel, side);
      if (got.err === 'wheel') { out = fail('wheel', '휠체어석이 ' + got.left + '석 남았어요. 휠체어 이용 인원을 줄여 주세요.', { leftWheel: got.left }); return; }
      if (got.err === 'full') { out = fail('full', '이 회차에 남은 일반석이 ' + got.left + '석이라 ' + (count - wheel) + '명은 예약할 수 없어요. 인원을 줄이거나 다른 회차를 골라 주세요.', { left: got.left }); return; }
      var ids = {}; recs.forEach(function (x) { ids[x.id] = true; });
      var id;
      do { id = 'R' + show.id.slice(5).replace('-', '') + '-' + env.uuid().slice(0, 4).toUpperCase(); } while (ids[id]);
      var salt = env.uuid().slice(0, 12);
      rec = { id: id, createdAt: env.now(), show: show.id, seats: got.seats, status: ST.WAIT, name: name, org: org, phone: phone, email: email,
        note: note, memo: got.apart ? env.now() + ' 확인 필요: 휠체어 동행인 일부가 2층 (1층 자리 없음)' : '', arrivedAt: '', decidedAt: '', mailLog: '',
        pw: salt + '$' + env.sha256(salt + ':' + pw), req: tag };
      jobStart(env, rec, '접수 메일');                                   // '보내는 중'을 예약 줄과 함께 저장 (캐시가 아니라 시트에 남음)
      addRec(env, rec);                                                   // 이 줄이 저장돼야 접수 (실패하면 여기서 오류)
      try { env.props.set(sideKey(show.id), side === 'L' ? 'R' : 'L'); }  // 저장된 뒤에만 차례를 넘김. 실패해도 접수는 그대로 (다음 예약이 같은 구역부터)
      catch (e) { if (typeof console !== 'undefined') console.error('배정 차례 저장 실패: ' + (e && e.message)); }
      out = bookResult(rec);
    }); } catch (e) {
      // 저장 마무리(flush 등)에서 실패: 시트를 다시 읽어 이 신청 줄이 남았는지 확인 → 남았으면 접수된 것으로 보고 이어서 메일
      if (typeof console !== 'undefined') console.error('예약 저장 마무리 실패: ' + (e && e.message));
      var back = null;
      if (rec) { try { back = readAll(env).filter(function (x) { return x.id === rec.id && x.req === tag; })[0] || null; } catch (x) { back = null; } }
      if (!back) return fail('unsure', '접수가 끝났는지 확인하지 못했어요. 내용을 바꾸지 말고 ‘예약 신청하기’를 한 번 더 눌러 주세요. 두 번 접수되지 않아요.');
      rec = back; out = bookResult(back);
    }
    if (!out.ok || out.again || !rec) return out;
    try { env.cache.put(rl, String(+(env.cache.get(rl) || 0) + 1), 3600); } catch (e) {}
    // 여기부터는 예약 저장과 따로: 실패해도 예약은 그대로 (메일 기록에 남고 관리 화면에서 다시 보내기)
    var aerr = mailAdmin(env, '[좌석 예약 신청] ' + showLabel(rec.show) + ' · ' + rec.name + ' · ' + rec.seats.length + '석', rec, '새 좌석 예약 신청이 들어왔습니다. (승인 대기)' + (rec.memo ? '\n' + rec.memo : ''));
    var merr = mailReceived(env, rec), at = env.now();
    out.mailed = !merr;
    if (!logOn(env, rec.id, [[at + ' 담당자 알림', aerr], [at + ' 접수 메일', merr]])) out.logSaved = false;
    return out;
  }
  /* 응답을 못 받았을 때 요청번호로 접수 결과 찾기 (개인정보는 돌려주지 않음) */
  function bookStatus(req, env) {
    var reqId = str(req.reqId).replace(/[^\w-]/g, '').slice(0, 60);
    if (reqId.length < 16) return fail('invalid', '요청번호가 없어요.');
    var x = readAll(env).filter(function (r) { return r.req && r.req.split(':')[0] === reqId; })[0];
    return x ? Object.assign(bookResult(x, true), { found: true }) : { ok: true, found: false };
  }
  /* 예약 한 건의 메일 기록에 줄들을 더함: lines = [[무엇, 오류 문구('' 이면 성공)], …]. 고친 예약을 돌려줌 (실패하면 null) */
  function logOn(env, id, lines) {
    var x = null;
    try {
      env.lock(function () {
        x = readAll(env).filter(function (r) { return r.id === id; })[0] || null;
        if (!x) return;
        lines.forEach(function (l) { logMail(x, l[0], l[1]); });
        saveRecs(env, [x], true);   // 메일 기록만 바뀜 → 좌석 현황 캐시는 그대로
      });
    } catch (e) { if (typeof console !== 'undefined') console.error('메일 기록 실패 ' + id + ': ' + (e && e.message)); return null; }   // 마무리(flush) 실패도 '기록 못 함'
    return x;
  }

  /* ---------- 손님: 내 예약 (이메일 + 비밀번호) ---------- */
  function guestLogin(req, env) {
    var email = normEmail(req.email), pw = str(req.password);
    if (!emailOk(email) || !pw) return fail('invalid', '이메일과 비밀번호를 적어 주세요.');
    var fk = 'rsvfail:' + email, fails = +(env.cache.get(fk) || 0);
    if (fails >= 8) return fail('locked', '비밀번호를 여러 번 틀렸어요. 15분 뒤 다시 해 주세요.');
    var hits = readAll(env).filter(function (x) {
      if (x.email !== email || x.status === ST.BLOCK || !x.pw) return false;
      var p = x.pw.split('$');
      return env.sha256(p[0] + ':' + pw) === p[1];
    }), ids = hits.map(function (x) { return x.id; });
    if (!ids.length) {
      env.cache.put(fk, String(fails + 1), 900);
      return fail('login', '이메일이나 비밀번호가 맞지 않아요. 비밀번호가 기억나지 않으면 ‘비밀번호 찾기’를 눌러 주세요.');
    }
    return guestSession(env, email, ids, hits);   // 방금 맞춰 본 그 비밀번호 값으로 세션을 만듦 (그 사이 바뀌었으면 다음 조회에서 끝남)
  }
  /* 로그인 세션에는 그 예약들의 비밀번호(암호화 값) 지문을 같이 둠 → 비밀번호를 바꾸면(본인 · 관리자) 예전 로그인은 끝남 */
  function pwSig(env, recs, ids) {
    var m = {}; recs.forEach(function (x) { m[x.id] = x.pw; });
    return env.sha256(ids.map(function (id) { return m[id] || '-'; }).join('|')).slice(0, 16);
  }
  function guestSession(env, email, ids, recs) {
    var token = env.uuid() + env.uuid();
    env.cache.put('rtok:' + token, JSON.stringify({ email: email, ids: ids, sig: pwSig(env, recs, ids) }), 21600);
    return listMine({ token: token }, env, token);
  }
  function guestLogout(req, env) { var t = str(req.token); if (t) env.cache.remove('rtok:' + t); return { ok: true }; }

  /* ---------- 비밀번호 찾기: 메일로 6자리 확인 번호(15분) → 새 비밀번호 ---------- */
  function makeCode(env) { return ('000000' + (parseInt(env.uuid().slice(0, 8), 16) % 1000000)).slice(-6); }
  function maskEmail(e) { var p = str(e).split('@'); return p.length < 2 ? '' : p[0].slice(0, 3) + '***@' + p[1]; }
  function sendCode(env, key, to, subject, lines, counted) {
    var rk = 'rsvcodecnt:' + key, n = +(env.cache.get(rk) || 0);
    if (!counted && n >= 3) return fail('many', '확인 번호를 너무 여러 번 요청했어요. 1시간 뒤 다시 해 주세요.');
    var code = makeCode(env);
    env.cache.put('rsvcode:' + key, JSON.stringify({ code: code, tries: 0, exp: nowMs(env) + 900e3 }), 900);
    if (!counted) env.cache.put(rk, String(n + 1), 3600);
    var err = send(env, to, subject, lines.concat(['', '확인 번호: ' + code, '', '15분 동안 쓸 수 있어요. 직접 요청하지 않았다면 이 메일은 무시해 주세요.', '예약 시스템(홈페이지) 문의: ' + EVENT.sysPhone]));
    return err ? fail('mail', '메일을 보내지 못했어요. 예약 시스템 문의 ' + EVENT.sysPhone + '로 연락 주세요.') : null;
  }
  /* 확인 번호 확인 (잠금 안에서 부름). 틀렸을 때 답은 번호가 있든 없든·지났든 언제나 같음 (발급 여부를 짐작할 수 없게).
     맞으면 null — 번호는 그대로 두고, 부른 쪽이 비밀번호 저장까지 마친 뒤 codeUsed 로 지움 (저장이 실패하면 같은 번호로 다시) */
  function codeFail() { return fail('code', '확인 번호가 맞지 않거나 15분이 지났어요. 메일에 온 6자리 숫자를 확인하시거나 확인 번호를 다시 받아 주세요.', { errors: { code: '확인 번호를 확인해 주세요' } }); }
  function checkCode(env, key, code) {
    var v = null;
    try { v = JSON.parse(env.cache.get('rsvcode:' + key) || 'null'); } catch (e) { v = null; }
    var left = v ? Math.floor(((+v.exp || 0) - nowMs(env)) / 1000) : 0;
    if (!v || left <= 0) { env.cache.remove('rsvcode:' + key); return codeFail(); }
    if (str(code).replace(/\D/g, '') !== v.code) {
      v.tries++;
      if (v.tries >= 5) env.cache.remove('rsvcode:' + key);
      else env.cache.put('rsvcode:' + key, JSON.stringify(v), Math.max(1, left));   // 남은 시간 그대로 (늘리지 않음)
      return codeFail();
    }
    return null;
  }
  function codeUsed(env, key) { var v = env.cache.get('rsvcode:' + key); env.cache.remove('rsvcode:' + key); return v; }
  /* 저장 마무리(flush)가 실패해 결과를 모를 때: 지운 번호를 남은 시간 그대로 되살림 (같은 번호로 다시 하면 같은 비밀번호로 다시 저장) */
  function codeRestore(env, key, v) {
    if (!v) return;
    try { var o = JSON.parse(v), left = Math.floor(((+o.exp || 0) - nowMs(env)) / 1000); if (left > 0) env.cache.put('rsvcode:' + key, v, left); } catch (e) {}
  }
  function unsureReset() { return fail('unsure', '비밀번호가 바뀌었는지 확인하지 못했어요. 같은 확인 번호와 새 비밀번호로 한 번 더 해 주세요.'); }
  /* 이메일 또는 휴대전화 번호로 예약을 찾아, 예약에 적힌 이메일로 확인 번호를 보냄.
     예약이 있든 없든 같은 답을 돌려줌 (다른 사람이 이메일·번호로 예약 여부를 알아낼 수 없게) */
  function guestForgot(req, env) {
    var email = normEmail(req.email), digits = str(req.phone).replace(/\D/g, '');
    if (email && !emailOk(email)) return fail('invalid', '이메일 주소를 확인해 주세요.', { errors: { email: '이메일 주소를 확인해 주세요' } });
    if (!email && digits.length < 9) return fail('invalid', '예약할 때 적은 이메일이나 휴대전화 번호를 넣어 주세요.');
    // 요청 수 제한: 예약이 있든 없든 같은 기준 (1시간에 3번)
    var fk = 'rsvforgot:' + (email || digits), many = false, hit = null, go = false;
    // 예약 찾기(시트 읽기)는 잠금 밖에서 — 잠금 안에서는 숫자 세기만 짧게 (아무 메일로나 보내는 요청이 예약 신청을 늦추지 않게)
    var found = readAll(env).filter(function (x) { return x.pw && x.status !== ST.BLOCK; })
      .filter(function (x) { return email ? x.email === email : x.phone.replace(/\D/g, '') === digits; })[0] || null;
    env.lock(function () {
      var n = +(env.cache.get(fk) || 0);
      if (n >= 3) { many = true; return; }
      env.cache.put(fk, String(n + 1), 3600);
      hit = found;
      if (!hit) return;
      var ck = 'rsvcodecnt:g:' + hit.email, c = +(env.cache.get(ck) || 0);   // 받는 이메일 기준 1시간 3통 (이메일·전화 찾기 합쳐서)
      if (c >= 3) return;
      env.cache.put(ck, String(c + 1), 3600);
      go = true;
      if (!email) env.cache.put('rsvcodeph:' + digits, hit.email, 900);
    });
    if (many) return fail('many', '확인 번호를 너무 여러 번 요청했어요. 1시간 뒤 다시 해 주세요. 급하면 예약 시스템 문의 ' + EVENT.sysPhone + '로 연락 주세요.');
    if (go) sendCode(env, 'g:' + hit.email, hit.email, '[' + EVENT.org + '] 좌석 예약 비밀번호 찾기 확인 번호', [
      EVENT.series + ' 〈' + EVENT.title + '〉 좌석 예약의 비밀번호를 새로 정하려면 아래 확인 번호를 넣어 주세요.'], true);
    return { ok: true, sentTo: email ? maskEmail(email) : '', byPhone: !email };
  }
  function guestReset(req, env) {
    var email = normEmail(req.email), pw = str(req.password), byPhone = !email && !!req.phone;
    if (byPhone) email = normEmail(env.cache.get('rsvcodeph:' + str(req.phone).replace(/\D/g, '')) || '');
    if (!byPhone && !emailOk(email)) return fail('invalid', '이메일 주소를 확인해 주세요.', { errors: { email: '이메일 주소를 확인해 주세요' } });
    if (pw.length < 4 || pw.length > 30) return fail('invalid', '새 비밀번호는 4~30자로 정해 주세요.', { errors: { password: '4~30자로 정해 주세요' } });
    if (!email || !env.cache.get('rsvcode:g:' + email)) return codeFail();   // 받은 확인 번호가 없으면 잠금 없이 바로 (같은 답)
    var bad = null, mine = [], used = null;
    try { env.lock(function () {   // 확인 번호 확인·소비와 비밀번호 저장을 한 번에 (같은 번호로 동시에 두 번 바꾸지 못하게)
      bad = email ? checkCode(env, 'g:' + email, req.code) : codeFail();
      if (bad) return;
      mine = readAll(env).filter(function (x) { return x.email === email && x.status !== ST.BLOCK; });
      mine.forEach(function (x) {
        var salt = env.uuid().slice(0, 12);
        x.pw = salt + '$' + env.sha256(salt + ':' + pw);
      });
      saveRecs(env, mine);
      used = codeUsed(env, 'g:' + email);   // 저장까지 끝난 뒤 번호를 지움
    }); } catch (e) { codeRestore(env, 'g:' + email, used); return unsureReset(); }
    if (bad) return bad;
    if (!mine.length) return fail('missing', '이 이메일로 신청한 예약을 찾지 못했어요.');
    env.cache.remove('rsvfail:' + email);
    var res = guestSession(env, email, mine.map(function (x) { return x.id; }), mine);
    res.reset = true;
    return res;
  }
  function guest(req, env) {
    var t = str(req.token), v = t && env.cache.get('rtok:' + t);
    if (!v) return null;
    try { return JSON.parse(v); } catch (e) { return null; }
  }
  function listMine(req, env, token) {
    var g = guest(req, env);
    if (!g) return fail('auth', '다시 로그인해 주세요.');
    var recs = sweptRecs(env);
    if (g.sig !== pwSig(env, recs, g.ids)) { env.cache.remove('rtok:' + str(req.token)); return fail('auth', '비밀번호가 바뀌어서 다시 로그인해야 해요.'); }
    var list = recs.filter(function (x) { return g.ids.indexOf(x.id) >= 0 && x.email === g.email; }).map(mine);
    var res = { ok: true, today: env.today(), now: env.now(), list: list, event: EVENT, arriveTest: settings(env).arriveTest };
    if (token) res.token = token;
    return res;
  }
  function guestUpdate(req, env, fn) {
    var g = guest(req, env);
    if (!g) return fail('auth', '다시 로그인해 주세요.');
    var id = str(req.id), out = null;
    if (g.ids.indexOf(id) < 0) return fail('missing', '예약을 찾을 수 없어요.');
    env.lock(function () {
      var recs = readAll(env), x = recs.filter(function (r) { return r.id === id; })[0];
      if (g.sig !== pwSig(env, recs, g.ids)) { out = fail('auth', '비밀번호가 바뀌어서 다시 로그인해야 해요.'); return; }
      if (!x || x.email !== g.email) { out = fail('missing', '예약을 찾을 수 없어요.'); return; }
      out = fn(x);
      if (out && out.ok) saveRecs(env, [x]);
    });
    if (out && out.ok) { out.item = mine(out.x); delete out.x; }
    return out;
  }
  function arrive(req, env) {
    return guestUpdate(req, env, function (x) {
      if (x.status !== ST.OK) return fail('status', x.status === ST.WAIT ? '아직 승인 대기 중인 예약이에요. 입구에서 직원에게 말씀해 주세요.' : '확정된 예약이 아니에요.');
      if (!canArrive(env, x)) return fail('day', '도착 확인은 공연 당일(' + dateLabel(x.show) + ')에 할 수 있어요.');
      if (!x.arrivedAt) x.arrivedAt = env.now();
      return { ok: true, x: x };
    });
  }
  function guestCancel(req, env) {
    var res = guestUpdate(req, env, function (x) {
      if (x.status !== ST.WAIT && x.status !== ST.OK) return fail('status', '이미 취소되었거나 처리된 예약이에요.');
      if (env.today() >= x.show) return fail('day', '공연 당일에는 ' + EVENT.phone + '로 연락해 주세요.');
      x.status = ST.CANCEL; x.decidedAt = env.now();
      stamp(env, x.id);   // 보내려던 확정 메일이 있으면 보내지 않게
      x.memo = clean((x.memo ? x.memo + '\n' : '') + env.now() + ' 예약자가 직접 취소', 500);
      return { ok: true, x: x };
    });
    if (res.ok) {
      var x = res.item;
      var err = mailAdmin(env, '[좌석 예약 취소] ' + showLabel(x.show) + ' · ' + x.name + ' · ' + seatSummary(x.seats), x, '예약자가 좌석 예약을 취소했습니다. 좌석은 다시 예약할 수 있게 풀렸습니다.');
      logOn(env, x.id, [[env.now() + ' 취소 알림(담당자)', err]]);
    }
    return res;
  }

  /* ---------- 관리자 (홈페이지 관리자 비밀번호로 로그인한 토큰) ----------
     로그인은 6시간 (구글 캐시 최대 보관 시간). 열쇠 값에는 관리자 비밀번호 지문을 넣어 둠 → 비밀번호를 바꾸면 예전 로그인은 끝남.
     비밀번호를 5번 틀리면 그 아이디만 15분 잠김 (없는 아이디로 틀려도 진짜 관리자는 잠기지 않음 · 전체 잠금은 두지 않음). */
  var ADMIN_SEC = 21600;
  var ADMIN_PW_MIN = 8;
  /* 관리자 비밀번호 암호화: 'k1$' + SHA-256 을 1000번 되풀이 (예전 값은 한 번 → 맞으면 그대로 받아 줌) */
  function adminHash(env, salt, pw) {
    var h = env.sha256(salt + ':' + pw);
    for (var i = 1; i < 1000; i++) h = env.sha256(salt + h);
    return 'k1$' + h;
  }
  function adminPwOk(env, c, pw) {
    if (!c || !c.hash) return false;
    return c.hash.indexOf('k1$') === 0 ? adminHash(env, c.salt, pw) === c.hash : env.sha256(c.salt + ':' + pw) === c.hash;
  }
  function credSig(c) { return c && c.hash ? c.hash.slice(-16) : '1'; }
  function adminSig(env) { return credSig(env.adminCred ? env.adminCred() : null); }
  /* 관리자 열쇠: 인증에 쓴(또는 방금 정한) 비밀번호 값에 묶음 → 그 사이 비밀번호가 바뀌었으면 이 열쇠는 바로 끝남 */
  function adminToken(env, c) {
    var token = env.uuid() + env.uuid();
    env.cache.put('rsvadm:' + token, credSig(c), ADMIN_SEC);
    return token;
  }
  function adminLogin(req, env) {
    if (!env.adminCred || !env.sha256) return fail('off', '아이디 로그인이 준비되지 않았어요.');
    var id = clean(req.id, 60).toLowerCase(), pw = str(req.password);
    var fk = 'rsvadmfail:' + env.sha256(id).slice(0, 16), fails = +(env.cache.get(fk) || 0);
    if (fails >= 5) return fail('locked', '비밀번호를 여러 번 틀려서 15분 동안 잠겼어요. 잠시 뒤 다시 해 주세요.');
    var c = env.adminCred();
    if (!c || !c.id || id !== str(c.id).toLowerCase() || !adminPwOk(env, c, pw)) {
      env.cache.put(fk, String(fails + 1), 900);
      return fail('login', '아이디나 비밀번호가 맞지 않아요.' + (fails >= 2 ? ' (' + (4 - fails) + '번 더 틀리면 15분 동안 잠겨요)' : ''));
    }
    env.cache.remove(fk);
    return { ok: true, token: adminToken(env, c) };
  }
  /* 관리자 비밀번호 찾기: 확인 번호를 담당자 알림 메일로 보냄 */
  function adminForgot(req, env) {
    var to = notifyTo(env);
    if (!to || !env.setAdminCred) return fail('off', '담당자 메일이 정해지지 않았어요. 구글 로그인으로 들어가 주세요.');
    var many = false;
    env.lock(function () {   // 요청 수(1시간 3번)를 잠금 안에서 세어 동시에 와도 넘지 않게
      var rk = 'rsvcodecnt:admin', n = +(env.cache.get(rk) || 0);
      if (n >= 3) { many = true; return; }
      env.cache.put(rk, String(n + 1), 3600);
    });
    if (many) return fail('many', '확인 번호를 너무 여러 번 요청했어요. 1시간 뒤 다시 해 주세요.');
    var bad = sendCode(env, 'admin', to, '[' + EVENT.org + '] 좌석 예약 관리 비밀번호 찾기 확인 번호', [
      '좌석 예약 관리 화면의 비밀번호를 새로 정하려면 아래 확인 번호를 넣어 주세요.',
      '아이디: ' + str((env.adminCred() || {}).id)], true);
    return bad || { ok: true, sentTo: to.split(',').map(maskEmail).join(', ') };
  }
  function adminReset(req, env) {
    var pw = str(req.password);
    if (pw.length < ADMIN_PW_MIN || pw.length > 60) return fail('invalid', '새 비밀번호는 ' + ADMIN_PW_MIN + '~60자로 정해 주세요.', { errors: { password: ADMIN_PW_MIN + '~60자로 정해 주세요' } });
    if (!env.cache.get('rsvcode:admin')) return codeFail();   // 받은 확인 번호가 없으면 잠금 없이 바로
    var bad = null, c = null, nc = null, used = null;
    try { env.lock(function () {   // 확인 번호 확인·소비와 새 비밀번호 저장을 한 번에
      bad = checkCode(env, 'admin', req.code);
      if (bad) return;
      c = env.adminCred() || {};
      var salt = env.uuid().slice(0, 16);
      nc = { id: c.id || 'admin', salt: salt, hash: adminHash(env, salt, pw) };
      env.setAdminCred(nc);
      used = codeUsed(env, 'admin');
    }); } catch (e) { codeRestore(env, 'admin', used); return unsureReset(); }
    if (bad) return bad;
    env.cache.remove('rsvadmfail:' + env.sha256(str(nc.id).toLowerCase()).slice(0, 16));
    return { ok: true, token: adminToken(env, nc), id: nc.id };
  }

  function adminSetCred(req, env) {
    if (!env.setAdminCred) return fail('off', '바꿀 수 없어요.');
    var id = clean(req.id, 40), pw = str(req.password), errors = {};
    if (!/^[A-Za-z0-9._@-]{3,40}$/.test(id)) errors.id = '아이디는 영문·숫자·.-_@ 3~40자로 정해 주세요';
    if (pw.length < ADMIN_PW_MIN || pw.length > 60) errors.password = '비밀번호는 ' + ADMIN_PW_MIN + '~60자로 정해 주세요';
    if (Object.keys(errors).length) return fail('invalid', '입력한 내용을 확인해 주세요.', { errors: errors });
    var salt = env.uuid().slice(0, 16), nc = { id: id, salt: salt, hash: adminHash(env, salt, pw) };
    env.setAdminCred(nc);
    return { ok: true, id: id, token: adminToken(env, nc) };   // 다른 곳의 예전 로그인은 끝나고, 바꾼 사람은 새 열쇠로 계속
  }
  function adminLogout(req, env) { env.cache.remove('rsvadm:' + str(req.token)); return { ok: true }; }

  function isAdmin(req, env) {
    var t = str(req.token), v = t && /^[a-f0-9]{32,}$/.test(t) ? env.cache.get('rsvadm:' + t) : null;
    return !!v && v === adminSig(env);
  }
  function adminData(env) {
    var cfg = settings(env), recs = sweptRecs(env), occ = occupancy(recs), quota = null, mailVia = null, sheetUrl = '';
    try { if (env.mailQuota) quota = env.mailQuota(); } catch (e) {}
    try { if (env.mailVia) mailVia = env.mailVia(); } catch (e) {}   // { name, limit, from } 메일을 어디로 보내는지
    try { if (env.sheetUrl) sheetUrl = env.sheetUrl(); } catch (e) {}
    return {
      ok: true, now: env.now(), today: env.today(), ver: env.props.get('RSV_VER') || '0', settings: cfg, event: EVENT,
      notifyEmail: notifyTo(env), mailQuota: quota, mailVia: mailVia, sheetUrl: sheetUrl, adminId: env.adminCred ? str((env.adminCred() || {}).id) : '',
      shows: EVENT.shows.map(function (s) { return showState(s, env, cfg, occ); }),
      list: recs.map(adminView).reverse()
    };
  }
  function findRec(env, id) { return readAll(env).filter(function (r) { return r.id === id; })[0] || null; }
  /* 예약 한 건 고치기: 잠금 안에서 그 줄만 저장. fn 이 { ok, x, mail: { label, when, send(x) → 오류 문구 } } 를 돌려주면
     저장한 뒤(잠금 밖) 메일을 보내고 메일 기록을 따로 남김 → 메일이 늦거나 실패해도 상태 변경은 이미 저장됨.
     보내기 직전에 예약을 다시 읽어 상태가 when 과 다르면(그 사이 취소 등) 보내지 않고 그 사실만 기록 */
  function adminUpdate(req, env, fn) {
    var id = str(req.id), out = null, want = null;
    try { env.lock(function () {
      var recs = readAll(env), x = recs.filter(function (r) { return r.id === id; })[0];
      if (!x) { out = fail('missing', '예약을 찾을 수 없어요. 새로고침해 주세요.'); return; }
      out = fn(x, recs);
      if (!out || !out.ok) return;
      if (out.same) { delete out.same; return; }
      var changed = x._stamp; delete x._stamp;
      if (out.mail) jobStart(env, x, out.mail.label);   // 상태와 '보내는 중'을 한 번에 저장
      want = fromRec(x);
      saveRecs(env, [x]);
      if (changed) out.stamp = stamp(env, x.id);
    }); } catch (e) {
      // 저장 마무리 실패: 다시 읽어 바꾼 내용이 그대로 저장됐으면 이어서(메일 포함), 아니면 실패로 알림
      var back = null;
      try { back = want && findRec(env, id); } catch (x) { back = null; }
      if (!back || JSON.stringify(fromRec(back)) !== JSON.stringify(want)) return fail('unsure', '저장됐는지 확인하지 못했어요. 새로고침해서 상태를 확인한 뒤 다시 해 주세요.');
      out.x = back;
    }
    if (!out || !out.ok) return out;
    var x = out.x, mail = out.mail;
    delete out.x; delete out.mail;
    if (mail) {
      var cur = findRec(env, x.id), line;
      var st0 = null; try { st0 = env.cache.get('rsvst:' + x.id); } catch (e) { st0 = null; }
      // 상태표가 남아 있고 다른 값이면(그 사이 다른 처리) 안 보냄. 상태표가 사라졌으면 상태만 보고 판단
      if (!cur || cur.status !== mail.when || (out.stamp && st0 && st0 !== out.stamp)) { line = [env.now() + ' ' + mail.label + ' 안 보냄 (그 사이 예약 상태가 바뀜)', false]; out.mailed = false; out.mailSkipped = true; }
      else { var err = mail.send(cur); line = [env.now() + ' ' + mail.label, err]; out.mailed = !err; if (err) out.mailError = err; }
      var y = logOn(env, x.id, [line]);
      if (y) x = y; else out.logSaved = false;
    }
    delete out.stamp;
    out.item = adminView(x);
    return out;
  }
  /* 상태가 바뀔 때마다 새 표(30분)를 남김: 메일을 보내기 직전 표가 그대로인지 보고, 그 사이 다른 처리(취소 등)가 있었으면 보내지 않음 */
  function stamp(env, id) {
    var t = env.uuid().slice(0, 12);
    try { env.cache.put('rsvst:' + id, t, 1800); return t; } catch (e) { return null; }   // 캐시 실패 → null (메일은 상태만 보고 판단)
  }
  function freeFor(x, recs) {
    var occ = {};
    recs.forEach(function (r) { if (r.id !== x.id && r.show === x.show && ACTIVE[r.status]) r.seats.forEach(function (s) { occ[s] = true; }); });
    return x.seats.filter(function (s) { return occ[s]; });
  }
  function decide(req, env) {
    var d = str(req.decision), reason = clean(req.reason, 300);
    return adminUpdate(req, env, function (x, recs) {
      if (x.status === ST.BLOCK) return fail('status', '막아 둔 좌석이에요.');
      if (d === 'approve' || d === 'wait') {
        if (!ACTIVE[x.status]) {
          var clash = freeFor(x, recs);
          if (clash.length) return fail('taken', '그 사이 다른 예약이 잡힌 좌석이 있어요: ' + clash.join(', '));
        }
        var was = x.status, to = d === 'approve' ? ST.OK : ST.WAIT;
        if (was === to) return { ok: true, x: x, same: true };   // 이미 그 상태 (두 번 누름): 아무것도 바꾸지 않음 → 먼저 누른 승인의 메일을 막지 않음
        if (!ACTIVE[was] || to === ST.WAIT) x.arrivedAt = '';   // 다시 살리거나 승인 대기로 돌리면 예전 도착 시각은 지움
        x.status = to; x.decidedAt = env.now(); x._stamp = true;
        var r = { ok: true, x: x };
        if (d === 'approve' && was !== ST.OK && x.email) r.mail = { label: '확정 메일', when: ST.OK, send: function (y) { return mailConfirm(env, y); } };
        return r;
      }
      if (d === 'reject' || d === 'cancel') {
        if (x.status !== ST.WAIT && x.status !== ST.OK) return fail('status', '이미 처리된 예약이에요. 새로고침해 주세요.');
        x.status = d === 'reject' ? ST.NO : ST.CANCEL; x.decidedAt = env.now(); x._stamp = true;
        if (reason) x.memo = clean((x.memo ? x.memo + '\n' : '') + env.now() + ' ' + reason, 500);
        var r2 = { ok: true, x: x };
        if (d === 'reject' && req.notify !== false && x.email) r2.mail = { label: '거절 안내 메일', when: ST.NO, send: function (y) { return mailReject(env, y, reason); } };
        return r2;
      }
      return fail('decision', '알 수 없는 처리예요.');
    });
  }
  /* 승인 대기 신청 여러 건을 한꺼번에 거절 (가짜 대량 신청 정리용). 승인 대기가 아닌 건은 건너뜀.
     안내 메일은 notify 가 true 일 때만 (가짜 주소로 메일 한도를 쓰지 않게 기본은 보내지 않음) */
  /* 승인 대기 신청 한꺼번에 거절.
     - 거절과 '거절 안내 메일 보내는 중'(알림 선택 시)을 같은 저장에 넣음 → 중간에 멈춰도 저장된 줄은 다시 하면 안내 메일을 이어서 보냄
     - 메일은 보내기 직전에 다시 읽어 아직 '거절'일 때만 (그 사이 다시 승인된 예약에는 옛 거절 안내를 보내지 않음) */
  function decideMany(req, env) {
    var ids = (Array.isArray(req.ids) ? req.ids : []).map(str).filter(Boolean).slice(0, 300), reason = clean(req.reason, 300);
    if (str(req.decision) !== 'reject') return fail('decision', '알 수 없는 처리예요.');
    if (!ids.length) return fail('ids', '거절할 신청을 골라 주세요.');
    var notify = req.notify === true, done = [], want = {}, label = '거절 안내 메일', partial = false;
    ids.forEach(function (id) { want[id] = true; });
    try { env.lock(function () {
      readAll(env).forEach(function (x) {
        if (!want[x.id] || x.status !== ST.WAIT) return;
        x.status = ST.NO; x.decidedAt = env.now();
        x.memo = clean((x.memo ? x.memo + '\n' : '') + env.now() + ' 한꺼번에 거절' + (reason ? ': ' + reason : ''), 500);
        if (notify && x.email) jobStart(env, x, label);
        done.push(x);
      });
      saveRecs(env, done);
      done.forEach(function (x) { stamp(env, x.id); });
    }); } catch (e) {
      partial = true;   // 일부만 저장됐을 수 있음 → 아래에서 실제로 저장된 줄만 이어서 처리
      if (typeof console !== 'undefined') console.error('한꺼번에 거절 중 저장 실패: ' + (e && e.message));
    }
    // 메일 보낼 대상: 이번에 고른 신청 중 '거절'이고 안내 메일이 '보내는 중'인 줄 (이번 처리 + 앞서 중간에 멈춘 처리).
    // 예약마다: ① 잠금 안에서 '맡음 표(실행 토큰)'를 기록에 남긴 실행만 보냄 (겹친 요청·재시도가 같은 메일을 또 보내지 않게)
    //           ② 보내기 바로 전에 다시 읽어 아직 '거절'이고 맡음 표가 내 것일 때만 보냄 (그 사이 다시 승인되면 안 보냄)
    var mailed = 0, failed = 0, skipped = 0, rejected = 0, logSaved = true;
    readAll(env).forEach(function (x) { if (want[x.id] && x.status === ST.NO) rejected++; });
    ids.forEach(function (id) {
      var token = env.uuid().slice(0, 10), mark = label + ' 맡음 ' + token, mine = null;
      try { env.lock(function () {
        var x = findRec(env, id);
        if (!x || !x.email || !jobPending(x, label)) return;
        if (x.status !== ST.NO) { logMail(x, env.now() + ' ' + label + ' 안 보냄 (그 사이 예약 상태가 바뀜)', false); saveRecs(env, [x], true); skipped++; return; }
        logMail(x, env.now() + ' ' + mark, false);
        saveRecs(env, [x], true);
        mine = x;
      }); } catch (e) { mine = null; logSaved = false; }   // 맡음 표를 확실히 남기지 못했으면 보내지 않음 (기록에 '보내는 중'이 남아 관리 화면에 확인 필요)
      if (!mine) return;
      var cur = null;
      try { cur = findRec(env, id); } catch (e) { cur = null; }
      var log = cur ? str(cur.mailLog).split('\n') : [];
      var stillMine = !!cur && cur.status === ST.NO && (log.filter(function (l) { return l.indexOf(label) >= 0; }).pop() || '').slice(-mark.length) === mark;
      var line;
      if (!stillMine) { line = [env.now() + ' ' + label + ' 안 보냄 (그 사이 예약 상태가 바뀜)', false]; skipped++; }
      else { var err = mailReject(env, cur, reason); if (err) failed++; else mailed++; line = [env.now() + ' ' + label, err]; }
      if (!logOn(env, id, [line])) logSaved = false;
    });
    var out = { ok: !partial, done: rejected, skipped: ids.length - rejected, mailed: mailed, mailFailed: failed, mailSkipped: skipped };
    if (!logSaved) out.logSaved = false;
    if (partial) { out.code = 'partial'; out.message = '한꺼번에 거절하다 중간에 멈췄어요. 거절된 ' + rejected + '건은 저장됐어요. 같은 신청을 골라 한 번 더 하면 남은 신청과 빠진 안내 메일을 이어서 처리해요.'; }
    return out;
  }
  /* 메일 다시 보내기: 상태는 바꾸지 않고 보낸 결과만 기록 (실패도 기록) */
  function resend(req, env) {
    var x = findRec(env, str(req.id));
    if (!x) return fail('missing', '예약을 찾을 수 없어요. 새로고침해 주세요.');
    if (!x.email) return fail('mail', '이메일이 없는 예약이에요.');
    var m = x.status === ST.WAIT ? [env.now() + ' 접수 메일(다시)', mailReceived(env, x)]
      : x.status === ST.OK ? [env.now() + ' 확정 메일(다시)', mailConfirm(env, x)] : null;
    if (!m) return fail('status', '승인 대기나 확정된 예약만 메일을 다시 보낼 수 있어요.');
    var y = logOn(env, x.id, [m]), extra = { item: adminView(y || x) };
    if (!y) extra.logSaved = false;
    return m[1] ? fail('mail', m[1], extra) : Object.assign({ ok: true }, extra);
  }
  /* 관리자 도착 처리: 확정된 예약만, 공연 당일(또는 도착 확인 시험 중)에만. 도착 취소는 언제나 */
  function adminArrive(req, env) {
    return adminUpdate(req, env, function (x) {
      if (req.arrived === false) { x.arrivedAt = ''; return { ok: true, x: x }; }
      if (x.status !== ST.OK) return fail('status', '확정된 예약만 도착 처리할 수 있어요.');
      if (!canArrive(env, x)) return fail('day', '도착 처리는 공연 당일(' + dateLabel(x.show) + ')에 할 수 있어요. 미리 해 보려면 ‘도착 확인 시험 모드’를 켜 주세요.');
      x.arrivedAt = x.arrivedAt || env.now();
      return { ok: true, x: x };
    });
  }
  function adminMemo(req, env) {
    return adminUpdate(req, env, function (x) { x.memo = clean(req.memo, 500); return { ok: true, x: x }; });
  }
  /* 예약자 정보 고치기 (이메일을 잘못 적은 경우 등) */
  function adminEdit(req, env) {
    var name = clean(req.name, 30), org = clean(req.org, 60), phone = clean(req.phone, 20), email = normEmail(req.email), errors = {};
    var digits = phone.replace(/\D/g, '');
    if (!name) errors.name = '예약자 성함을 적어 주세요';
    if (phone && (!/^[\d\s()+-]+$/.test(phone) || digits.length < 9 || digits.length > 12)) errors.phone = '전화번호를 확인해 주세요';
    if (email && !emailOk(email)) errors.email = '이메일 주소를 확인해 주세요';
    if (Object.keys(errors).length) return fail('invalid', '입력한 내용을 확인해 주세요.', { errors: errors });
    return adminUpdate(req, env, function (x) {
      var was = x.email;
      x.name = name; x.org = org; x.phone = phone; x.email = email;
      if (was !== email) x.memo = clean((x.memo ? x.memo + '\n' : '') + env.now() + ' 이메일 고침: ' + (was || '없음') + ' → ' + (email || '없음'), 500);
      return { ok: true, x: x };
    });
  }
  function adminPassword(req, env) {
    var pw = str(req.password);
    if (pw.length < 4 || pw.length > 30) return fail('invalid', '비밀번호는 4~30자로 정해 주세요.');
    return adminUpdate(req, env, function (x) {
      var salt = env.uuid().slice(0, 12);
      x.pw = salt + '$' + env.sha256(salt + ':' + pw);   // 예약자의 예전 로그인은 끝남 (세션의 비밀번호 지문이 달라짐)
      return { ok: true, x: x };
    });
  }
  function adminRemove(req, env) {
    var id = str(req.id), done = false;
    env.lock(function () {
      if (readAll(env).some(function (r) { return r.id === id; })) { removeRecs(env, [id]); done = true; }
    });
    return done ? { ok: true } : fail('missing', '예약을 찾을 수 없어요.');
  }
  /* 관리자가 좌석을 막거나(관계자석) 전화 예약을 바로 확정으로 등록 */
  function adminBook(req, env) {
    var show = findShow(str(req.show)), seats = seatList(req.seats), kind = req.kind === 'block' ? ST.BLOCK : ST.OK;
    if (!show) return fail('show', '회차를 골라 주세요.');
    if (!seats.length || seats.some(function (s) { return !SEAT_SET[s]; })) return fail('seats', '좌석을 골라 주세요.');
    var name = clean(req.name, 30) || (kind === ST.BLOCK ? '관계자석' : ''), phone = clean(req.phone, 20), email = normEmail(req.email), pw = str(req.password);
    var errors = {};
    if (kind === ST.OK) {
      if (!name) errors.name = '예약자 성함을 적어 주세요';
      if (email && !emailOk(email)) errors.email = '이메일 주소를 확인해 주세요';
      if (pw && (pw.length < 4 || pw.length > 30)) errors.password = '비밀번호는 4~30자로 정해 주세요';
      if (pw && !email) errors.email = '비밀번호를 정하려면 이메일도 적어 주세요';
    }
    if (Object.keys(errors).length) return fail('invalid', '입력한 내용을 확인해 주세요.', { errors: errors });
    var out = null, rec = null;
    env.lock(function () {
      var recs = readAll(env), occ = occupancy(recs)[show.id];
      var taken = seats.filter(function (s) { return occ[s]; });
      if (taken.length) { out = fail('taken', '이미 잡힌 좌석이 있어요: ' + taken.join(', '), { taken: taken }); return; }
      var ids = {}; recs.forEach(function (x) { ids[x.id] = true; });
      var id;
      do { id = (kind === ST.BLOCK ? 'X' : 'R') + show.id.slice(5).replace('-', '') + '-' + env.uuid().slice(0, 4).toUpperCase(); } while (ids[id]);
      var salt = env.uuid().slice(0, 12);
      rec = { id: id, createdAt: env.now(), show: show.id, seats: seats, status: kind, name: name, org: clean(req.org, 60), phone: phone, email: email,
        note: clean(req.note, 300), memo: kind === ST.OK ? '관리자 등록' : '', arrivedAt: '', decidedAt: env.now(), mailLog: '',
        pw: pw ? salt + '$' + env.sha256(salt + ':' + pw) : '', req: '' };
      addRec(env, rec);
      out = { ok: true };
    });
    if (!out.ok) return out;
    if (kind === ST.OK && email && req.notify !== false) {   // 저장한 뒤 확정 메일 (보내기 직전에 아직 확정인지 다시 확인)
      var cur = findRec(env, rec.id), line;
      if (!cur || cur.status !== ST.OK) { line = [env.now() + ' 확정 메일 안 보냄 (그 사이 예약 상태가 바뀜)', false]; out.mailed = false; }
      else { var err = mailConfirm(env, cur); line = [env.now() + ' 확정 메일', err]; out.mailed = !err; }
      var y = logOn(env, rec.id, [line]);
      if (y) rec = y; else out.logSaved = false;
    }
    out.item = adminView(rec);
    return out;
  }
  /* 예약 초기화: 예약을 보관 탭으로 옮긴 뒤 이 탭에서 뺌 (지우지 않음).
     막아 둔 좌석(관계자석 · 예약 불가)은 그대로 둠 — blocks: true 일 때만 막음도 함께 풂.
     보관 탭에는 비밀번호(암호화 값)는 옮기지 않음 */
  function resetAll(req, env) {
    if (req.confirm !== '초기화') return fail('confirm', '‘초기화’라고 적어 주세요.');
    if (!env.archive) return fail('off', '보관 기능이 준비되지 않았어요.');
    var moved = 0, kept = 0;
    try { env.lock(function () {
      var recs = readAll(env), go = recs.filter(function (x) { return req.blocks === true || x.status !== ST.BLOCK; });
      kept = recs.length - go.length;
      if (go.length) {
        env.archive(go.map(function (x) { var o = fromRec(x); o.pw = ''; o.req = ''; return o; }), env.now());   // 보관이 실패하면 여기서 멈춤 (예약은 그대로)
        removeRecs(env, go.map(function (x) { return x.id; }));
      }
      moved = go.length;
      EVENT.shows.forEach(function (s) { env.props.set(sideKey(s.id), 'L'); });   // 자동 배정 차례도 처음(왼쪽)부터 (잠금 안에서)
      env.props.set('RSV_ARRIVE_TEST', '0');
      dropCfg(env);
    }); } catch (e) {
      if (typeof console !== 'undefined') console.error('초기화 중단: ' + (e && e.message));
      return fail('partial', '초기화가 중간에 멈췄어요. 일부 예약만 옮겨졌을 수 있어요. ‘예약 전체 초기화’를 한 번 더 하면 남은 예약부터 이어서 옮겨요(보관 탭에 같은 내용이 두 번 들어가지 않아요).');
    }
    var cfg = settings(env), occ = occupancy(readAll(env));
    return { ok: true, moved: moved, kept: kept, shows: EVENT.shows.map(function (s) { return showState(s, env, cfg, occ); }) };
  }
  /* 설정 저장: 모두 확인한 뒤 한꺼번에 저장 (하나라도 틀리면 아무것도 바꾸지 않음) */
  function realAt(at) {
    var m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(at);
    if (!m) return false;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] && d.getUTCHours() === +m[4] && d.getUTCMinutes() === +m[5];
  }
  function saveSettings(req, env) {
    var set = {};
    if (req.open !== undefined) {
      if (typeof req.open !== 'boolean') return fail('invalid', '예약 받기 설정을 확인해 주세요.');   // 문자열 "false" 같은 값은 받지 않음
      set.RSV_OPEN = req.open ? '1' : '0';
    }
    if (req.arriveTest !== undefined && typeof req.arriveTest !== 'boolean') return fail('invalid', '도착 확인 시험 모드 값을 확인해 주세요.');
    if (req.max !== undefined) {
      var n = parseInt(req.max, 10);
      if (isNaN(n) || n < 1 || n > 242 || String(n) !== str(req.max).trim()) return fail('invalid', '최대 인원은 1~242 사이 숫자로 적어 주세요.');
      set.RSV_MAX2 = String(n);
    }
    if (req.openAt !== undefined) {
      var at = str(req.openAt).trim().replace('T', ' ');
      if (at.length === 19 && /:00$/.test(at)) at = at.slice(0, 16);   // 초(:00)까지 온 값만 받아 줌, 그 밖에 뒤에 붙은 글자는 거절
      if (!realAt(at)) return fail('invalid', '예약 오픈 일시를 확인해 주세요. (예: 2026-11-04 10:00)');
      set.RSV_OPEN_AT = at;
    }
    if (req.arriveTest !== undefined) set.RSV_ARRIVE_TEST = req.arriveTest ? String(nowMs(env) + ARRIVE_TEST_MS) : '0';
    if (env.props.setMany) env.props.setMany(set);   // 한 번에 저장 (일부만 바뀌지 않게)
    else for (var k in set) env.props.set(k, set[k]);
    var cleared = req.arriveTest === false ? clearTestArrivals(env) : 0;
    bump(env);
    return { ok: true, settings: settings(env), cleared: cleared };
  }

  /* ---------- 요청 처리 ---------- */
  function handle(req, env) {
    req = req || {};
    try {
      if (env.ensure) env.ensure();
      var a = str(req.action);
      if (a === 'rsvState') {
        var pe = pollEnv(env), st = publicState(pe), cf = settings(pe);
        st.max = cf.max; st.openAt = cf.openAt; st.openAtLabel = cf.openAtLabel; st.notYet = cf.notYet;   // 캐시와 상관없이 지금 기준
        st.ms = nowMs(env);   // 서버 시계 (화면의 남은 시간을 서버 기준으로 셈)
        return st;
      }
      if (a === 'rsvHold') return fail('old', '예약 화면이 새로 바뀌었어요. 화면을 새로고침(⟳)한 뒤 다시 신청해 주세요.');
      if (a === 'rsvBook') return book(req, env);
      if (a === 'rsvBookStatus') return bookStatus(req, env);
      if (a === 'rsvLogout') return guestLogout(req, env);
      if (a === 'rsvLogin') return guestLogin(req, env);
      if (a === 'rsvForgot') return guestForgot(req, env);
      if (a === 'rsvReset') return guestReset(req, env);
      if (a === 'rsvMine') return listMine(req, env);
      if (a === 'rsvArrive') return arrive(req, env);
      if (a === 'rsvCancel') return guestCancel(req, env);
      if (a === 'rsvAdminLogin') return adminLogin(req, env);
      if (a === 'rsvAdminForgot') return adminForgot(req, env);
      if (a === 'rsvAdminReset') return adminReset(req, env);
      if (a.indexOf('rsvAdmin') === 0) {
        if (!isAdmin(req, env)) return fail('auth', '관리자 로그인이 필요해요.');
        switch (a) {
          case 'rsvAdmin': return adminData(env);
          case 'rsvAdminDecide': return decide(req, env);
          case 'rsvAdminDecideMany': return decideMany(req, env);
          case 'rsvAdminResend': return resend(req, env);
          case 'rsvAdminArrive': return adminArrive(req, env);
          case 'rsvAdminMemo': return adminMemo(req, env);
          case 'rsvAdminPassword': return adminPassword(req, env);
          case 'rsvAdminEdit': return adminEdit(req, env);
          case 'rsvAdminResetAll': return resetAll(req, env);
          case 'rsvAdminRemove': return adminRemove(req, env);
          case 'rsvAdminBook': return adminBook(req, env);
          case 'rsvAdminSettings': return saveSettings(req, env);
          case 'rsvAdminCred': return adminSetCred(req, env);
          case 'rsvAdminLogout': return adminLogout(req, env);
        }
      }
      return fail('action', '알 수 없는 요청입니다.');
    } catch (e) {
      if (typeof console !== 'undefined') console.error(e);
      return fail('server', '잠시 문제가 생겼어요. 잠시 후 다시 시도해 주세요.');
    }
  }

  return {
    EVENT: EVENT, API_V: API_V, adminSig: adminSig, assignSeats: assignSeats, BLOCK: BLOCK, autoPick: autoPick, seatGroups: seatGroups, ROWS: ROWS, SIDES: SIDES, WHEEL: WHEEL, SEATS: SEATS, ST: ST, STATUSES: STATUSES, SCHEMA: SCHEMA,
    rowNums: rowNums, floorOf: floorOf, seatName: seatName, seatWhere: seatWhere, seatSort: seatSort, showLabel: showLabel, dateLabel: dateLabel, timeLabel: timeLabel, findShow: findShow,
    handle: handle
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = RSV;
