(function attachExamCore(global) {
  function clamp(num, min, max) {
    if (num < min) return min;
    if (num > max) return max;
    return num;
  }

  function shuffle(list) {
    var arr = list.slice();
    for (var i = arr.length - 1; i > 0; i -= 1) {
      var j = Math.floor(Math.random() * (i + 1));
      var temp = arr[i];
      arr[i] = arr[j];
      arr[j] = temp;
    }
    return arr;
  }

  function uniqueBy(list, keyFn) {
    var map = {};
    var out = [];
    list.forEach(function (item) {
      var key = keyFn(item);
      if (!map[key]) {
        map[key] = true;
        out.push(item);
      }
    });
    return out;
  }

  function questionSignature(ids) {
    return ids.slice().sort().join("|");
  }

  function buildContextKey(options) {
    return [options.scenario, options.vesselType || "-", options.area || "-", options.sessionMode || "-"].join("::");
  }

  function validateQuestionBank(questions) {
    var errors = [];
    var warnings = [];
    var required = [
      "id",
      "section",
      "topic",
      "subtopic",
      "difficulty",
      "prompt",
      "options",
      "correctIndex",
      "explanationShort",
      "explanationLong",
      "whyWrongOptions",
      "tags",
    ];

    var idSet = {};
    var promptSet = {};

    questions.forEach(function (question, index) {
      required.forEach(function (field) {
        if (question[field] === undefined || question[field] === null || question[field] === "") {
          errors.push("Question #" + index + " missing field: " + field);
        }
      });

      if (idSet[question.id]) {
        errors.push("Duplicate id: " + question.id);
      }
      idSet[question.id] = true;

      var normalizedPrompt = String(question.prompt || "").trim().toLowerCase();
      if (promptSet[normalizedPrompt]) {
        errors.push("Duplicate prompt: " + question.prompt);
      }
      promptSet[normalizedPrompt] = true;

      if (!Array.isArray(question.options) || question.options.length < 2) {
        errors.push("Question " + question.id + " must have at least 2 options");
      }

      if (
        !Number.isInteger(question.correctIndex) ||
        question.correctIndex < 0 ||
        question.correctIndex >= (Array.isArray(question.options) ? question.options.length : 0)
      ) {
        errors.push("Question " + question.id + " has invalid correctIndex");
      }

      if (!Array.isArray(question.whyWrongOptions) || question.whyWrongOptions.length < 1) {
        errors.push("Question " + question.id + " must have whyWrongOptions explanations");
      }

      if (!String(question.explanationShort || "").trim() || !String(question.explanationLong || "").trim()) {
        errors.push("Question " + question.id + " has empty explanation fields");
      }

      if (question.section !== "type" && question.section !== "area") {
        errors.push("Question " + question.id + " has invalid section");
      }

      if (question.section === "type" && !question.vesselType) {
        errors.push("Question " + question.id + " missing vesselType for type section");
      }

      if (question.section === "area" && !question.area) {
        errors.push("Question " + question.id + " missing area for area section");
      }

      if (!question.source) {
        warnings.push("Question " + question.id + " has no source mark, defaulting to training.");
      }
    });

    return {
      ok: errors.length === 0,
      errors: errors,
      warnings: warnings,
      summary: {
        total: questions.length,
      },
    };
  }

  function createInitialQuestionStat(question) {
    return {
      attempts: 0,
      correct: 0,
      wrong: 0,
      streakCorrect: 0,
      lastAt: null,
      masteryScore: 0,
      topic: question.topic,
      subtopic: question.subtopic,
    };
  }

  function computeMastery(stat, config, nowIso) {
    var attempts = stat.attempts || 0;
    var correct = stat.correct || 0;
    var accuracy = attempts > 0 ? correct / attempts : 0;
    var streakBonus = Math.min(stat.streakCorrect || 0, 5) * 0.06;
    var wrongPenalty = Math.min(stat.wrong || 0, 10) * 0.015;

    var decay = 0;
    if (stat.lastAt && nowIso) {
      var days = Math.max(0, (Date.parse(nowIso) - Date.parse(stat.lastAt)) / (1000 * 60 * 60 * 24));
      decay = days * config.adaptation.masteryDecayPerDay;
    }

    return clamp(accuracy + streakBonus - wrongPenalty - decay, 0, 1);
  }

  function registerAnswer(stats, question, isCorrect, config, nowIso) {
    var questionStats = stats.questionStats || {};
    var item = questionStats[question.id] || createInitialQuestionStat(question);

    item.attempts += 1;
    item.lastAt = nowIso;
    item.topic = question.topic;
    item.subtopic = question.subtopic;

    if (isCorrect) {
      item.correct += 1;
      item.streakCorrect += 1;
    } else {
      item.wrong += 1;
      item.streakCorrect = 0;
    }

    item.masteryScore = computeMastery(item, config, nowIso);
    questionStats[question.id] = item;
    stats.questionStats = questionStats;
    return item;
  }

  function getRecentSignatures(stats, contextKey) {
    var bag = stats.recentTicketSignatures || {};
    return Array.isArray(bag[contextKey]) ? bag[contextKey] : [];
  }

  function saveRecentSignature(stats, contextKey, signature, maxLen) {
    if (!stats.recentTicketSignatures || typeof stats.recentTicketSignatures !== "object") {
      stats.recentTicketSignatures = {};
    }
    var list = getRecentSignatures(stats, contextKey).slice();
    list.unshift(signature);
    var unique = uniqueBy(list, function (item) {
      return item;
    });
    stats.recentTicketSignatures[contextKey] = unique.slice(0, maxLen);
  }

  function collectRecentQuestionIds(stats, limit) {
    var ids = [];
    (stats.sessions || []).slice(0, limit).forEach(function (session) {
      if (Array.isArray(session.questionIds)) {
        ids = ids.concat(session.questionIds);
      }
    });
    return uniqueBy(ids, function (id) {
      return id;
    });
  }

  function buildBasePool(allQuestions, scenario, vesselType, area) {
    if (scenario === "type-ticket") {
      return allQuestions.filter(function (q) {
        return q.section === "type" && (q.vesselType === vesselType || q.vesselType === "any");
      });
    }

    if (scenario === "area-ticket") {
      return allQuestions.filter(function (q) {
        return q.section === "area" && (q.area === area || q.area === "any");
      });
    }

    if (scenario === "full") {
      return allQuestions.filter(function (q) {
        if (q.section === "type") {
          return q.vesselType === vesselType || q.vesselType === "any";
        }
        if (q.section === "area") {
          return q.area === area || q.area === "any";
        }
        return false;
      });
    }

    return allQuestions.slice();
  }

  function questionPriority(question, stats, recentIds, randomShift) {
    var qStat = stats.questionStats[question.id] || null;
    var mastery = qStat && typeof qStat.masteryScore === "number" ? qStat.masteryScore : 0;
    var recentPenalty = recentIds.indexOf(question.id) >= 0 ? -0.25 : 0;
    var generalPenalty = question.vesselType === "any" || question.area === "any" ? -0.12 : 0;
    return (1 - mastery) + recentPenalty + generalPenalty + randomShift;
  }

  function pickBalanced(pool, count, stats, recentIds) {
    var maxPerSubtopic = Math.max(2, Math.ceil(count / 3));
    var bySubtopicCount = {};
    var ranked = pool
      .map(function (question) {
        return {
          q: question,
          score: questionPriority(question, stats, recentIds, Math.random() * 0.3),
        };
      })
      .sort(function (a, b) {
        return b.score - a.score;
      });

    var selected = [];

    ranked.forEach(function (row) {
      if (selected.length >= count) {
        return;
      }
      var sub = row.q.subtopic || "Без подтемы";
      var used = bySubtopicCount[sub] || 0;
      if (used >= maxPerSubtopic) {
        return;
      }
      selected.push(row.q);
      bySubtopicCount[sub] = used + 1;
    });

    if (selected.length < count) {
      ranked.forEach(function (row) {
        if (selected.length >= count) {
          return;
        }
        if (selected.indexOf(row.q) >= 0) {
          return;
        }
        selected.push(row.q);
      });
    }

    return selected.slice(0, count);
  }

  function calculateScenarioCount(config, scenario) {
    if (scenario === "type-ticket") return config.ticketSize.typeTicket;
    if (scenario === "area-ticket") return config.ticketSize.areaTicket;
    if (scenario === "mistakes") return config.ticketSize.mistakesDefault;
    return config.ticketSize.fullType + config.ticketSize.fullArea;
  }

  function splitFullPools(allQuestions, vesselType, area) {
    return {
      typePool: allQuestions.filter(function (q) {
        return q.section === "type" && (q.vesselType === vesselType || q.vesselType === "any");
      }),
      areaPool: allQuestions.filter(function (q) {
        return q.section === "area" && (q.area === area || q.area === "any");
      }),
    };
  }

  function buildMistakesPool(allQuestions, stats, config, vesselType, area) {
    return allQuestions.filter(function (q) {
      var stat = stats.questionStats[q.id];
      if (!stat) return false;
      var isMistake =
        stat.wrong >= config.mistakes.minWrongAttempts &&
        (typeof stat.masteryScore !== "number" || stat.masteryScore < config.mistakes.masteryScoreToExitMistakes);
      if (!isMistake) return false;
      if (q.section === "type") {
        return q.vesselType === vesselType || q.vesselType === "any";
      }
      if (q.section === "area") {
        return q.area === area || q.area === "any";
      }
      return false;
    });
  }

  function generateTicket(options) {
    var questions = options.questions;
    var stats = options.stats;
    var config = options.config;
    var scenario = options.scenario;
    var vesselType = options.vesselType;
    var area = options.area;

    var contextKey = buildContextKey(options);
    var recentSignatures = getRecentSignatures(stats, contextKey);
    var recentQuestionIds = collectRecentQuestionIds(stats, config.adaptation.recentQuestionWindow);

    var warningBag = [];
    var candidate = [];

    if (scenario === "mistakes") {
      var mistakesPool = buildMistakesPool(questions, stats, config, vesselType, area);
      var requested = Number(options.mistakesCount) || config.ticketSize.mistakesDefault;
      if (mistakesPool.length === 0) {
        return {
          ok: false,
          reason: "no-mistakes",
          questions: [],
          availableCount: 0,
        };
      }
      if (mistakesPool.length < requested) {
        warningBag.push("Недостаточно вопросов с ошибками для выбранной длины.");
      }
      candidate = pickBalanced(mistakesPool, Math.min(requested, mistakesPool.length), stats, recentQuestionIds);
      return {
        ok: candidate.length > 0,
        reason: candidate.length > 0 ? null : "no-mistakes",
        questions: candidate,
        warnings: warningBag,
        contextKey: contextKey,
      };
    }

    var targetCount = calculateScenarioCount(config, scenario);

    if (scenario === "full") {
      var split = splitFullPools(questions, vesselType, area);
      var typeNeed = config.ticketSize.fullType;
      var areaNeed = config.ticketSize.fullArea;

      if (split.typePool.length < typeNeed) {
        warningBag.push("Мало вопросов по типу судна: вариативность ограничена.");
      }
      if (split.areaPool.length < areaNeed) {
        warningBag.push("Мало вопросов по району плавания: вариативность ограничена.");
      }

      var typePart = pickBalanced(split.typePool, Math.min(typeNeed, split.typePool.length), stats, recentQuestionIds);
      var areaPart = pickBalanced(split.areaPool, Math.min(areaNeed, split.areaPool.length), stats, recentQuestionIds);
      candidate = uniqueBy(typePart.concat(areaPart), function (q) {
        return q.id;
      });
    } else {
      var pool = buildBasePool(questions, scenario, vesselType, area);
      if (pool.length < targetCount) {
        warningBag.push("Банк вопросов мал для выбранного сценария: вариативность ограничена.");
      }
      candidate = pickBalanced(pool, Math.min(targetCount, pool.length), stats, recentQuestionIds);
    }

    if (candidate.length === 0) {
      return {
        ok: false,
        reason: "pool-empty",
        questions: [],
        warnings: warningBag,
      };
    }

    var selected = candidate;
    var selectedSignature = questionSignature(
      selected.map(function (q) {
        return q.id;
      })
    );

    if (recentSignatures.indexOf(selectedSignature) >= 0) {
      var improved = null;
      var attempts = 0;
      while (attempts < config.adaptation.maxTicketGenerationAttempts) {
        attempts += 1;
        var alt = shuffle(candidate).slice(0, candidate.length);
        var altSig = questionSignature(
          alt.map(function (q) {
            return q.id;
          })
        );
        if (recentSignatures.indexOf(altSig) < 0) {
          improved = alt;
          selectedSignature = altSig;
          break;
        }
      }
      if (improved) {
        selected = improved;
      } else {
        warningBag.push("Не удалось собрать полностью новый набор: банк ограничен.");
      }
    }

    return {
      ok: true,
      reason: null,
      questions: selected,
      contextKey: contextKey,
      signature: selectedSignature,
      warnings: warningBag,
    };
  }

  function registerTicket(stats, contextKey, signature, config) {
    saveRecentSignature(stats, contextKey, signature, config.adaptation.recentTicketWindow);
  }

  function pickWeakAndStrongTopics(stats) {
    var topicMap = {};
    Object.keys(stats.questionStats || {}).forEach(function (questionId) {
      var stat = stats.questionStats[questionId];
      var topic = stat.topic || "Без темы";
      if (!topicMap[topic]) {
        topicMap[topic] = {
          topic: topic,
          attempts: 0,
          correct: 0,
          wrong: 0,
          avgMastery: 0,
          _count: 0,
        };
      }
      var row = topicMap[topic];
      row.attempts += stat.attempts || 0;
      row.correct += stat.correct || 0;
      row.wrong += stat.wrong || 0;
      row.avgMastery += Number(stat.masteryScore) || 0;
      row._count += 1;
    });

    var rows = Object.keys(topicMap).map(function (topic) {
      var row = topicMap[topic];
      var mastery = row._count > 0 ? row.avgMastery / row._count : 0;
      return {
        topic: row.topic,
        attempts: row.attempts,
        correct: row.correct,
        wrong: row.wrong,
        mastery: mastery,
      };
    });

    rows.sort(function (a, b) {
      return a.mastery - b.mastery;
    });

    return {
      weak: rows.slice(0, 5),
      strong: rows.slice().reverse().slice(0, 5),
      all: rows,
    };
  }

  function getTopProblemQuestions(stats, questions, limit) {
    var byId = {};
    questions.forEach(function (q) {
      byId[q.id] = q;
    });

    return Object.keys(stats.questionStats || {})
      .map(function (id) {
        var stat = stats.questionStats[id];
        return {
          id: id,
          prompt: byId[id] ? byId[id].prompt : id,
          topic: stat.topic || "Без темы",
          wrong: stat.wrong || 0,
          attempts: stat.attempts || 0,
          mastery: typeof stat.masteryScore === "number" ? stat.masteryScore : 0,
        };
      })
      .filter(function (row) {
        return row.wrong > 0;
      })
      .sort(function (a, b) {
        if (a.mastery !== b.mastery) return a.mastery - b.mastery;
        if (a.wrong !== b.wrong) return b.wrong - a.wrong;
        return b.attempts - a.attempts;
      })
      .slice(0, limit);
  }

  global.ExamCore = {
    validateQuestionBank: validateQuestionBank,
    registerAnswer: registerAnswer,
    computeMastery: computeMastery,
    generateTicket: generateTicket,
    registerTicket: registerTicket,
    pickWeakAndStrongTopics: pickWeakAndStrongTopics,
    getTopProblemQuestions: getTopProblemQuestions,
    buildContextKey: buildContextKey,
    shuffle: shuffle,
  };
})(window);
