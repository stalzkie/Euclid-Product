/**
 * Euclid widget loader.
 *
 *   <script src="https://your-euclid/widget.js"
 *           data-board="brd_8f2k1x"
 *           data-mode="floating"
 *           async></script>
 *
 * Design goals, straight from the PRD:
 *   - one script tag, loaded async, never blocking the host page
 *   - mounted in a Shadow DOM so the host app's CSS cannot break it
 *   - degrades silently: if Euclid is unreachable, the host app never notices
 *   - small. No framework, no dependencies.
 */
(function () {
  "use strict";

  if (window.__euclidLoaded) return;
  window.__euclidLoaded = true;

  var script = document.currentScript || findSelf();
  if (!script) return;

  var board = script.getAttribute("data-board");
  if (!board) {
    warn("missing data-board on the script tag");
    return;
  }

  var mode = script.getAttribute("data-mode") === "inline" ? "inline" : "floating";
  var target = script.getAttribute("data-target") || "euclid-board";
  var accent = script.getAttribute("data-accent") || "#17171A";
  var label = script.getAttribute("data-label") || "Feedback";
  var side = script.getAttribute("data-side") === "left" ? "left" : "right";
  var origin = new URL(script.src, window.location.href).origin;

  // Everything lives under one host element with a shadow root, so the host
  // page's stylesheet cannot reach any of it.
  var host = document.createElement("div");
  host.setAttribute("data-euclid", board);
  host.style.cssText = "all: initial;";
  var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : null;
  if (!root) {
    warn("this browser has no Shadow DOM; skipping");
    return;
  }

  var style = document.createElement("style");
  style.textContent = [
    ":host { all: initial; }",
    "* { box-sizing: border-box; }",
    ".frame { border: 0; width: 100%; display: block; background: transparent; }",
    ".panel {",
    "  position: fixed; bottom: 84px; width: 420px; max-width: calc(100vw - 32px);",
    "  height: 620px; max-height: calc(100vh - 120px);",
    "  border-radius: 16px; overflow: hidden; background: #fff;",
    "  box-shadow: 0 16px 40px rgba(23,23,26,0.18);",
    "  opacity: 0; transform: translateY(8px); pointer-events: none;",
    "  transition: opacity .16s ease, transform .16s ease; z-index: 2147483000;",
    "}",
    ".panel[data-open='true'] { opacity: 1; transform: none; pointer-events: auto; }",
    ".launcher {",
    "  position: fixed; bottom: 24px; height: 44px; padding: 0 18px;",
    "  display: inline-flex; align-items: center; gap: 8px; border: 0;",
    "  border-radius: 999px; color: #fff; cursor: pointer;",
    "  font: 500 14px/1 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;",
    "  box-shadow: 0 8px 24px rgba(23,23,26,0.22); z-index: 2147483001;",
    "}",
    ".launcher:focus-visible { outline: 3px solid rgba(26,140,255,.45); outline-offset: 2px; }",
    "@media (max-width: 520px) {",
    "  .panel { left: 16px; right: 16px; width: auto; bottom: 78px; }",
    "}",
  ].join("\n");
  root.appendChild(style);

  var frameSrc =
    origin + "/embed/" + encodeURIComponent(board) + "?mode=" + mode;

  if (mode === "inline") {
    mountInline();
  } else {
    mountFloating();
  }

  document.documentElement.appendChild(host);

  /* ---------------------------------------------------------------------- */

  function mountInline() {
    var slot = document.getElementById(target);
    if (!slot) {
      warn('no element with id "' + target + '" to mount into');
      return;
    }
    var frame = makeFrame();
    frame.className = "frame";
    frame.style.height = "620px";
    root.appendChild(frame);
    // Keep the host element in flow where the founder put the container.
    host.style.cssText = "all: initial; display: block; width: 100%;";
    slot.appendChild(host);
    listenForHeight(frame, function (height) {
      frame.style.height = Math.max(320, height) + "px";
    });
  }

  function mountFloating() {
    var panel = document.createElement("div");
    panel.className = "panel";
    panel.setAttribute("data-open", "false");
    panel.style[side] = "24px";

    var frame = makeFrame();
    frame.className = "frame";
    frame.style.height = "100%";
    panel.appendChild(frame);

    var launcher = document.createElement("button");
    launcher.type = "button";
    launcher.className = "launcher";
    launcher.style.background = accent;
    launcher.style[side] = "24px";
    launcher.setAttribute("aria-expanded", "false");
    launcher.setAttribute("aria-label", label);
    launcher.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.9" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M21 12a8 8 0 0 1-8 8H8l-5 2 1.5-4.5A8 8 0 1 1 21 12z"/></svg>' +
      "<span></span>";
    launcher.lastChild.textContent = label;

    var open = false;
    function setOpen(next) {
      open = next;
      panel.setAttribute("data-open", String(open));
      launcher.setAttribute("aria-expanded", String(open));
      if (open) frame.focus();
    }

    launcher.addEventListener("click", function () {
      setOpen(!open);
    });

    // Escape closes it, which keyboard users expect.
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && open) setOpen(false);
    });

    root.appendChild(panel);
    root.appendChild(launcher);
  }

  function makeFrame() {
    var frame = document.createElement("iframe");
    frame.title = "Feedback board";
    frame.loading = "lazy";
    frame.setAttribute("allow", "clipboard-write");
    // The board needs its own scripts and same-origin cookies, but nothing
    // more. No top-navigation, no popups.
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");

    // A signed JWT, if the host app offers one. Resolving it is optional and
    // failing is silent.
    if (typeof window.EuclidIdentity === "function") {
      try {
        Promise.resolve(window.EuclidIdentity())
          .then(function (token) {
            frame.src = token
              ? frameSrc + "&token=" + encodeURIComponent(token)
              : frameSrc;
          })
          .catch(function () {
            frame.src = frameSrc;
          });
      } catch (err) {
        frame.src = frameSrc;
      }
    } else {
      frame.src = frameSrc;
    }

    // A failed load leaves the host page untouched.
    frame.addEventListener("error", function () {
      warn("board failed to load; the host page is unaffected");
      host.remove();
    });

    return frame;
  }

  function listenForHeight(frame, apply) {
    window.addEventListener("message", function (event) {
      if (event.origin !== origin) return;
      var data = event.data;
      if (data && data.type === "euclid:height" && typeof data.height === "number") {
        apply(data.height);
      }
    });
  }

  function findSelf() {
    var all = document.querySelectorAll("script[data-board]");
    return all.length ? all[all.length - 1] : null;
  }

  function warn(message) {
    if (window.console && console.warn) console.warn("[euclid] " + message);
  }
})();
