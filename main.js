// ==UserScript==
// @name         Instagram Reels Precision-Seek
// @namespace    http://tampermonkey.net/
// @version      3.0.0
// @description  Seek bar + time display for Instagram Reels. NASA Power of 10 refactored.
// @author       arthiccc
// @match        https://www.instagram.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    /* ═══════════════════════════════════════════════════════════════════
       CONFIG — Rule 8: all constants in one place, single-line values
       ═══════════════════════════════════════════════════════════════════ */
    var CFG = {
        DEBOUNCE_MS: 300,
        SCAN_MAX: 50,
        SEEK_STEP_S: 5,
        Z_INDEX: 2000,
        FONT: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
    };

    /* ═══════════════════════════════════════════════════════════════════
       CSS — injected once at startup
       ═══════════════════════════════════════════════════════════════════ */
    var CSS = [
        '.ghost-seek-bar{position:absolute;bottom:0;left:0;width:100%;height:3px;',
        'background:rgba(255,255,255,0.2);z-index:', CFG.Z_INDEX, ';cursor:pointer;',
        'transition:height 0.1s;pointer-events:auto}',
        '.ghost-seek-bar:hover{height:6px}',
        '.ghost-seek-fill{height:100%;background:#fff;width:0%;transition:width 0.1s linear}',
        '.ghost-time{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);',
        'font-family:', CFG.FONT, ';color:rgba(245,245,245,0.9);font-size:12px;',
        'font-weight:500;user-select:none;pointer-events:none;white-space:nowrap;',
        'text-shadow:0 1px 3px rgba(0,0,0,0.6);opacity:0;transition:opacity 0.15s}',
        '.ghost-seek-bar:hover ~ .ghost-time{opacity:1}',
        'video[data-ghost-seek] ~ .ghost-time{opacity:0}',
        '.ghost-time.ghost-visible{opacity:1}'
    ].join('');

    function injectCSS() {
        var s = document.createElement('style');
        s.textContent = CSS;
        document.head.appendChild(s);
    }

    /* ═══════════════════════════════════════════════════════════════════
       UTILS — Rule 5: assertion density, Rule 6: block scope
       ═══════════════════════════════════════════════════════════════════ */
    function formatTime(secs) {
        if (!isFinite(secs) || secs < 0) return '0:00';
        var m = Math.floor(secs / 60);
        var s = Math.floor(secs % 60);
        return m + ':' + (s < 10 ? '0' : '') + s;
    }

    function assertEl(el, label) {
        if (!el || !el.nodeType) {
            throw new Error('[IG-Seek] ' + label + ' not found');
        }
        return el;
    }

    /* ═══════════════════════════════════════════════════════════════════
       VIDEO FINDER — Rule 1: no recursion, Rule 2: bounded loops
       ═══════════════════════════════════════════════════════════════════ */
    function findVideos(root) {
        var found = [];
        var queue = [root];
        var iterations = 0;

        while (queue.length > 0 && iterations < CFG.SCAN_MAX) {
            var node = queue.shift();
            iterations++;

            if (node.tagName === 'VIDEO') {
                found.push(node);
                continue;
            }

            if (node.querySelectorAll) {
                var vids = node.querySelectorAll('video');
                var i = 0;
                while (i < vids.length && found.length < CFG.SCAN_MAX) {
                    found.push(vids[i]);
                    i++;
                }
            }

            if (node.shadowRoot) {
                queue.push(node.shadowRoot);
            }

            var children = node.children;
            if (children) {
                var j = 0;
                while (j < children.length && iterations < CFG.SCAN_MAX) {
                    queue.push(children[j]);
                    j++;
                }
            }
        }

        return found;
    }

    /* ═══════════════════════════════════════════════════════════════════
       ACTIVE VIDEO — Rule 7: check all returns
       ═══════════════════════════════════════════════════════════════════ */
    function getActiveVideo() {
        var all = findVideos(document.body);
        if (all.length === 0) return null;

        var k = 0;
        while (k < all.length) {
            var v = all[k];
            if (!v.paused && !v.ended && v.duration > 0) return v;
            k++;
        }

        var cx = window.innerWidth / 2;
        var cy = window.innerHeight / 2;
        var best = null;
        var bestDist = Infinity;

        k = 0;
        while (k < all.length) {
            var vid = all[k];
            var r = vid.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
                var dx = r.left + r.width / 2 - cx;
                var dy = r.top + r.height / 2 - cy;
                var dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < bestDist) {
                    bestDist = dist;
                    best = vid;
                }
            }
            k++;
        }

        return best;
    }

    /* ═══════════════════════════════════════════════════════════════════
       UI FACTORY — Rule 3: pre-create, Rule 4: short functions
       ═══════════════════════════════════════════════════════════════════ */
    function createSeekBar() {
        var bar = document.createElement('div');
        bar.className = 'ghost-seek-bar';

        var fill = document.createElement('div');
        fill.className = 'ghost-seek-fill';

        var time = document.createElement('div');
        time.className = 'ghost-time';

        bar.appendChild(fill);
        return { bar: bar, fill: fill, time: time };
    }

    function updateSeekBar(ui, video) {
        if (!video || !video.duration) return;
        var pct = (video.currentTime / video.duration) * 100;
        ui.fill.style.width = pct + '%';
        ui.time.textContent = formatTime(video.currentTime) + ' / ' + formatTime(video.duration);
    }

    /* ═══════════════════════════════════════════════════════════════════
       INJECT — Rule 5: assertions, Rule 6: small scope, Rule 9: shallow
       ═══════════════════════════════════════════════════════════════════ */
    function injectUI(video) {
        if (video.dataset.ghostSeek) return;
        video.dataset.ghostSeek = '1';

        var container = video.parentElement;
        if (!container) return;

        var pos = getComputedStyle(container).position;
        if (pos === 'static') {
            container.style.position = 'relative';
        }

        var ui = createSeekBar();
        container.appendChild(ui.bar);
        container.appendChild(ui.time);

        var onTimeUpdate = function () {
            updateSeekBar(ui, video);
        };

        var isDragging = false;
        var activePtrId = -1;

        function seek(clientX) {
            var rect = ui.bar.getBoundingClientRect();
            var w = rect.width;
            if (w === 0) return;
            video.currentTime = ((clientX - rect.left) / w) * video.duration;
        }

        ui.bar.addEventListener('pointerdown', function (e) {
            e.preventDefault();
            e.stopPropagation();
            isDragging = true;
            activePtrId = e.pointerId;
            seek(e.clientX);
            ui.bar.setPointerCapture(e.pointerId);
        }, { passive: false });

        ui.bar.addEventListener('pointermove', function (e) {
            if (!isDragging || e.pointerId !== activePtrId) return;
            e.preventDefault();
            e.stopPropagation();
            seek(e.clientX);
        }, { passive: false });

        ui.bar.addEventListener('pointerup', function (e) {
            isDragging = false;
            ui.bar.releasePointerCapture(e.pointerId);
        }, { passive: false });

        ui.bar.addEventListener('pointerenter', function () {
            ui.time.classList.add('ghost-visible');
        });

        ui.bar.addEventListener('pointerleave', function () {
            ui.time.classList.remove('ghost-visible');
        });

        video.addEventListener('timeupdate', onTimeUpdate);

        ['click', 'mousedown', 'mouseup', 'touchstart', 'touchend',
         'pointerdown', 'pointerup', 'pointercancel'].forEach(function (evt) {
            ui.bar.addEventListener(evt, function (e) { e.stopPropagation(); }, true);
        });

        updateSeekBar(ui, video);
    }

    /* ═══════════════════════════════════════════════════════════════════
       KEYBOARD — Rule 1: single handler, no memory leak
       ═══════════════════════════════════════════════════════════════════ */
    function handleKeydown(e) {
        if (!e.shiftKey) return;
        var tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;

        var video = getActiveVideo();
        if (!video) return;

        e.preventDefault();
        e.stopPropagation();

        if (e.key === 'ArrowRight') {
            video.currentTime += CFG.SEEK_STEP_S;
        } else if (e.key === 'ArrowLeft') {
            video.currentTime -= CFG.SEEK_STEP_S;
        }
    }

    /* ═══════════════════════════════════════════════════════════════════
       OBSERVER + SPA — Rule 1: iterative, Rule 2: bounded debounce
       ═══════════════════════════════════════════════════════════════════ */
    var scanTimer = null;

    function scan() {
        var videos = findVideos(document.body);
        var i = 0;
        while (i < videos.length) {
            injectUI(videos[i]);
            i++;
        }
    }

    function scheduleScan() {
        if (scanTimer) clearTimeout(scanTimer);
        scanTimer = setTimeout(scan, CFG.DEBOUNCE_MS);
    }

    function initObserver() {
        var observer = new MutationObserver(scheduleScan);
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function initSPAHooks() {
        var _push = history.pushState;
        var _replace = history.replaceState;

        history.pushState = function () {
            _push.apply(this, arguments);
            scheduleScan();
        };

        history.replaceState = function () {
            _replace.apply(this, arguments);
            scheduleScan();
        };

        window.addEventListener('popstate', scheduleScan);
    }

    function initKeybinding() {
        document.addEventListener('keydown', handleKeydown, true);
    }

    /* ═══════════════════════════════════════════════════════════════════
       INIT — entry point
       ═══════════════════════════════════════════════════════════════════ */
    function init() {
        injectCSS();
        initObserver();
        initSPAHooks();
        initKeybinding();
        scan();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
