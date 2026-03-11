(function attachStorage(global) {
  var memoryStore = {};

  var KEYS = {
    learning: "gims.learning.v2",
    stats: "gims.stats.v2",
  };

  function safeGet(key) {
    try {
      return global.localStorage.getItem(key);
    } catch (error) {
      return Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : null;
    }
  }

  function safeSet(key, value) {
    try {
      global.localStorage.setItem(key, value);
    } catch (error) {
      memoryStore[key] = String(value);
    }
  }

  function safeRemove(key) {
    try {
      global.localStorage.removeItem(key);
    } catch (error) {
      delete memoryStore[key];
    }
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createDefaultLearning(moduleIds) {
    var modules = {};
    moduleIds.forEach(function (id) {
      modules[id] = {
        passed: false,
        bestScore: 0,
        lastAt: null,
      };
    });
    return {
      version: 2,
      modules: modules,
      completedOrder: [],
      updatedAt: null,
    };
  }

  function createDefaultStats() {
    return {
      version: 2,
      sessions: [],
      questionStats: {},
      recentTicketSignatures: {},
      updatedAt: null,
    };
  }

  function loadLearning(moduleIds) {
    var raw = safeGet(KEYS.learning);
    var fallback = createDefaultLearning(moduleIds);
    if (!raw) {
      return fallback;
    }
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return fallback;
      }
      var base = createDefaultLearning(moduleIds);
      if (parsed.modules && typeof parsed.modules === "object") {
        moduleIds.forEach(function (id) {
          var item = parsed.modules[id];
          if (item && typeof item === "object") {
            base.modules[id] = {
              passed: Boolean(item.passed),
              bestScore: Number(item.bestScore) || 0,
              lastAt: item.lastAt || null,
            };
          }
        });
      }
      if (Array.isArray(parsed.completedOrder)) {
        base.completedOrder = parsed.completedOrder.filter(function (id) {
          return moduleIds.indexOf(id) >= 0;
        });
      }
      base.updatedAt = parsed.updatedAt || null;
      return base;
    } catch (error) {
      return fallback;
    }
  }

  function saveLearning(state) {
    var next = clone(state);
    next.updatedAt = new Date().toISOString();
    safeSet(KEYS.learning, JSON.stringify(next));
  }

  function loadStats() {
    var raw = safeGet(KEYS.stats);
    var fallback = createDefaultStats();
    if (!raw) {
      return fallback;
    }
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return fallback;
      }
      return {
        version: 2,
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
        questionStats: parsed.questionStats && typeof parsed.questionStats === "object" ? parsed.questionStats : {},
        recentTicketSignatures:
          parsed.recentTicketSignatures && typeof parsed.recentTicketSignatures === "object"
            ? parsed.recentTicketSignatures
            : {},
        updatedAt: parsed.updatedAt || null,
      };
    } catch (error) {
      return fallback;
    }
  }

  function saveStats(state) {
    var next = clone(state);
    next.updatedAt = new Date().toISOString();
    safeSet(KEYS.stats, JSON.stringify(next));
  }

  function resetLearning(moduleIds) {
    var next = createDefaultLearning(moduleIds);
    saveLearning(next);
    return next;
  }

  function clearMistakes(stats) {
    var next = clone(stats);
    Object.keys(next.questionStats).forEach(function (questionId) {
      var item = next.questionStats[questionId];
      item.wrong = 0;
      item.streakCorrect = 0;
      if (typeof item.masteryScore !== "number") {
        item.masteryScore = 0;
      }
    });
    saveStats(next);
    return next;
  }

  function exportSnapshot(learning, stats) {
    return {
      type: "gims-trainer-snapshot",
      version: 2,
      exportedAt: new Date().toISOString(),
      learning: clone(learning),
      stats: clone(stats),
    };
  }

  function importSnapshot(snapshot, moduleIds) {
    if (!snapshot || typeof snapshot !== "object") {
      return { ok: false, reason: "invalid-payload" };
    }
    if (snapshot.type !== "gims-trainer-snapshot") {
      return { ok: false, reason: "unsupported-type" };
    }
    var incomingLearning = snapshot.learning || {};
    var incomingStats = snapshot.stats || {};

    var learning = createDefaultLearning(moduleIds);
    if (incomingLearning.modules && typeof incomingLearning.modules === "object") {
      moduleIds.forEach(function (id) {
        var item = incomingLearning.modules[id];
        if (item && typeof item === "object") {
          learning.modules[id] = {
            passed: Boolean(item.passed),
            bestScore: Number(item.bestScore) || 0,
            lastAt: item.lastAt || null,
          };
        }
      });
    }
    learning.completedOrder = Array.isArray(incomingLearning.completedOrder)
      ? incomingLearning.completedOrder.filter(function (id) {
          return moduleIds.indexOf(id) >= 0;
        })
      : [];

    var stats = createDefaultStats();
    stats.sessions = Array.isArray(incomingStats.sessions) ? incomingStats.sessions : [];
    stats.questionStats =
      incomingStats.questionStats && typeof incomingStats.questionStats === "object" ? incomingStats.questionStats : {};
    stats.recentTicketSignatures =
      incomingStats.recentTicketSignatures && typeof incomingStats.recentTicketSignatures === "object"
        ? incomingStats.recentTicketSignatures
        : {};

    saveLearning(learning);
    saveStats(stats);
    return { ok: true, learning: learning, stats: stats };
  }

  function clearAll(moduleIds) {
    safeRemove(KEYS.learning);
    safeRemove(KEYS.stats);
    return {
      learning: createDefaultLearning(moduleIds),
      stats: createDefaultStats(),
    };
  }

  global.Storage = {
    keys: KEYS,
    loadLearning: loadLearning,
    saveLearning: saveLearning,
    loadStats: loadStats,
    saveStats: saveStats,
    resetLearning: resetLearning,
    clearMistakes: clearMistakes,
    exportSnapshot: exportSnapshot,
    importSnapshot: importSnapshot,
    clearAll: clearAll,
  };
})(window);
