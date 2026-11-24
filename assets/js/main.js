/* 극단 도깨비 홈페이지 스크립트 (라이브러리 없이 동작) */
(function () {
  "use strict";
  var header = document.querySelector(".site-header");
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // 헤더: 스크롤하면 배경 채우기
  function onScroll() {
    if (!header) return;
    var solid = window.scrollY > 40 || !document.querySelector(".hero, .show-hero");
    header.classList.toggle("is-solid", solid);
  }
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  // 모바일 메뉴
  var toggle = document.querySelector(".nav-toggle");
  if (toggle) {
    function setMenu(open) {
      header.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "메뉴 닫기" : "메뉴 열기");
    }
    toggle.addEventListener("click", function () {
      setMenu(!header.classList.contains("is-open"));
    });
    document.querySelectorAll(".nav a").forEach(function (a) {
      a.addEventListener("click", function () { setMenu(false); });
    });
    // Esc 키로 메뉴 닫고 메뉴 버튼으로 초점 돌려주기
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && header.classList.contains("is-open")) {
        setMenu(false);
        toggle.focus();
      }
    });
  }

  // 첫 화면 공연 예약 배너창(#promo): 열려 있는 동안 키보드 초점을 창 안에 가두고, 뒤쪽 화면은 조작되지 않게(inert)
  var promo = document.getElementById("promo");
  if (promo && "MutationObserver" in window) {
    var card = promo.querySelector(".promo__card") || promo, behind = [];
    function focusables() {
      return Array.prototype.filter.call(card.querySelectorAll("a[href], button, input, select, textarea, [tabindex]"), function (el) {
        return el.getAttribute("tabindex") !== "-1" && !el.disabled && el.offsetParent !== null;
      });
    }
    function onTab(e) {
      if (e.key !== "Tab" || promo.hidden) return;
      var f = focusables(); if (!f.length) return;
      var first = f[0], last = f[f.length - 1], cur = document.activeElement;
      if (e.shiftKey && (cur === first || !card.contains(cur) || cur === card)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (cur === last || !card.contains(cur))) { e.preventDefault(); first.focus(); }
    }
    function syncPromo() {
      if (!promo.hidden) {
        behind = Array.prototype.filter.call(document.body.children, function (el) {
          return !el.contains(promo) && el.tagName !== "SCRIPT" && !el.inert;
        });
        behind.forEach(function (el) { el.inert = true; });
        document.addEventListener("keydown", onTab);
      } else {
        behind.forEach(function (el) { el.inert = false; });
        behind = [];
        document.removeEventListener("keydown", onTab);
      }
    }
    new MutationObserver(syncPromo).observe(promo, { attributes: true, attributeFilter: ["hidden"] });
    if (!promo.hidden) syncPromo();
  }

  // 첫 화면 배경영상: 넓은 화면 + 데이터 절약 모드가 아닐 때만 불러오기
  var hv = document.querySelector(".hero__media video[data-src]");
  var saveData = navigator.connection && navigator.connection.saveData;
  var hvOk = !!hv && !reduce && !saveData && window.matchMedia("(min-width: 700px)").matches, hvOn = false;
  function hvPlay() {   // 극단 소개 슬라이드가 처음 보일 때 영상을 불러옴
    if (!hvOk) return;
    if (!hvOn) {
      hvOn = true;
      hv.addEventListener("playing", function () { hv.classList.add("is-playing"); });
      hv.src = hv.getAttribute("data-src");
    }
    var q = hv.play(); if (q && q.catch) q.catch(function () {});
  }
  function hvPause() { if (hvOn) hv.pause(); }
  if (hvOk && !document.querySelector(".hero--slides")) hvPlay();

  // 첫 화면 슬라이드: 1 초청공연 포스터(먼저 보임) ↔ 2 극단 소개(배경 영상). 7초마다 넘어가고, 포스터·넘김 단추에 마우스를 올리거나 키보드 초점이 배너 안에 있으면 잠시 멈춤.
  // '멈춤' 버튼은 자동 넘김과 배경 영상을 함께 멈춤. 움직임 줄이기 설정이면 처음부터 멈춘 상태.
  var hero = document.querySelector(".hero--slides");
  if (hero) {
    var slides = hero.querySelectorAll(".hero__slide"), dots = hero.querySelectorAll(".hero__dot");
    var playBtn = hero.querySelector(".hero__play"), nav = hero.querySelector(".hero__nav");
    var WAIT = 7000, cur = 0, timer = null, left = WAIT, startedAt = 0;
    var userPaused = reduce, hover = false, focus = false;
    nav.hidden = false;
    hero.classList.add("is-ready", "no-anim");   // 처음 열 때는 서서히 바뀌지 않고 첫 슬라이드(초청공연)가 바로 보이게
    function show(i) {
      cur = (i + slides.length) % slides.length;
      slides.forEach(function (s, k) {
        var on = k === cur;
        s.classList.toggle("is-on", on);
        s.setAttribute("aria-hidden", on ? "false" : "true");
        if ("inert" in s) s.inert = !on;
      });
      dots.forEach(function (d) { d.setAttribute("aria-current", +d.getAttribute("data-slide") === cur ? "true" : "false"); });
      if (slides[cur].classList.contains("hero__slide--intro") && !userPaused) hvPlay(); else hvPause();
      left = WAIT; run();
    }
    function stopTimer() {
      if (timer) { clearTimeout(timer); timer = null; left = Math.max(0, left - (Date.now() - startedAt)); }
    }
    function run() {
      if (timer) { clearTimeout(timer); timer = null; }
      var paused = userPaused || hover || focus || document.hidden;
      hero.classList.toggle("is-paused", paused);
      if (paused) return;
      startedAt = Date.now();
      timer = setTimeout(function () { timer = null; show(cur + 1); }, left);
    }
    function hold(kind, on) {
      if (kind === "hover") { if (hover === on) return; hover = on; } else { if (focus === on) return; focus = on; }
      stopTimer(); run();
    }
    function setPaused(p) {
      userPaused = p; stopTimer();
      playBtn.setAttribute("aria-pressed", p ? "true" : "false");
      playBtn.textContent = p ? "재생" : "멈춤";
      if (!p && slides[cur].classList.contains("hero__slide--intro")) hvPlay(); else hvPause();
      run();
    }
    dots.forEach(function (d) { d.addEventListener("click", function () { show(+d.getAttribute("data-slide")); }); });
    playBtn.addEventListener("click", function () { setPaused(!userPaused); });
    // 첫 화면 전체가 배너라 배너 위 마우스로는 멈추지 않고, 포스터·넘김 단추 위에 있을 때만 잠시 멈춤
    hero.querySelectorAll(".hero__posters, .hero__nav").forEach(function (el) {
      el.addEventListener("pointerenter", function (e) { if (e.pointerType === "mouse") hold("hover", true); });
      el.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse") hold("hover", false); });
    });
    hero.addEventListener("focusin", function () { hold("focus", true); });
    hero.addEventListener("focusout", function (e) { if (!hero.contains(e.relatedTarget)) hold("focus", false); });
    document.addEventListener("visibilitychange", function () { stopTimer(); run(); });
    // 휴대폰: 옆으로 밀어서 넘기기
    var tx = null, ty = 0;
    hero.addEventListener("touchstart", function (e) { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
    hero.addEventListener("touchend", function (e) {
      if (tx === null) return;
      var dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty; tx = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) show(cur + (dx < 0 ? 1 : -1));
    }, { passive: true });
    var first = 0;
    slides.forEach(function (s, k) { if (s.classList.contains("is-on")) first = k; });
    cur = first;
    if (userPaused) setPaused(true);
    show(first);
    requestAnimationFrame(function () { requestAnimationFrame(function () { hero.classList.remove("no-anim"); }); });
  }

  // 스크롤 등장 효과
  var reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !reduce) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
      });
    }, { rootMargin: "0px 0px -8% 0px" });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("is-in"); });
  }

  // 영상 창
  var vd = document.getElementById("video-dialog");
  if (vd) {
    var vEl = vd.querySelector("video"), vCap = vd.querySelector("p");
    document.querySelectorAll("[data-video]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        vEl.src = btn.getAttribute("data-video");
        vEl.poster = btn.getAttribute("data-poster") || "";
        vCap.textContent = btn.getAttribute("data-title") || "";
        vd.showModal();
        var p = vEl.play(); if (p && p.catch) p.catch(function () {});
      });
    });
    vd.addEventListener("close", function () { vEl.pause(); vEl.removeAttribute("src"); vEl.load(); });
    vd.querySelector(".dlg-close").addEventListener("click", function () { vd.close(); });
    vd.addEventListener("click", function (e) { if (e.target === vd) vd.close(); });
  }

  // 사진첩 분류 + 더 보기
  var gallery = document.querySelector(".gallery");
  var more = document.querySelector(".gallery-more");
  // 처음 접혀 있던 사진. '더 보기'를 누르기 전에는 '전체'로 돌아올 때 다시 접는다
  var extras = gallery ? Array.prototype.slice.call(gallery.querySelectorAll(".is-extra")) : [];
  var expanded = false;
  document.querySelectorAll(".filters button").forEach(function (b) {
    b.addEventListener("click", function () {
      var f = b.getAttribute("data-filter");
      document.querySelectorAll(".filters button").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
      gallery.querySelectorAll("a").forEach(function (a) {
        a.classList.toggle("is-hidden", f !== "all" && a.getAttribute("data-cat") !== f);
      });
      extras.forEach(function (a) { a.classList.toggle("is-extra", f === "all" && !expanded); });
      if (more) more.hidden = f !== "all" || expanded || !extras.length;
    });
  });
  if (more) {
    more.addEventListener("click", function () {
      expanded = true;
      extras.forEach(function (a) { a.classList.remove("is-extra"); });
      more.hidden = true;
    });
  }

  // 사진 크게 보기
  var lb = document.getElementById("lightbox");
  if (lb) {
    var img = lb.querySelector("img"), cap = lb.querySelector("figcaption"), list = [], idx = 0;
    function visible() {
      return Array.prototype.filter.call(document.querySelectorAll(".js-lightbox"), function (a) { return a.offsetParent !== null; });
    }
    function show(i) {
      idx = (i + list.length) % list.length;
      var a = list[idx];
      img.src = a.getAttribute("href");
      img.alt = a.querySelector("img").alt;
      cap.textContent = a.querySelector("img").alt;
    }
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest(".js-lightbox");
      if (!a) return;
      e.preventDefault();
      list = visible(); show(list.indexOf(a)); lb.showModal();
    });
    lb.querySelector(".lb-prev").addEventListener("click", function () { show(idx - 1); });
    lb.querySelector(".lb-next").addEventListener("click", function () { show(idx + 1); });
    lb.querySelector(".dlg-close").addEventListener("click", function () { lb.close(); });
    lb.addEventListener("click", function (e) { if (e.target === lb || e.target.tagName === "FIGURE") lb.close(); });
    lb.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") show(idx - 1);
      if (e.key === "ArrowRight") show(idx + 1);
    });
    var sx = null;
    lb.addEventListener("touchstart", function (e) { sx = e.touches[0].clientX; }, { passive: true });
    lb.addEventListener("touchend", function (e) {
      if (sx === null) return;
      var dx = e.changedTouches[0].clientX - sx; sx = null;
      if (Math.abs(dx) > 50) show(idx + (dx < 0 ? 1 : -1));
    });
  }
  // 공연 상세 페이지 탭 메뉴: 지금 보고 있는 부분의 탭에 표시 (탭 줄이 좁으면 그 탭이 보이게 옆으로 넘김)
  (function () {
    var tabs = Array.prototype.slice.call(document.querySelectorAll(".pd-tabs a[href^='#']"));
    if (!tabs.length) return;
    var secs = tabs.map(function (a) { return document.getElementById(a.getAttribute("href").slice(1)); });
    var cur = -1, ticking = false;
    function pick() {
      ticking = false;
      var line = 150, i = -1;
      secs.forEach(function (el, k) { if (el && el.getBoundingClientRect().top <= line) i = k; });
      if (i === cur) return;
      cur = i;
      tabs.forEach(function (a, k) { a.classList.toggle("is-on", k === i); if (k === i) a.setAttribute("aria-current", "location"); else a.removeAttribute("aria-current"); });
      var on = tabs[i], ul = on && on.closest("ul");
      if (ul && ul.scrollWidth > ul.clientWidth) ul.scrollTo({ left: on.offsetLeft - 16, behavior: reduce ? "auto" : "smooth" });
    }
    window.addEventListener("scroll", function () { if (!ticking) { ticking = true; requestAnimationFrame(pick); } }, { passive: true });
    pick();
  })();
})();
