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
  document.querySelectorAll("form.js-form").forEach(function (form) {
    if (!API) {
      form.querySelectorAll("input, select, textarea, button").forEach(function (el) { el.disabled = true; });
      say(form, "온라인 접수를 준비하고 있습니다. 지금은 전화로 문의해 주세요.", false);
      return;
    }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var data = { type: form.getAttribute("data-type"), elapsed: Date.now() - started };
      new FormData(form).forEach(function (v, k) { data[k] = v; });
      data.consent = !!(form.querySelector('[name="consent"]') || {}).checked;
      if (!data.consent) { say(form, "개인정보 수집·이용에 동의해 주세요.", false); return; }
      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      say(form, "보내는 중입니다…", true);
      fetch(API, { method: "POST", body: JSON.stringify(data) })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          btn.disabled = false;
          if (res.ok) {
            form.reset();
            say(form, form.getAttribute("data-done") || "접수되었습니다. 확인 후 연락드리겠습니다.", true);
            document.dispatchEvent(new CustomEvent("dokkaebi:submitted", { detail: data }));
          } else say(form, res.error || "접수하지 못했습니다. 전화로 문의해 주세요.", false);
        })
        .catch(function () { btn.disabled = false; say(form, "연결에 문제가 있습니다. 잠시 후 다시 보내거나 전화로 문의해 주세요.", false); });
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
      fab.classList.toggle("is-hidden", seen.size > 0);
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
