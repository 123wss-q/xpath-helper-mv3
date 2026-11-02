// SPDX-License-Identifier: Apache-2.0
// Local history and favorites for the independent XPath Helper MV3 adaptation.
// Added 2026-11-02. Stores selectors and user-supplied names, not matched results
// or an automatic history of full page URLs. Selectors may themselves contain text.
(function(global) {
  'use strict';

  const LIMITS = Object.freeze({history: 30, favorites: 50, sites: 100,
    query: 4096, name: 80, bytes: 2 * 1024 * 1024});
  const ACTIONS = new Set(['list', 'remember', 'favorite', 'remove',
    'clear-history', 'clear-favorites']);

  function normalizeSite(value) {
    if (typeof value !== 'string' || !value || value.length > 2048) {
      throw new Error('无法识别当前网站。请刷新网页后重试。');
    }
    if (value === 'file://') return value;
    let url;
    try { url = new URL(value); } catch (_) {
      throw new Error('当前页面不支持保存历史与收藏。');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('当前页面不支持保存历史与收藏。');
    }
    return url.origin;
  }

  function validEntry(entry) {
    return entry && typeof entry === 'object' &&
      typeof entry.id === 'string' && entry.id.length > 0 && entry.id.length <= 128 &&
      typeof entry.query === 'string' && entry.query.length > 0 && entry.query.length <= LIMITS.query &&
      typeof entry.name === 'string' && entry.name.length <= LIMITS.name &&
      Number.isFinite(entry.createdAt) && entry.createdAt >= 0;
  }

  function loadDatabase(value) {
    if (value === undefined) return {version: 1, sites: {}};
    if (!value || value.version !== 1 || !value.sites || typeof value.sites !== 'object' ||
        Array.isArray(value.sites)) throw new Error('本地资料格式异常，未更改已保存的数据。');
    const database = {version: 1, sites: {}};
    for (const [site, saved] of Object.entries(value.sites)) {
      if (normalizeSite(site) !== site || !saved ||
          !Array.isArray(saved.history) || !Array.isArray(saved.favorites) ||
          saved.history.length > LIMITS.history || saved.favorites.length > LIMITS.favorites ||
          !saved.history.every(validEntry) || !saved.favorites.every(validEntry) ||
          !Number.isFinite(saved.updatedAt)) {
        throw new Error('本地资料格式异常，未更改已保存的数据。');
      }
      database.sites[site] = {
        history: saved.history.map(entry => ({...entry})),
        favorites: saved.favorites.map(entry => ({...entry})),
        updatedAt: saved.updatedAt
      };
    }
    return database;
  }

  function bytes(database) {
    return new TextEncoder().encode(JSON.stringify(database)).byteLength;
  }

  function enforceLimits(database, currentSite) {
    const sites = database.sites;
    // Expire old history-only sites first. Favorites are never silently discarded.
    const removable = Object.keys(sites).filter(site =>
      site !== currentSite && !sites[site].favorites.length
    ).sort((a, b) => sites[a].updatedAt - sites[b].updatedAt);
    while ((Object.keys(sites).length > LIMITS.sites || bytes(database) > LIMITS.bytes) &&
        removable.length) delete sites[removable.shift()];
    if (Object.keys(sites).length > LIMITS.sites) {
      throw new Error('已达到 100 个网站的保存上限，请先清理不需要的收藏。');
    }
    // If saved favorites occupy most of the allowance, trim the oldest history.
    while (bytes(database) > LIMITS.bytes) {
      let oldestSite = null;
      let oldestTime = Infinity;
      for (const [site, saved] of Object.entries(sites)) {
        const last = saved.history.at(-1);
        if (last && last.createdAt < oldestTime &&
            !(site === currentSite && saved.history.length === 1)) {
          oldestSite = site;
          oldestTime = last.createdAt;
        }
      }
      if (!oldestSite) throw new Error('本地收藏空间已满，请先删除不需要的收藏。');
      sites[oldestSite].history.pop();
      if (!sites[oldestSite].history.length && !sites[oldestSite].favorites.length) {
        delete sites[oldestSite];
      }
    }
  }

  function queryValue(request) {
    if (typeof request.query !== 'string' || !request.query.trim()) {
      throw new Error('请先输入 XPath。');
    }
    if (request.query.length > LIMITS.query) throw new Error('XPath 不能超过 4096 个字符。');
    return request.query.trim();
  }

  function nameValue(request, fallback) {
    if (request.name === undefined) return fallback;
    if (typeof request.name !== 'string' || request.name.length > LIMITS.name) {
      throw new Error('收藏名称不能超过 80 个字符。');
    }
    return request.name.trim();
  }

  function makeId() {
    return global.crypto && typeof global.crypto.randomUUID === 'function' ?
      global.crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }

  function create(storage) {
    let pending = Promise.resolve();

    async function apply(site, request) {
      site = normalizeSite(site);
      if (!request || !ACTIONS.has(request.action)) throw new Error('不支持的资料操作。');
      const database = loadDatabase(await storage.get());
      const saved = database.sites[site] || {history: [], favorites: [], updatedAt: 0};
      const now = Date.now();
      if (request.action === 'remember') {
        const query = queryValue(request);
        const existing = saved.history.find(entry => entry.query === query);
        saved.history = [{id: existing ? existing.id : makeId(), query,
          name: '', createdAt: now}, ...saved.history.filter(entry => entry.query !== query)]
          .slice(0, LIMITS.history);
      } else if (request.action === 'favorite') {
        const query = queryValue(request);
        const existing = saved.favorites.find(entry => entry.query === query);
        if (!existing && saved.favorites.length >= LIMITS.favorites) {
          throw new Error('当前网站最多保存 50 条收藏，请先删除不需要的条目。');
        }
        const name = nameValue(request, existing ? existing.name : '') || query.slice(0, 60);
        saved.favorites = [{id: existing ? existing.id : makeId(), query, name,
          createdAt: existing ? existing.createdAt : now},
        ...saved.favorites.filter(entry => entry.query !== query)];
      } else if (request.action === 'remove') {
        if (typeof request.id !== 'string' || !request.id || request.id.length > 128) {
          throw new Error('请选择要删除的收藏。');
        }
        saved.favorites = saved.favorites.filter(entry => entry.id !== request.id);
      } else if (request.action === 'clear-history') {
        saved.history = [];
      } else if (request.action === 'clear-favorites') {
        saved.favorites = [];
      }

      if (request.action !== 'list') {
        saved.updatedAt = now;
        if (saved.history.length || saved.favorites.length) database.sites[site] = saved;
        else delete database.sites[site];
        enforceLimits(database, site);
        await storage.set(database);
      }
      const current = database.sites[site] || {history: [], favorites: []};
      return {ok: true, site, history: current.history.map(entry => ({...entry})),
        favorites: current.favorites.map(entry => ({...entry}))};
    }

    return Object.freeze({run(site, request) {
      // A single queue covers all origins. Re-read storage inside the queue so
      // simultaneous tabs cannot overwrite each other's latest changes.
      const result = pending.then(() => apply(site, request));
      pending = result.catch(() => {});
      return result;
    }});
  }

  global.XHLibrary = Object.freeze({create, normalizeSite, limits: LIMITS});
})(globalThis);
