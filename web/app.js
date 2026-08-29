/* QuotaBar 落地页的一点交互。没有依赖，没有构建步骤。 */
(function () {
  "use strict";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ── FAQ 手风琴 ───────────────────────────────────────────────────
   * <details> 自带开合但没有过渡。这里接管：把面板高度从 0 动到实测
   * 高度，收起时反过来，并把 open 属性的移除推迟到动画结束——否则
   * 内容会在第一帧就消失，动画等于没有。
   */
  Array.prototype.forEach.call(document.querySelectorAll(".qa"), function (qa) {
    var summary = qa.querySelector(".qa__q");
    var panel = qa.querySelector(".qa__a");
    var animating = false;

    function heightOf() {
      return panel.firstElementChild.getBoundingClientRect().height + "px";
    }

    summary.addEventListener("click", function (event) {
      event.preventDefault();
      if (animating) return;

      if (reduced) {
        qa.open = !qa.open;
        panel.style.height = qa.open ? "auto" : "0px";
        return;
      }

      if (!qa.open) {
        qa.open = true;
        panel.style.height = "0px";
        // 强制回流，否则起始值和目标值在同一帧里，浏览器不会插值
        void panel.offsetHeight;
        animating = true;
        panel.style.height = heightOf();
        panel.addEventListener("transitionend", function done() {
          panel.removeEventListener("transitionend", done);
          panel.style.height = "auto";   // 之后内容变高也能跟上
          animating = false;
        });
      } else {
        panel.style.height = heightOf();
        void panel.offsetHeight;
        animating = true;
        panel.style.height = "0px";
        panel.addEventListener("transitionend", function done() {
          panel.removeEventListener("transitionend", done);
          qa.open = false;              // 收完再撤 open，内容才不会提前消失
          animating = false;
        });
      }
    });
  });

  /* ── 进场 ────────────────────────────────────────────────────────
   * 藏起来这件事写在 CSS 里，且只在这里加上 .reveal 之后才生效。这样
   * JS 若没跑到，元素就是普通可见的——页面绝不会因为一个观察器没触发
   * 而整屏空白。另设一道兜底：两秒内还没点亮的一律点亮，覆盖标签页
   * 在后台从未合成、观察器因此永不回调的情况。
   */
  var revealables = document.querySelectorAll(
    ".section-head, .feature, .card, .showcase, .faq > *"
  );

  function showAll() {
    Array.prototype.forEach.call(revealables, function (el) {
      el.classList.add("is-in");
    });
  }

  if (revealables.length) {
    Array.prototype.forEach.call(revealables, function (el, i) {
      el.setAttribute("data-reveal", "");
      el.style.transitionDelay = (i % 3) * 70 + "ms";
    });

    if (reduced || !("IntersectionObserver" in window)) {
      showAll();
    } else {
      document.documentElement.classList.add("reveal");
      var io = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          });
        },
        { rootMargin: "0px 0px -12% 0px" }
      );
      Array.prototype.forEach.call(revealables, function (el) { io.observe(el); });
      setTimeout(showAll, 2000);
    }
  }

  /* ── Dock 的邻位放大 ──────────────────────────────────────────────
   * macOS 的 Dock 会带动相邻图标，只放大指针正下方那一个像贴纸。
   * 距离用图标中心算，两格以外不再受影响。
   */
  var dock = document.getElementById("dock");
  if (dock && !reduced && window.matchMedia("(hover: hover)").matches) {
    var tiles = dock.querySelectorAll(".dock__tile");

    dock.addEventListener("mousemove", function (event) {
      Array.prototype.forEach.call(tiles, function (tile) {
        var box = tile.getBoundingClientRect();
        var distance = Math.abs(event.clientX - (box.left + box.width / 2));
        var falloff = Math.max(0, 1 - distance / (box.width * 2.2));
        var scale = 1 + falloff * falloff * 0.42;
        tile.style.transform = "translateY(" + falloff * -11 + "px) scale(" + scale + ")";
      });
    });

    dock.addEventListener("mouseleave", function () {
      Array.prototype.forEach.call(tiles, function (tile) { tile.style.transform = ""; });
    });
  }
})();
