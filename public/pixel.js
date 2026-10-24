/**
 * OctopIQ Audience Lab — Lightweight Web Tracking Pixel
 * Zero-dependency client-side behavioral analytics.
 */
(function (window, document) {
  'use strict';

  // 1. Resolve configuration from current script tag
  const currentScript = document.currentScript || (function () {
    const scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  const siteId = currentScript ? (currentScript.getAttribute('data-site-id') || 'default-site') : 'default-site';
  const endpoint = currentScript ? (currentScript.getAttribute('data-endpoint') || '/api/pixel/event') : '/api/pixel/event';

  // 2. Anonymous Visitor Identity
  const STORAGE_KEY = 'octopiq_vid';
  let anonymousId = '';
  try {
    anonymousId = localStorage.getItem(STORAGE_KEY);
    if (!anonymousId) {
      anonymousId = 'usr_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      localStorage.setItem(STORAGE_KEY, anonymousId);
    }
  } catch (e) {
    anonymousId = 'usr_temp_' + Math.random().toString(36).slice(2, 10);
  }

  // 3. Dispatch helper
  function sendEvent(name, data) {
    const payload = {
      siteId: siteId,
      anonymousId: anonymousId,
      eventName: name,
      pageUrl: window.location.href,
      pageTitle: document.title,
      referrer: document.referrer || null,
      timestamp: new Date().toISOString(),
      details: data || {}
    };

    const jsonStr = JSON.stringify(payload);

    if (navigator.sendBeacon) {
      const blob = new Blob([jsonStr], { type: 'application/json' });
      navigator.sendBeacon(endpoint, blob);
    } else {
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonStr,
        keepalive: true
      }).catch(function () {});
    }
  }

  // 4. Automatic Event Listeners
  // (a) Page View
  sendEvent('page_view', {
    screenResolution: window.screen.width + 'x' + window.screen.height,
    viewport: window.innerWidth + 'x' + window.innerHeight
  });

  // (b) CTA and Link Click Tracking
  document.addEventListener('click', function (e) {
    const target = e.target.closest('button, a, [data-octopiq-cta]');
    if (!target) return;

    const text = (target.innerText || target.value || target.getAttribute('aria-label') || '').trim().slice(0, 100);
    const href = target.getAttribute('href') || null;

    sendEvent('cta_click', {
      element: target.tagName.toLowerCase(),
      text: text,
      href: href,
      id: target.id || null,
      className: target.className || null
    });
  }, true);

  // (c) Scroll Depth Tracking (50% and 90%)
  let scrolled50 = false;
  let scrolled90 = false;
  window.addEventListener('scroll', function () {
    const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
    if (totalHeight <= 0) return;
    const progress = (window.scrollY / totalHeight) * 100;

    if (progress >= 50 && !scrolled50) {
      scrolled50 = true;
      sendEvent('scroll_depth', { depthPercent: 50 });
    }
    if (progress >= 90 && !scrolled90) {
      scrolled90 = true;
      sendEvent('scroll_depth', { depthPercent: 90 });
    }
  }, { passive: true });

  // (d) Time on Page / Heartbeat
  const startTime = Date.now();
  window.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      const durationSeconds = Math.round((Date.now() - startTime) / 1000);
      sendEvent('time_on_page', { seconds: durationSeconds });
    }
  });

  // Expose global helper for custom events
  window.octopiq = window.octopiq || {
    track: sendEvent,
    id: anonymousId
  };

})(window, document);
