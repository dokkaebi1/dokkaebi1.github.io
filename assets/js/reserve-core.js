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
    series: '기장군 아동무대공연',
    genre: '아동극 · 생활습관 교육극',
    venue: '안데르센극장',
    address: '부산광역시 기장군 장안읍 장안로 211',
    org: '극단 도깨비',
    phone: '010-3837-8479',
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

  /* ---------- 상태 ---------- */
  var ST = { WAIT: '승인 대기', OK: '확정', NO: '거절', CANCEL: '취소', BLOCK: '막음' };
  var STATUSES = [ST.WAIT, ST.OK, ST.NO, ST.CANCEL, ST.BLOCK];
  var ACTIVE = {}; ACTIVE[ST.WAIT] = 'w'; ACTIVE[ST.OK] = 't'; ACTIVE[ST.BLOCK] = 'b';
  var SCHEMA = { sheet: '좌석예약', cols: [['id', '예약번호'], ['createdAt', '신청일시'], ['show', '공연일'], ['seats', '좌석'], ['count', '좌석 수'], ['status', '상태'],
    ['name', '예약자'], ['org', '기관·단체'], ['phone', '연락처'], ['email', '이메일'], ['note', '요청사항'], ['memo', '관리자 메모'],
    ['arrivedAt', '도착 시각'], ['decidedAt', '처리 일시'], ['mailLog', '메일 기록'], ['pw', '비밀번호(암호화 · 고치지 마세요)']] };
  var DEFAULT_MAX = 30;
  var HOLD_SEC = 240;   // 고르는 중인 좌석을 '예약 중'으로 잡아 두는 시간(초). 화면이 열려 있으면 1분마다 연장됩니다

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
      arrivedAt: str(r.arrivedAt), decidedAt: str(r.decidedAt), mailLog: str(r.mailLog), pw: str(r.pw) };
  }
  function fromRec(x) {
    var o = {};
    SCHEMA.cols.forEach(function (c) { o[c[0]] = str(x[c[0]]); });
    o.seats = x.seats.join(', ');
    o.count = String(x.seats.length);
    return o;
  }
  function readAll(env) { return env.store.read('rsv').map(toRec).filter(function (x) { return x.id; }); }
  function writeAll(env, recs) {
    env.store.write('rsv', recs.sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0; }).map(fromRec));
    bump(env);
  }
  function bump(env) { env.props.set('RSV_VER', String((+env.props.get('RSV_VER') || 0) + 1)); }
  /* 손님에게 보여 줄 내용 (비밀번호·관리자 메모 제외) */
  function mine(x) {
    return { id: x.id, show: x.show, showLabel: showLabel(x.show), seats: x.seats, status: x.status, name: x.name, org: x.org, phone: x.phone,
      email: x.email, note: x.note, arrivedAt: x.arrivedAt, createdAt: x.createdAt };
  }
  function adminView(x) { var o = mine(x); o.memo = x.memo; o.decidedAt = x.decidedAt; o.mailLog = x.mailLog; o.hasPw = !!x.pw; return o; }

  /* ---------- 설정 (스크립트 속성) ---------- */
  function settings(env) {
    var max = parseInt(env.props.get('RSV_MAX'), 10);
    return { open: env.props.get('RSV_OPEN') !== '0', max: isNaN(max) ? DEFAULT_MAX : Math.max(1, Math.min(242, max)) };
  }
  function siteUrl(env) { return str(env.siteUrl || 'https://dokkaebi1.github.io').replace(/\/+$/, ''); }
  function notifyTo(env) { try { return env.notifyEmail ? str(env.notifyEmail()) : ''; } catch (e) { return ''; } }
  function adminLink(env) { try { return env.adminUrl ? str(env.adminUrl()) : siteUrl(env) + '/reserve/admin.html'; } catch (e) { return siteUrl(env) + '/reserve/admin.html'; } }

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
  function showState(s, env, cfg, occ) {
    var taken = Object.keys(occ[s.id] || {}).length;
    var closed = env.now() >= s.id + ' ' + s.time;
    return { id: s.id, date: s.id, time: s.time, label: showLabel(s.id), total: SEATS.length, left: SEATS.length - taken,
      closed: closed, open: cfg.open && !closed };
  }
  /* ---------- 고르는 중인 좌석 잡아 두기 (구글 캐시, 회차별 {좌석: {h: 고르는 사람, t: 끝나는 시각(ms)}}) ---------- */
  function nowMs(env) { return env.ms ? env.ms() : new Date().getTime(); }
  function holderOk(h) { return /^[a-f0-9]{16,40}$/.test(str(h)); }
  function readHolds(env, show) {
    var m = {}, now = nowMs(env), out = {};
    try { m = JSON.parse(env.cache.get('rsv:hold:' + show) || '{}') || {}; } catch (e) { m = {}; }
    for (var k in m) if (m[k] && m[k].t > now) out[k] = m[k];
    return out;
  }
  function writeHolds(env, show, m) { env.cache.put('rsv:hold:' + show, JSON.stringify(m), HOLD_SEC + 60); }
  /* 다른 사람이 잡아 둔 좌석만 {좌석: 'h'} 로 */
  function holdMap(env, me) {
    var out = {};
    EVENT.shows.forEach(function (s) {
      var m = readHolds(env, s.id), o = {};
      for (var k in m) if (m[k].h !== me) o[k] = 'h';
      out[s.id] = o;
    });
    return out;
  }
  function releaseHolds(env, show, holder, seats) {
    var m = readHolds(env, show), set = {};
    (seats || []).forEach(function (x) { set[x] = true; });
    for (var k in m) if ((holder && m[k].h === holder) || set[k]) delete m[k];
    writeHolds(env, show, m);
  }
  /* 손님이 좌석을 누를 때마다: 이 사람의 잡아 둔 좌석을 seats 로 바꿈. 다른 사람이 예약했거나 잡아 둔 좌석은 빼고 알려 줌 */
  function hold(req, env) {
    var holder = str(req.holder), show = findShow(str(req.show));
    if (!holderOk(holder) || !show) return fail('invalid', '새로고침해 주세요.');
    var cfg = settings(env), seats = seatList(req.seats).filter(function (x) { return SEAT_SET[x]; }).slice(0, cfg.max);
    if (seats.length && (!cfg.open || env.now() >= show.id + ' ' + show.time)) return fail('closed', '지금은 이 회차를 예약할 수 없어요.');
    var out = null;
    env.lock(function () {
      var occ = publicState(env).seats[show.id] || {}, m = readHolds(env, show.id), now = nowMs(env);
      var got = [], lost = [];
      for (var k in m) if (m[k].h === holder) delete m[k];
      seats.forEach(function (x) {
        if (occ[x] || m[x]) lost.push(x);
        else { m[x] = { h: holder, t: now + HOLD_SEC * 1000 }; got.push(x); }
      });
      writeHolds(env, show.id, m);
      out = { ok: true, show: show.id, held: got, lost: lost, holds: holdMap(env, holder), sec: HOLD_SEC };
    });
    return out;
  }

  function publicState(env) {
    var ver = env.props.get('RSV_VER') || '0', key = 'rsv:pub:' + ver;
    var hit = env.cache.get(key);
    if (hit) { var o = JSON.parse(hit); o.now = env.now(); return o; }
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
        + lines.map(function (l) { return l === '' ? '<br>' : /^https?:\/\//.test(l) ? '<p style="margin:0"><a href="' + esc(l) + '">' + esc(l) + '</a></p>' : '<p style="margin:0">' + esc(l) + '</p>'; }).join('')
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
    lines.push('', '예약 관리 화면에서 확인하고 승인해 주세요. (극단 도깨비 구글 계정 로그인)', adminLink(env));
    return send(env, to, subject, lines, x.email ? { replyTo: x.email } : null);
  }
  function mailConfirm(env, x) {
    return send(env, x.email, '[' + EVENT.org + '] 좌석 예약이 확정되었습니다 · ' + showLabel(x.show) + ' · ' + x.seats.join(', '), [
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
      '공연 10~15분 전까지 도착해 주세요. 문의: ' + EVENT.phone
    ]));
  }
  function mailReject(env, x, reason) {
    return send(env, x.email, '[' + EVENT.org + '] 좌석 예약 안내 · ' + showLabel(x.show), [
      x.name + '님, 신청하신 좌석 예약을 이번에는 확정하지 못했습니다.', ''
    ].concat(ticketLines(x), reason ? ['', '안내: ' + reason] : [], [
      '', '다른 좌석이나 회차로 다시 신청하실 수 있습니다.', siteUrl(env) + '/reserve/seats.html', '', '문의: ' + EVENT.phone
    ]));
  }
  function logMail(x, what, err) { x.mailLog = clean((x.mailLog ? x.mailLog + '\n' : '') + what + (err ? ' ✗ ' + err : ' ✓'), 600); }

  /* ---------- 손님: 예약 신청 ---------- */
  function book(req, env) {
    if (req.website) return { ok: true, id: 'R0000', seats: [] };            // 자동 입력 방지용 숨은 칸
    if (!(+req.elapsed > 3000)) return fail('slow', '잠시 후 다시 눌러 주세요.');
    var cfg = settings(env), show = findShow(str(req.show));
    if (!show) return fail('show', '공연 회차를 골라 주세요.');
    if (!cfg.open) return fail('closed', '지금은 온라인 예약을 받지 않아요. ' + EVENT.phone + '로 문의해 주세요.');
    if (env.now() >= show.id + ' ' + show.time) return fail('closed', '이 회차는 예약이 끝났어요.');
    var seats = seatList(req.seats);
    if (!seats.length) return fail('seats', '좌석을 골라 주세요.');
    if (seats.some(function (s) { return !SEAT_SET[s]; })) return fail('seats', '없는 좌석이 있어요. 새로고침해 주세요.');
    if (seats.length > cfg.max) return fail('seats', '한 번에 ' + cfg.max + '석까지 예약할 수 있어요. 단체 관람은 ' + EVENT.phone + '로 문의해 주세요.');

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
    if (!req.consent) errors.consent = '개인정보 수집·이용에 동의해 주세요';
    if (Object.keys(errors).length) return fail('invalid', '입력한 내용을 확인해 주세요.', { errors: errors });
    if (!env.sha256) return fail('server', '서버 설정이 끝나지 않았어요.');

    var rl = 'rsvn:' + digits, n = +(env.cache.get(rl) || 0);
    if (n >= 5) return fail('many', '신청이 너무 많아요. ' + EVENT.phone + '로 문의해 주세요.');

    var out = null;
    env.lock(function () {
      var recs = readAll(env), occ = occupancy(recs)[show.id];
      var taken = seats.filter(function (s) { return occ[s]; });
      if (taken.length) { out = fail('taken', '방금 다른 분이 예약한 좌석이 있어요: ' + taken.join(', '), { taken: taken }); return; }
      var holds = readHolds(env, show.id), me = str(req.holder);
      var held = seats.filter(function (s) { return holds[s] && holds[s].h !== me; });
      if (held.length) { out = fail('taken', '다른 분이 지금 예약하고 있는 좌석이 있어요: ' + held.join(', '), { taken: held }); return; }
      var dup = recs.filter(function (x) {
        return x.show === show.id && (x.status === ST.WAIT || x.status === ST.OK) && (x.email === email || x.phone.replace(/\D/g, '') === digits);
      })[0];
      if (dup) { out = fail('dup', '이미 이 회차에 같은 연락처나 이메일로 신청한 예약이 있어요. ‘내 예약 확인’에서 확인해 주세요. 좌석을 더하거나 바꾸려면 ' + EVENT.phone + '로 연락 주세요.'); return; }
      var ids = {}; recs.forEach(function (x) { ids[x.id] = true; });
      var id;
      do { id = 'R' + show.id.slice(5).replace('-', '') + '-' + env.uuid().slice(0, 4).toUpperCase(); } while (ids[id]);
      var salt = env.uuid().slice(0, 12);
      var rec = { id: id, createdAt: env.now(), show: show.id, seats: seats, status: ST.WAIT, name: name, org: org, phone: phone, email: email,
        note: note, memo: '', arrivedAt: '', decidedAt: '', mailLog: '', pw: salt + '$' + env.sha256(salt + ':' + pw) };
      env.store.append('rsv', fromRec(rec));
      bump(env);
      releaseHolds(env, show.id, me, seats);
      out = { ok: true, id: id, show: show.id, showLabel: showLabel(show.id), seats: seats, status: ST.WAIT, rec: rec };
    });
    if (!out.ok) return out;
    env.cache.put(rl, String(n + 1), 3600);
    var rec = out.rec; delete out.rec;
    mailAdmin(env, '[좌석 예약 신청] ' + showLabel(rec.show) + ' · ' + rec.name + ' · ' + rec.seats.length + '석', rec, '새 좌석 예약 신청이 들어왔습니다. (승인 대기)');
    return out;
  }

  /* ---------- 손님: 내 예약 (이메일 + 비밀번호) ---------- */
  function guestLogin(req, env) {
    var email = normEmail(req.email), pw = str(req.password);
    if (!emailOk(email) || !pw) return fail('invalid', '이메일과 비밀번호를 적어 주세요.');
    var fk = 'rsvfail:' + email, fails = +(env.cache.get(fk) || 0);
    if (fails >= 8) return fail('locked', '비밀번호를 여러 번 틀렸어요. 15분 뒤 다시 해 주세요.');
    var ids = readAll(env).filter(function (x) {
      if (x.email !== email || x.status === ST.BLOCK || !x.pw) return false;
      var p = x.pw.split('$');
      return env.sha256(p[0] + ':' + pw) === p[1];
    }).map(function (x) { return x.id; });
    if (!ids.length) {
      env.cache.put(fk, String(fails + 1), 900);
      return fail('login', '이메일이나 비밀번호가 맞지 않아요.');
    }
    var token = env.uuid() + env.uuid();
    env.cache.put('rtok:' + token, JSON.stringify({ email: email, ids: ids }), 21600);
    return listMine({ token: token }, env, token);
  }
  function guest(req, env) {
    var t = str(req.token), v = t && env.cache.get('rtok:' + t);
    if (!v) return null;
    try { return JSON.parse(v); } catch (e) { return null; }
  }
  function listMine(req, env, token) {
    var g = guest(req, env);
    if (!g) return fail('auth', '다시 로그인해 주세요.');
    var list = readAll(env).filter(function (x) { return g.ids.indexOf(x.id) >= 0 && x.email === g.email; }).map(mine);
    var res = { ok: true, today: env.today(), now: env.now(), list: list, event: EVENT };
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
      if (!x || x.email !== g.email) { out = fail('missing', '예약을 찾을 수 없어요.'); return; }
      out = fn(x);
      if (out && out.ok) writeAll(env, recs);
    });
    if (out && out.ok) { out.item = mine(out.x); delete out.x; }
    return out;
  }
  function arrive(req, env) {
    return guestUpdate(req, env, function (x) {
      if (x.status !== ST.OK) return fail('status', x.status === ST.WAIT ? '아직 승인 대기 중인 예약이에요. 입구에서 직원에게 말씀해 주세요.' : '확정된 예약이 아니에요.');
      if (env.today() !== x.show) return fail('day', '도착 확인은 공연 당일(' + dateLabel(x.show) + ')에 할 수 있어요.');
      if (!x.arrivedAt) x.arrivedAt = env.now();
      return { ok: true, x: x };
    });
  }
  function guestCancel(req, env) {
    var res = guestUpdate(req, env, function (x) {
      if (x.status !== ST.WAIT && x.status !== ST.OK) return fail('status', '이미 취소되었거나 처리된 예약이에요.');
      if (env.today() >= x.show) return fail('day', '공연 당일에는 ' + EVENT.phone + '로 연락해 주세요.');
      x.status = ST.CANCEL; x.decidedAt = env.now();
      x.memo = clean((x.memo ? x.memo + '\n' : '') + env.now() + ' 예약자가 직접 취소', 500);
      return { ok: true, x: x };
    });
    if (res.ok) {
      var x = res.item;
      mailAdmin(env, '[좌석 예약 취소] ' + showLabel(x.show) + ' · ' + x.name + ' · ' + x.seats.join(', '), x, '예약자가 좌석 예약을 취소했습니다. 좌석은 다시 예약할 수 있게 풀렸습니다.');
    }
    return res;
  }

  /* ---------- 관리자 (홈페이지 관리자 비밀번호로 로그인한 토큰) ---------- */
  /* 아이디·비밀번호로 관리 화면 들어가기. 5번 틀리면 15분 잠김 */
  var ADMIN_SEC = 28800;
  function adminLogin(req, env) {
    if (!env.adminCred || !env.sha256) return fail('off', '아이디 로그인이 준비되지 않았어요.');
    var fails = +(env.cache.get('rsvadmfail') || 0);
    if (fails >= 5) return fail('locked', '비밀번호를 여러 번 틀려서 15분 동안 잠겼어요. 잠시 뒤 다시 해 주세요.');
    var c = env.adminCred(), id = clean(req.id, 60).toLowerCase(), pw = str(req.password);
    if (!c || !c.id || id !== str(c.id).toLowerCase() || env.sha256(c.salt + ':' + pw) !== c.hash) {
      env.cache.put('rsvadmfail', String(fails + 1), 900);
      return fail('login', '아이디나 비밀번호가 맞지 않아요.' + (fails >= 2 ? ' (' + (4 - fails) + '번 더 틀리면 15분 동안 잠겨요)' : ''));
    }
    env.cache.remove('rsvadmfail');
    var token = env.uuid() + env.uuid();
    env.cache.put('rsvadm:' + token, '1', ADMIN_SEC);
    return { ok: true, token: token };
  }
  function adminSetCred(req, env) {
    if (!env.setAdminCred) return fail('off', '바꿀 수 없어요.');
    var id = clean(req.id, 40), pw = str(req.password), errors = {};
    if (!/^[A-Za-z0-9._@-]{3,40}$/.test(id)) errors.id = '아이디는 영문·숫자·.-_@ 3~40자로 정해 주세요';
    if (pw.length < 4 || pw.length > 60) errors.password = '비밀번호는 4~60자로 정해 주세요';
    if (Object.keys(errors).length) return fail('invalid', '입력한 내용을 확인해 주세요.', { errors: errors });
    var salt = env.uuid().slice(0, 16);
    env.setAdminCred({ id: id, salt: salt, hash: env.sha256(salt + ':' + pw) });
    return { ok: true, id: id };
  }

  function isAdmin(req, env) { var t = str(req.token); return !!t && !!env.isAdmin && !!env.isAdmin(t); }
  function adminData(env) {
    var cfg = settings(env), recs = readAll(env), occ = occupancy(recs), quota = null, sheetUrl = '';
    try { if (env.mailQuota) quota = env.mailQuota(); } catch (e) {}
    try { if (env.sheetUrl) sheetUrl = env.sheetUrl(); } catch (e) {}
    return {
      ok: true, now: env.now(), today: env.today(), ver: env.props.get('RSV_VER') || '0', settings: cfg, event: EVENT,
      notifyEmail: notifyTo(env), mailQuota: quota, sheetUrl: sheetUrl, adminId: env.adminCred ? str((env.adminCred() || {}).id) : '',
      shows: EVENT.shows.map(function (s) { return showState(s, env, cfg, occ); }),
      holds: holdMap(env, ''),
      list: recs.map(adminView).reverse()
    };
  }
  function adminUpdate(req, env, fn) {
    var id = str(req.id), out = null;
    env.lock(function () {
      var recs = readAll(env), x = recs.filter(function (r) { return r.id === id; })[0];
      if (!x) { out = fail('missing', '예약을 찾을 수 없어요. 새로고침해 주세요.'); return; }
      out = fn(x, recs);
      if (out && out.ok) writeAll(env, recs);
    });
    if (out && out.ok) { out.item = adminView(out.x); delete out.x; }
    return out;
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
        var was = x.status;
        x.status = d === 'approve' ? ST.OK : ST.WAIT; x.decidedAt = env.now();
        if (d === 'approve' && was !== ST.OK) logMail(x, env.now() + ' 확정 메일', mailConfirm(env, x));
        return { ok: true, x: x };
      }
      if (d === 'reject' || d === 'cancel') {
        x.status = d === 'reject' ? ST.NO : ST.CANCEL; x.decidedAt = env.now();
        if (reason) x.memo = clean((x.memo ? x.memo + '\n' : '') + env.now() + ' ' + reason, 500);
        if (d === 'reject' && req.notify !== false) logMail(x, env.now() + ' 거절 안내 메일', mailReject(env, x, reason));
        return { ok: true, x: x };
      }
      return fail('decision', '알 수 없는 처리예요.');
    });
  }
  function resend(req, env) {
    return adminUpdate(req, env, function (x) {
      if (x.status !== ST.OK) return fail('status', '확정된 예약만 확정 메일을 다시 보낼 수 있어요.');
      var err = mailConfirm(env, x);
      logMail(x, env.now() + ' 확정 메일(다시)', err);
      return err ? fail('mail', err) : { ok: true, x: x };
    });
  }
  function adminArrive(req, env) {
    return adminUpdate(req, env, function (x) {
      x.arrivedAt = req.arrived === false ? '' : (x.arrivedAt || env.now());
      return { ok: true, x: x };
    });
  }
  function adminMemo(req, env) {
    return adminUpdate(req, env, function (x) { x.memo = clean(req.memo, 500); return { ok: true, x: x }; });
  }
  function adminPassword(req, env) {
    var pw = str(req.password);
    if (pw.length < 4 || pw.length > 30) return fail('invalid', '비밀번호는 4~30자로 정해 주세요.');
    return adminUpdate(req, env, function (x) {
      var salt = env.uuid().slice(0, 12);
      x.pw = salt + '$' + env.sha256(salt + ':' + pw);
      return { ok: true, x: x };
    });
  }
  function adminRemove(req, env) {
    var id = str(req.id), done = false;
    env.lock(function () {
      var recs = readAll(env), rest = recs.filter(function (r) { return r.id !== id; });
      if (rest.length !== recs.length) { writeAll(env, rest); done = true; }
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
    var out = null;
    env.lock(function () {
      var recs = readAll(env), occ = occupancy(recs)[show.id];
      var taken = seats.filter(function (s) { return occ[s]; });
      if (taken.length) { out = fail('taken', '이미 잡힌 좌석이 있어요: ' + taken.join(', '), { taken: taken }); return; }
      var ids = {}; recs.forEach(function (x) { ids[x.id] = true; });
      var id;
      do { id = (kind === ST.BLOCK ? 'X' : 'R') + show.id.slice(5).replace('-', '') + '-' + env.uuid().slice(0, 4).toUpperCase(); } while (ids[id]);
      var salt = env.uuid().slice(0, 12);
      var rec = { id: id, createdAt: env.now(), show: show.id, seats: seats, status: kind, name: name, org: clean(req.org, 60), phone: phone, email: email,
        note: clean(req.note, 300), memo: kind === ST.OK ? '관리자 등록' : '', arrivedAt: '', decidedAt: env.now(), mailLog: '',
        pw: pw ? salt + '$' + env.sha256(salt + ':' + pw) : '' };
      if (kind === ST.OK && email && req.notify !== false) logMail(rec, env.now() + ' 확정 메일', mailConfirm(env, rec));
      recs.push(rec);
      writeAll(env, recs);
      releaseHolds(env, show.id, '', seats);
      out = { ok: true, item: adminView(rec) };
    });
    return out;
  }
  function saveSettings(req, env) {
    if (req.open !== undefined) env.props.set('RSV_OPEN', req.open ? '1' : '0');
    if (req.max !== undefined) {
      var n = parseInt(req.max, 10);
      if (isNaN(n) || n < 1 || n > 242) return fail('invalid', '최대 좌석 수는 1~242 사이 숫자로 적어 주세요.');
      env.props.set('RSV_MAX', String(n));
    }
    bump(env);
    return { ok: true, settings: settings(env) };
  }

  /* ---------- 요청 처리 ---------- */
  function handle(req, env) {
    req = req || {};
    try {
      if (env.ensure) env.ensure();
      var a = str(req.action);
      if (a === 'rsvState') { var st = publicState(env); st.holds = holdMap(env, str(req.holder)); return st; }
      if (a === 'rsvHold') return hold(req, env);
      if (a === 'rsvBook') return book(req, env);
      if (a === 'rsvLogin') return guestLogin(req, env);
      if (a === 'rsvMine') return listMine(req, env);
      if (a === 'rsvArrive') return arrive(req, env);
      if (a === 'rsvCancel') return guestCancel(req, env);
      if (a === 'rsvAdminLogin') return adminLogin(req, env);
      if (a.indexOf('rsvAdmin') === 0) {
        if (!isAdmin(req, env)) return fail('auth', '관리자 로그인이 필요해요.');
        switch (a) {
          case 'rsvAdmin': return adminData(env);
          case 'rsvAdminDecide': return decide(req, env);
          case 'rsvAdminResend': return resend(req, env);
          case 'rsvAdminArrive': return adminArrive(req, env);
          case 'rsvAdminMemo': return adminMemo(req, env);
          case 'rsvAdminPassword': return adminPassword(req, env);
          case 'rsvAdminRemove': return adminRemove(req, env);
          case 'rsvAdminBook': return adminBook(req, env);
          case 'rsvAdminSettings': return saveSettings(req, env);
          case 'rsvAdminCred': return adminSetCred(req, env);
        }
      }
      return fail('action', '알 수 없는 요청입니다.');
    } catch (e) {
      if (typeof console !== 'undefined') console.error(e);
      return fail('server', '잠시 문제가 생겼어요. 잠시 후 다시 시도해 주세요.');
    }
  }

  return {
    EVENT: EVENT, ROWS: ROWS, SIDES: SIDES, WHEEL: WHEEL, SEATS: SEATS, ST: ST, STATUSES: STATUSES, SCHEMA: SCHEMA,
    rowNums: rowNums, floorOf: floorOf, seatName: seatName, seatWhere: seatWhere, seatSort: seatSort, showLabel: showLabel, dateLabel: dateLabel, timeLabel: timeLabel, findShow: findShow,
    handle: handle
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = RSV;
