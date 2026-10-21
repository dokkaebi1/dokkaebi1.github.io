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
    toggle.addEventListener("click", function () {
      var open = header.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.querySelectorAll(".nav a").forEach(function (a) {
      a.addEventListener("click", function () {
        header.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  // 첫 화면 배경영상: 넓은 화면 + 데이터 절약 모드가 아닐 때만 불러오기
  var hv = document.querySelector(".hero__media video[data-src]");
  var saveData = navigator.connection && navigator.connection.saveData;
  if (hv && !reduce && !saveData && window.matchMedia("(min-width: 700px)").matches) {
    hv.src = hv.getAttribute("data-src");
    hv.addEventListener("playing", function () { hv.classList.add("is-playing"); });
    var p = hv.play();
    if (p && p.catch) p.catch(function () {});
    // 움직이는 배경을 멈출 수 있는 버튼
    var pb = document.querySelector(".hero__pause");
    if (pb) {
      pb.hidden = false;
      pb.addEventListener("click", function () {
        var paused = pb.getAttribute("aria-pressed") === "true";
        if (paused) { var q = hv.play(); if (q && q.catch) q.catch(function () {}); } else { hv.pause(); }
        pb.setAttribute("aria-pressed", paused ? "false" : "true");
        pb.textContent = paused ? "배경 영상 멈춤" : "배경 영상 재생";
      });
    }
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
  document.querySelectorAll(".filters button").forEach(function (b) {
    b.addEventListener("click", function () {
      var f = b.getAttribute("data-filter");
      document.querySelectorAll(".filters button").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
      gallery.querySelectorAll("a").forEach(function (a) {
        a.classList.toggle("is-hidden", f !== "all" && a.getAttribute("data-cat") !== f);
        if (f !== "all") a.classList.remove("is-extra");
      });
      if (more) more.hidden = f !== "all" || !gallery.querySelector(".is-extra");
    });
  });
  if (more) {
    more.addEventListener("click", function () {
      gallery.querySelectorAll(".is-extra").forEach(function (a) { a.classList.remove("is-extra"); });
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
})();
