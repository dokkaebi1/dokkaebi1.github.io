/* 극단 도깨비: 문의·의뢰·제안 접수, 일정 달력, 새 소식 (라이브러리 없이 동작)
   접수 서버 주소는 <meta name="dokkaebi-api"> 에서 읽습니다(구글 Apps Script). 비어 있으면 전화 안내만 보여 줍니다. */
(function () {
  "use strict";
  var meta = document.querySelector('meta[name="dokkaebi-api"]');
  var API = meta ? meta.getAttribute("content") : "";
  var started = Date.now();
  var WEEK = ["일", "월", "화", "수", "목", "금", "토"];

  function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function say(form, text, ok) {
    var box = form.querySelector(".form-msg");
    box.textContent = text;
    box.className = "form-msg " + (ok ? "is-ok" : "is-err");
  }

  // ── 접수 양식 보내기 ─────────────────────────
  // 서버(Code.js)와 같은 글자 수 한도 — 넘치면 서버가 조용히 잘라 저장하므로 입력 단계에서 막습니다
  var LIMIT = { name: 40, org: 80, phone: 30, email: 80, audience: 100, message: 3000 };
  var AUTO = { name: "name", org: "organization", phone: "tel", email: "email" };
  var LABEL = { program: "프로그램을 골라", org: "기관·학교를 적어", name: "이름을 적어", phone: "연락처를 적어", email: "이메일을 적어", audience: "대상·인원을 적어", message: "내용을 적어" };
  var TIMEOUT = 25000;
  var telLink = document.querySelector('a[href^="tel:"]');
  var TEL = telLink && /\d{2,4}-\d{3,4}-\d{4}/.test(telLink.textContent) ? telLink.textContent.match(/\d{2,4}-\d{3,4}-\d{4}/)[0] : "전화";

  function field(form, n) { return form.querySelector('[name="' + n + '"]'); }
  function prepare(form) {
    Object.keys(LIMIT).forEach(function (n) {
      var el = field(form, n), cur = el && el.maxLength > 0 ? el.maxLength : Infinity;
      if (el) el.maxLength = Math.min(cur, LIMIT[n]);
    });
    Object.keys(AUTO).forEach(function (n) { var el = field(form, n); if (el && !el.hasAttribute("autocomplete")) el.setAttribute("autocomplete", AUTO[n]); });
    var ph = field(form, "phone"); if (ph) ph.setAttribute("inputmode", "tel");
    var em = field(form, "email"); if (em) em.setAttribute("inputmode", "email");
  }
  // 빈 필수 칸·형식 오류를 보내기 전에 표시하고, 첫 칸으로 초점을 옮깁니다
  function check(form) {
    var bad = [], msgs = [];
    form.querySelectorAll("[aria-invalid]").forEach(function (el) { el.removeAttribute("aria-invalid"); });
    function mark(el, why) { if (el && bad.indexOf(el) < 0) { bad.push(el); msgs.push(why); el.setAttribute("aria-invalid", "true"); } }
    form.querySelectorAll("[required]").forEach(function (el) {
      if (el.type === "checkbox" || el.name === "consent") return;
      if (!String(el.value || "").trim()) mark(el, (LABEL[el.name] || "필수 항목을 채워") + " 주세요");
    });
    var ph = field(form, "phone"), em = field(form, "email");
    var pv = ph ? ph.value.trim() : "", ev = em ? em.value.trim() : "";
    if (ph && em && !pv && !ev) mark(ph, "연락처(전화 또는 이메일)를 적어 주세요");
    if (pv && (!/^[0-9+()\-\s]+$/.test(pv) || pv.replace(/\D/g, "").length < 9 || pv.replace(/\D/g, "").length > 12)) mark(ph, "전화번호를 확인해 주세요 (예: 010-1234-5678)");
    if (ev && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ev)) mark(em, "이메일 주소를 확인해 주세요");
    if (bad.length) bad[0].focus();
    return msgs.length ? msgs.slice(0, 3).join(" · ") : "";
  }
  // 같은 내용을 다시 보내면 같은 요청번호를 씁니다(서버가 중복 접수를 거를 수 있도록). 내용이 바뀌면 새 번호.
  function reqIdFor(form, data) {
    var sig = JSON.stringify([data.type, data.name, data.org, data.phone, data.email, data.date, data.program, data.audience, data.message]);
    if (form._sig !== sig) { form._sig = sig; form._req = Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
    return form._req;
  }

  document.querySelectorAll("form.js-form").forEach(function (form) {
    if (!API) {
      form.querySelectorAll("input, select, textarea, button").forEach(function (el) { el.disabled = true; });
      say(form, "온라인 접수를 준비하고 있습니다. 지금은 전화로 문의해 주세요.", false);
      return;
    }
    prepare(form);
    form.addEventListener("input", function (e) { if (e.target.getAttribute("aria-invalid")) e.target.removeAttribute("aria-invalid"); });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = form.querySelector('button[type="submit"]');
      if (btn.disabled) return;
      var data = { type: form.getAttribute("data-type"), elapsed: Date.now() - started };
      new FormData(form).forEach(function (v, k) { data[k] = typeof v === "string" ? v.trim() : v; });
      var problem = check(form);
      if (problem) { say(form, problem + ".", false); return; }
      data.consent = !!(form.querySelector('[name="consent"]') || {}).checked;
      if (!data.consent) { say(form, "개인정보 수집·이용에 동의해 주세요.", false); var c = field(form, "consent"); if (c) c.focus(); return; }
      data.reqId = reqIdFor(form, data);
      btn.disabled = true;
      say(form, "보내는 중입니다…", true);
      var ctrl = "AbortController" in window ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT);
      fetch(API, { method: "POST", body: JSON.stringify(data), signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          clearTimeout(timer);
          btn.disabled = false;
          if (res.ok) {
            form.reset(); form._sig = null;
            say(form, form.getAttribute("data-done") || "접수되었습니다. 확인 후 연락드리겠습니다.", true);
            document.dispatchEvent(new CustomEvent("dokkaebi:submitted", { detail: data }));
          } else say(form, res.error || "접수하지 못했습니다. 전화로 문의해 주세요.", false);
        })
        .catch(function (err) {
          clearTimeout(timer);
          btn.disabled = false;
          // 응답이 늦거나 끊기면 접수가 됐는지 알 수 없으므로, 입력은 그대로 두고 확인을 먼저 안내합니다
          var late = err && err.name === "AbortError";
          say(form, (late ? "응답이 늦어 접수 여부를 확인하지 못했습니다. " : "연결에 문제가 있어 접수 여부를 확인하지 못했습니다. ") +
            "적으신 내용은 그대로 남아 있습니다. 다시 보내기 전에 전화" + (TEL === "전화" ? "" : "(" + TEL + ")") + "로 접수 여부를 확인해 주세요.", false);
        });
    });
  });

  // ── 창 열기·닫기 ─────────────────────────────
  function openDialog(id) { var d = document.getElementById(id); if (d && d.showModal) d.showModal(); return d; }
  document.querySelectorAll("[data-open]").forEach(function (b) {
    b.addEventListener("click", function (e) { e.preventDefault(); openDialog(b.getAttribute("data-open")); });
  });
  document.querySelectorAll("dialog.form-dialog").forEach(function (d) {
    d.querySelector(".dlg-close").addEventListener("click", function () { d.close(); });
    d.addEventListener("click", function (e) { if (e.target === d) d.close(); });
  });

  // ── 일정 달력 ───────────────────────────────
  var cache = {};
  function loadMonths(from) {
    if (!API) return Promise.resolve(null);
    if (!cache[from]) {
      cache[from] = fetch(API + "?action=schedule&months=3&from=" + from)
        .then(function (r) { return r.json(); }).catch(function () { delete cache[from]; return null; });
    }
    return cache[from];
  }
  document.addEventListener("dokkaebi:submitted", function () { cache = {}; document.querySelectorAll(".cal").forEach(function (c) { c._render && c._render(); }); });

  document.querySelectorAll(".cal").forEach(function (cal) {
    var now = new Date(), view = new Date(now.getFullYear(), now.getMonth(), 1);
    var grid = cal.querySelector(".cal__grid"), label = cal.querySelector(".cal__month");
    var fixed = cal.getAttribute("data-program");
    function program() {
      var r = cal.querySelector('input[name="cal-program"]:checked');
      return r ? r.value : fixed;
    }
    function render() {
      label.textContent = view.getFullYear() + "년 " + (view.getMonth() + 1) + "월";
      var from = view.getFullYear() + "-" + String(view.getMonth() + 1).padStart(2, "0");
      grid.innerHTML = WEEK.map(function (w, i) { return '<div class="cal__wd' + (i === 0 ? " is-sun" : i === 6 ? " is-sat" : "") + '">' + w + "</div>"; }).join("");
      var note = cal.querySelector(".cal__note");
      if (!API) { note.textContent = "온라인 접수를 준비하고 있습니다. 일정은 전화로 문의해 주세요."; }
      loadMonths(from).then(function (res) {
        var dates = (res && res.dates) || {};
        var today = new Date(); today.setHours(0, 0, 0, 0);
        var first = new Date(view), days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
        var html = "";
        for (var i = 0; i < first.getDay(); i++) html += '<div class="cal__day is-empty"></div>';
        for (var d = 1; d <= days; d++) {
          var day = new Date(view.getFullYear(), view.getMonth(), d), key = ymd(day), wd = day.getDay();
          var state = dates[key], cls = "cal__day", txt = "", btn = false;
          if (day <= today) { cls += " is-past"; }
          else if (wd === 0 || wd === 6) { cls += " is-weekend"; txt = "전화 문의"; }
          else if (state === "busy") { cls += " is-busy"; txt = "예약 완료"; }
          else if (state === "pending") { cls += " is-pending"; txt = "협의 중"; }
          else if (API && res) { cls += " is-open"; txt = "접수 가능"; btn = true; }
          html += btn
            ? '<button type="button" class="' + cls + '" data-date="' + key + '"><b>' + d + "</b><span>" + txt + "</span></button>"
            : '<div class="' + cls + '"><b>' + d + "</b><span>" + txt + "</span></div>";
        }
        grid.innerHTML += html;
        if (API && !res) note.textContent = "일정을 불러오지 못했습니다. 잠시 후 다시 보거나 전화로 문의해 주세요.";
        grid.querySelectorAll("button[data-date]").forEach(function (b) {
          b.addEventListener("click", function () {
            var dlg = document.getElementById("booking-dialog");
            dlg.querySelector('[name="date"]').value = b.getAttribute("data-date");
            dlg.querySelector(".booking-date").textContent = b.getAttribute("data-date").replace(/-/g, ". ") + ".";
            var sel = dlg.querySelector('[name="program"]');
            if (program()) sel.value = program();
            var form = dlg.querySelector("form"); var msg = form.querySelector(".form-msg"); msg.textContent = ""; msg.className = "form-msg";
            dlg.showModal();
          });
        });
      });
    }
    cal._render = render;
    cal.querySelector(".cal__prev").addEventListener("click", function () {
      var min = new Date(now.getFullYear(), now.getMonth(), 1);
      if (view > min) { view.setMonth(view.getMonth() - 1); render(); }
    });
    cal.querySelector(".cal__next").addEventListener("click", function () {
      var max = new Date(now.getFullYear(), now.getMonth() + 11, 1);
      if (view < max) { view.setMonth(view.getMonth() + 1); render(); }
    });
    render();
  });

  // ── 문의 양식이 화면에 보이면 ‘문의하기’ 버튼 숨기기 ─────────
  var fab = document.querySelector(".fab");
  if (fab && "IntersectionObserver" in window) {
    var seen = new Set();
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { e.isIntersecting ? seen.add(e.target) : seen.delete(e.target); });
      var hide = seen.size > 0;
      fab.classList.toggle("is-hidden", hide);
      // 눈에 안 보일 때는 키보드 초점·화면낭독기에서도 빠지게
      fab.inert = hide;
      if (hide) { fab.setAttribute("aria-hidden", "true"); fab.setAttribute("tabindex", "-1"); }
      else { fab.removeAttribute("aria-hidden"); fab.removeAttribute("tabindex"); }
    });
    document.querySelectorAll("form.js-form").forEach(function (f) { if (!f.closest("dialog")) io.observe(f); });
  }

  // ── 새 소식(관리자 페이지에서 올린 사진·영상) ─────────
  var news = document.getElementById("news");
  if (news) {
    fetch(news.getAttribute("data-src") + "?t=" + Math.floor(Date.now() / 60000))
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (items) {
        if (!items || !items.length) return;
        var base = news.getAttribute("data-base") || "";
        news.querySelector(".news-grid").innerHTML = items.slice(0, 8).map(function (m) {
          var src = base + m.src, cap = String(m.caption || "").replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
          var media = m.kind === "video"
            ? '<video controls playsinline preload="metadata" src="' + src + '"></video>'
            : '<a class="js-lightbox" href="' + src + '"><img src="' + src + '" alt="' + cap + '" loading="lazy"></a>';
          return '<figure class="news-item">' + media + "<figcaption>" + cap + "<span>" + (m.date || "") + "</span></figcaption></figure>";
        }).join("");
        news.hidden = false;
      }).catch(function () {});
  }
})();
